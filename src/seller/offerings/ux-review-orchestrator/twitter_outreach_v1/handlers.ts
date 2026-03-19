import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";
import {
  runTwitterCampaign,
  searchAndEngageACP,
  logCampaignResult,
  type TweetCampaign,
  type CampaignLog,
} from "../../../lib/twitterOutreach.js";
import { join } from "path";

const LEDGER_PATH = join(process.cwd(), "logs", "twitter_outreach_ledger.json");

export async function executeJob(request: unknown): Promise<ExecuteJobResult> {
  const req = (request ?? {}) as Record<string, any>;

  const campaign: TweetCampaign = {
    agentName: req.agentName ?? "ux-review-orchestrator",
    offerings: req.offerings ?? [
      { name: "Gate check", price: 0.02, description: "Quick UX gate review" },
      { name: "Deep audit", price: 0.08, description: "Full UX audit" },
    ],
    hashtags: req.hashtags ?? ["ACP", "VirtualsProtocol", "Web3"],
    mentions: req.mentions ?? ["virtuals_io"],
    websiteUrl: req.websiteUrl,
    maxTweets: 3,
    dryRun: false,
  };

  const log = await runTwitterCampaign(campaign);

  // Engage with related tweets if keywords provided
  let engageResults: any[] = [];
  if (req.keywords?.length) {
    engageResults = await searchAndEngageACP(req.keywords, campaign.agentName);
  }

  logCampaignResult(log, LEDGER_PATH);

  const posted = log.results.filter((r) => r.status === "posted").length;
  const failed = log.results.filter((r) => r.status === "failed").length;

  return {
    deliverable: JSON.stringify({
      offering: "twitter_outreach_v1",
      campaign: campaign.agentName,
      tweetsPosted: posted,
      tweetsFailed: failed,
      tweetIds: log.results.filter((r) => r.tweetId).map((r) => r.tweetId),
      engagementsAttempted: engageResults.length,
      engagementsReplied: engageResults.filter((r: any) => r.replyStatus === "replied").length,
      completedAt: log.completedAt,
    }),
  };
}

export function validateRequirements(request: unknown): ValidationResult {
  const req = (request ?? {}) as Record<string, any>;
  if (!req.agentName || typeof req.agentName !== "string") {
    return { valid: false, reason: "agentName is required" };
  }
  return { valid: true };
}

export function requestPayment(): string {
  return "Twitter outreach campaign accepted. Posting promotional tweets and engaging with ACP community now.";
}
