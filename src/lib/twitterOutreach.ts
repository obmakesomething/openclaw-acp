// =============================================================================
// Twitter Outreach Module — campaign builder + poster for ACP agent promotion.
// Reuses twitterApi.ts for actual API calls.
// =============================================================================

import { postTweet, searchTweets, replyTweet, SortOrder } from "./twitterApi.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Offering {
  name: string;
  price: number;
  description: string;
}

export interface TweetCampaign {
  agentName: string;
  offerings: Offering[];
  hashtags: string[];
  mentions: string[];
  websiteUrl?: string;
  maxTweets: number;
  dryRun?: boolean;
}

export interface TweetTemplate {
  type: "general" | "community" | "technical" | "reply";
  text: string;
}

export interface PostResult {
  template: TweetTemplate;
  status: "posted" | "failed" | "skipped_dry_run";
  tweetId?: string;
  error?: string;
  timestamp: string;
}

export interface EngageResult {
  tweetId: string;
  authorUsername: string;
  replyStatus: "replied" | "failed" | "skipped";
  error?: string;
}

export interface CampaignLog {
  campaign: Pick<TweetCampaign, "agentName" | "offerings" | "hashtags">;
  results: PostResult[];
  startedAt: string;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Template builders
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

function formatPrice(offerings: Offering[]): string {
  if (offerings.length === 0) return "";
  if (offerings.length === 1) return `$${offerings[0].price}`;
  const prices = offerings.map((o) => o.price).sort((a, b) => a - b);
  return `$${prices[0]}–$${prices[prices.length - 1]}`;
}

export function buildTweetTemplates(campaign: TweetCampaign): TweetTemplate[] {
  const { agentName, offerings, hashtags, mentions, websiteUrl } = campaign;
  const tags = hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  const mentionStr = mentions.map((m) => (m.startsWith("@") ? m : `@${m}`)).join(" ");
  const priceRange = formatPrice(offerings);
  const url = websiteUrl ? `\n${websiteUrl}` : "";

  const templates: TweetTemplate[] = [];

  // 1. General promotion
  const offeringLines = offerings
    .slice(0, 3)
    .map((o) => `- ${o.name}: $${o.price}`)
    .join("\n");

  templates.push({
    type: "general",
    text: truncate(
      `${agentName} is live on ACP\n\n${offeringLines}\n\nUSDC on Base. No subscriptions.${url}\n\n${tags}`,
      280
    ),
  });

  // 2. Community target (with mentions)
  if (mentionStr) {
    templates.push({
      type: "community",
      text: truncate(
        `.${mentionStr} builders — meet ${agentName}\n\nOfferings: ${priceRange}\nAgent-to-agent, paid in USDC on Base.\n\n${tags}`,
        280
      ),
    });
  }

  // 3. Technical differentiation
  templates.push({
    type: "technical",
    text: truncate(
      `Why ${agentName}:\n1. Micro-cost (${priceRange})\n2. Base mainnet + USDC settlement\n3. Any ACP agent can call it programmatically\n\nBuilt for the agent economy.\n\n${tags}`,
      280
    ),
  });

  return templates.slice(0, campaign.maxTweets);
}

// ---------------------------------------------------------------------------
// Campaign execution
// ---------------------------------------------------------------------------

export async function postCampaignTweets(
  templates: TweetTemplate[],
  dryRun = false
): Promise<PostResult[]> {
  const results: PostResult[] = [];

  for (const template of templates) {
    if (dryRun) {
      results.push({
        template,
        status: "skipped_dry_run",
        timestamp: new Date().toISOString(),
      });
      console.log(`[twitter-outreach] DRY RUN: ${template.type} — ${template.text.slice(0, 60)}…`);
      continue;
    }

    try {
      const resp = await postTweet(template.text);
      const tweetId = resp?.data?.tweetId;
      results.push({
        template,
        status: "posted",
        tweetId,
        timestamp: new Date().toISOString(),
      });
      console.log(`[twitter-outreach] POSTED (${template.type}): ${tweetId}`);

      // Rate limit: wait 2s between tweets
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err: any) {
      results.push({
        template,
        status: "failed",
        error: err?.message ?? String(err),
        timestamp: new Date().toISOString(),
      });
      console.error(`[twitter-outreach] FAILED (${template.type}): ${err?.message}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Search & engage — find ACP-related tweets and reply
// ---------------------------------------------------------------------------

export async function searchAndEngageACP(
  keywords: string[],
  agentName: string,
  replyTemplate?: string,
  dryRun = false
): Promise<EngageResult[]> {
  const results: EngageResult[] = [];

  for (const keyword of keywords) {
    try {
      const searchResp = await searchTweets({
        query: keyword,
        maxResults: 10,
        sortOrder: SortOrder.RECENCY,
        excludeRetweets: true,
        tweetFields: ["author_id", "created_at"],
        expansions: ["author_id"],
        userFields: ["username"],
      });

      const tweets = searchResp?.data?.data ?? [];
      const users = searchResp?.data?.includes?.users ?? [];

      for (const tweet of tweets.slice(0, 3)) {
        const author = users.find((u: any) => u.id === tweet.author_id);
        const username = author?.username ?? "unknown";

        if (dryRun) {
          results.push({
            tweetId: tweet.id,
            authorUsername: username,
            replyStatus: "skipped",
          });
          continue;
        }

        const reply =
          replyTemplate ??
          `Check out ${agentName} on ACP — automated UX reviews starting at $0.02. USDC on Base.`;

        try {
          await replyTweet(tweet.id, reply);
          results.push({ tweetId: tweet.id, authorUsername: username, replyStatus: "replied" });
          await new Promise((r) => setTimeout(r, 3000));
        } catch (replyErr: any) {
          results.push({
            tweetId: tweet.id,
            authorUsername: username,
            replyStatus: "failed",
            error: replyErr?.message,
          });
        }
      }
    } catch (err: any) {
      console.error(`[twitter-outreach] Search failed for "${keyword}": ${err?.message}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Campaign logging
// ---------------------------------------------------------------------------

export function logCampaignResult(log: CampaignLog, ledgerPath: string): void {
  const dir = dirname(ledgerPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let ledger: CampaignLog[] = [];
  if (existsSync(ledgerPath)) {
    try {
      ledger = JSON.parse(readFileSync(ledgerPath, "utf-8"));
    } catch {
      ledger = [];
    }
  }

  ledger.push(log);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  console.log(`[twitter-outreach] Campaign logged to ${ledgerPath}`);
}

// ---------------------------------------------------------------------------
// Convenience: run a full campaign
// ---------------------------------------------------------------------------

export async function runTwitterCampaign(campaign: TweetCampaign): Promise<CampaignLog> {
  const startedAt = new Date().toISOString();
  console.log(`[twitter-outreach] Starting campaign for "${campaign.agentName}"…`);

  const templates = buildTweetTemplates(campaign);
  console.log(`[twitter-outreach] Built ${templates.length} tweet templates`);

  const results = await postCampaignTweets(templates, campaign.dryRun);

  const log: CampaignLog = {
    campaign: {
      agentName: campaign.agentName,
      offerings: campaign.offerings,
      hashtags: campaign.hashtags,
    },
    results,
    startedAt,
    completedAt: new Date().toISOString(),
  };

  return log;
}

// ---------------------------------------------------------------------------
// Standalone test (dry-run)
// ---------------------------------------------------------------------------

if (
  process.argv[1]?.endsWith("twitterOutreach.ts") ||
  process.argv[1]?.endsWith("twitterOutreach.js")
) {
  const testCampaign: TweetCampaign = {
    agentName: "ux-review-orchestrator",
    offerings: [
      { name: "Gate check", price: 0.02, description: "Quick UX gate review" },
      { name: "Deep audit", price: 0.08, description: "Full UX audit with IA analysis" },
    ],
    hashtags: ["ACP", "VirtualsProtocol", "UXReview", "Web3"],
    mentions: ["virtuals_io"],
    websiteUrl: "https://hand-axe.com",
    maxTweets: 3,
    dryRun: true,
  };

  runTwitterCampaign(testCampaign).then((log) => {
    console.log("\n--- Campaign Result ---");
    console.log(JSON.stringify(log, null, 2));
  });
}
