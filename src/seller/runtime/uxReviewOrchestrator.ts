import type { ExecuteJobResult, ValidationResult } from "./offeringTypes.js";

export type UxReviewTier = "lite" | "deep";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type EnvLike = Record<string, string | undefined>;

export interface UxReviewRequest {
  surfaceType: string;
  productSummary: string;
  targetUser: string;
  primaryGoal: string;
  primaryFlow: string;
  artifactLinks: string[];
  currentIA?: string;
  coreScreensOrStates?: string[];
  changeBudget?: string;
  successMetrics?: string[];
}

export interface LiteIssue {
  title: string;
  userImpact: string;
  codeOrEvidence: string;
  recommendation: string;
}

export interface LiteUxReviewOutput {
  gateVerdict: "pass" | "revise" | "block";
  decision: string;
  primaryAction: string;
  secondaryActions: string[];
  p0: LiteIssue[];
  fastFixes: string[];
  missingEvidence: string[];
  assumptions: string[];
}

export interface FlowMapStep {
  step: string;
  userIntent: string;
  risk: string;
}

export interface PriorityIssue {
  priority: "P0" | "P1" | "P2";
  title: string;
  userImpact: string;
  codeOrEvidence: string;
  recommendation: string;
}

export interface DeepUxReviewOutput {
  summary: string;
  flowMap: FlowMapStep[];
  priorityIssues: PriorityIssue[];
  iaRecommendation: {
    primaryGrouping: string;
    why: string;
  };
  top3Flows: Array<{
    name: string;
    why: string;
    priority: "P0" | "P1" | "P2";
  }>;
  statePolicies: {
    loading: string;
    empty: string;
    error: string;
    success: string;
  };
  experimentPlan: string[];
  missingEvidence: string[];
  assumptions: string[];
}

export interface UxReviewAnalysisResult<TOutput extends LiteUxReviewOutput | DeepUxReviewOutput> {
  meta: {
    provider: "gemini" | "openrouter" | "fallback";
    model: string;
    tier: UxReviewTier;
  };
  output: TOutput;
}

export interface BuildUxReviewAnalysisOptions {
  env?: EnvLike;
  fetchImpl?: FetchLike;
}

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.1-flash-lite-preview";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite-preview";

const CORE_PROMPT_RULES = [
  "Decision must stay singular.",
  "Primary action must stay singular.",
  "Secondary actions must stay at two or fewer.",
  "Prioritize information hierarchy, IA, and flow clarity over visual styling.",
  "If evidence is missing, state 'Not found' in missingEvidence instead of guessing.",
];

function cleanText(value: unknown, max = 1600): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function cleanList(value: unknown, maxItems = 8, maxItemLength = 240): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, maxItemLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

function clipNonEmpty<T extends object>(record: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

function resolveModel(env: EnvLike = process.env): string {
  return (
    cleanText(env.UX_REVIEW_OPENROUTER_MODEL, 200) ||
    cleanText(env.OPENROUTER_FREE_MODEL, 200) ||
    DEFAULT_OPENROUTER_MODEL
  );
}

function resolveBaseUrl(env: EnvLike = process.env): string {
  return (cleanText(env.OPENROUTER_BASE_URL, 400) || DEFAULT_OPENROUTER_BASE_URL).replace(
    /\/$/,
    ""
  );
}

function stripProviderPrefix(model: string): string {
  return model.replace(/^[a-z0-9-]+\//i, "");
}

function resolveGeminiModel(env: EnvLike = process.env): string {
  return stripProviderPrefix(
    cleanText(env.UX_REVIEW_GEMINI_MODEL, 200) ||
      cleanText(env.GEMINI_MODEL, 200) ||
      cleanText(env.UX_REVIEW_OPENROUTER_MODEL, 200) ||
      DEFAULT_GEMINI_MODEL
  );
}

function resolveGeminiBaseUrl(env: EnvLike = process.env): string {
  return (cleanText(env.GEMINI_BASE_URL, 400) || DEFAULT_GEMINI_BASE_URL).replace(/\/$/, "");
}

function resolveGeminiApiKey(env: EnvLike = process.env): string {
  return (
    cleanText(env.UX_REVIEW_GEMINI_API_KEY, 400) ||
    cleanText(env.GEMINI_API_KEY, 400) ||
    cleanText(env.GOOGLE_GENERATIVE_AI_API_KEY, 400) ||
    cleanText(env.GOOGLE_API_KEY, 400)
  );
}

function extractFirstJsonObject(raw: string): Record<string, any> | null {
  const text = cleanText(raw, 40000);
  if (!text) return null;

  try {
    const direct = JSON.parse(text);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  } catch {
    // continue
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // continue
    }
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }

  return null;
}

function buildMissingEvidence(input: UxReviewRequest, tier: UxReviewTier): string[] {
  const missing: string[] = [];
  if (input.artifactLinks.length === 0) {
    missing.push("Not found: live artifact links or screenshots");
  } else {
    missing.push("Not found: annotated screen capture for the current flow");
  }
  missing.push("Not found: explicit loading / empty / error / success evidence");
  if (tier === "deep") {
    missing.push("Not found: route map or IA ownership notes");
  }
  return missing;
}

function buildAssumptions(input: UxReviewRequest, tier: UxReviewTier): string[] {
  const assumptions = [
    `Assume ${input.targetUser || "the primary user"} is the main decision-maker for this surface.`,
    `Assume "${input.primaryFlow || "the declared flow"}" is the highest-value task to optimize first.`,
  ];
  if (tier === "deep") {
    assumptions.push(
      `Assume "${input.changeBudget || "medium"}" is the realistic delivery budget for the next iteration.`
    );
  }
  return assumptions;
}

function buildLiteFallback(input: UxReviewRequest): LiteUxReviewOutput {
  const missingEvidence = buildMissingEvidence(input, "lite");
  const assumptions = buildAssumptions(input, "lite");
  return {
    gateVerdict: "revise",
    decision: `Keep the experience focused on helping ${input.targetUser} complete one decision around ${input.primaryGoal}.`,
    primaryAction: `Make the key action inside "${input.primaryFlow}" the only dominant CTA on the ${input.surfaceType} surface.`,
    secondaryActions: [
      "Move supportive actions into a quieter secondary area.",
      "Expose the current state before optional detail or settings.",
    ],
    p0: [
      {
        title: "Primary action competes with secondary navigation",
        userImpact: `Users can lose momentum before finishing ${input.primaryGoal}.`,
        codeOrEvidence: "Not found",
        recommendation:
          "Reduce the visible action set to one primary action and at most two secondary actions.",
      },
      {
        title: "State handling is not explicit enough",
        userImpact:
          "Users cannot quickly tell whether the flow is loading, empty, blocked, or complete.",
        codeOrEvidence: "Not found",
        recommendation:
          "Define loading, empty, error, and success states directly in the core flow.",
      },
    ],
    fastFixes: [
      "Rename the primary button so the outcome is obvious without reading surrounding copy.",
      "Move optional metadata below the main decision area.",
      "Add one short success confirmation that tells the user what to do next.",
    ],
    missingEvidence,
    assumptions,
  };
}

function buildDeepFallback(input: UxReviewRequest): DeepUxReviewOutput {
  const missingEvidence = buildMissingEvidence(input, "deep");
  const assumptions = buildAssumptions(input, "deep");
  return {
    summary: `${input.productSummary} needs a more task-first structure so ${input.targetUser} can complete ${input.primaryGoal} without scanning unrelated sections first.`,
    flowMap: [
      {
        step: "Entry",
        userIntent: `Understand whether the surface supports ${input.primaryGoal}.`,
        risk: "The value proposition and next action may be split across multiple areas.",
      },
      {
        step: "Core flow",
        userIntent: input.primaryFlow,
        risk: "State transitions are likely under-specified when evidence is missing.",
      },
      {
        step: "Confirmation",
        userIntent: "Know what changed and what to do next.",
        risk: "Users may not receive enough success feedback to continue confidently.",
      },
    ],
    priorityIssues: [
      {
        priority: "P0",
        title: "Task priority is not explicit enough",
        userImpact: `Users may hesitate before starting ${input.primaryFlow}.`,
        codeOrEvidence: "Not found",
        recommendation:
          "Move the highest-value task into the first visible section and remove competing emphasis.",
      },
      {
        priority: "P0",
        title: "IA likely mixes task and reference content",
        userImpact: "Users need to parse structure before acting.",
        codeOrEvidence: "Not found",
        recommendation: `Use a task-first grouping anchored on ${input.primaryGoal}.`,
      },
      {
        priority: "P1",
        title: "State policy is not consistently surfaced",
        userImpact: "Users may retry or abandon when the system is slow or empty.",
        codeOrEvidence: "Not found",
        recommendation: "Define state-specific copy and next-step actions for all core screens.",
      },
    ],
    iaRecommendation: {
      primaryGrouping: "Task-first navigation with one decision zone per screen",
      why: "This keeps the highest-value flow visible and prevents informational clutter from outranking action.",
    },
    top3Flows: [
      {
        name: input.primaryFlow,
        why: "It directly maps to the user-stated primary goal.",
        priority: "P0",
      },
      {
        name: "Empty or first-time setup flow",
        why: "This determines whether users understand what to do when the surface has no content yet.",
        priority: "P0",
      },
      {
        name: "Error recovery flow",
        why: "Users need a safe next step when the core action fails.",
        priority: "P1",
      },
    ],
    statePolicies: {
      loading: "Show the current task skeleton and preserve the primary action destination.",
      empty: "Explain why content is empty and present one setup CTA.",
      error: "Name the failure in plain language and provide a retry or safe fallback.",
      success: "Confirm what changed and point to the next recommended task.",
    },
    experimentPlan: [
      "Test a task-first first screen against the current mixed-information layout.",
      "Measure time-to-decision before and after reducing the number of visible secondary actions.",
      "Instrument which state users hit most often and whether they recover without support.",
    ],
    missingEvidence,
    assumptions,
  };
}

function normalizeLiteIssue(issue: unknown, fallback: LiteIssue): LiteIssue {
  const record = asRecord(issue);
  return {
    title: cleanText(record.title, 180) || fallback.title,
    userImpact: cleanText(record.userImpact, 280) || fallback.userImpact,
    codeOrEvidence: cleanText(record.codeOrEvidence, 280) || fallback.codeOrEvidence,
    recommendation: cleanText(record.recommendation, 280) || fallback.recommendation,
  };
}

function normalizePriorityIssue(issue: unknown, fallback: PriorityIssue): PriorityIssue {
  const record = asRecord(issue);
  const priority = cleanText(record.priority, 4).toUpperCase();
  return {
    priority:
      priority === "P0" || priority === "P1" || priority === "P2"
        ? (priority as PriorityIssue["priority"])
        : fallback.priority,
    title: cleanText(record.title, 180) || fallback.title,
    userImpact: cleanText(record.userImpact, 280) || fallback.userImpact,
    codeOrEvidence: cleanText(record.codeOrEvidence, 280) || fallback.codeOrEvidence,
    recommendation: cleanText(record.recommendation, 280) || fallback.recommendation,
  };
}

function normalizeFlowStep(step: unknown, fallback: FlowMapStep): FlowMapStep {
  const record = asRecord(step);
  return {
    step: cleanText(record.step, 120) || fallback.step,
    userIntent: cleanText(record.userIntent, 220) || fallback.userIntent,
    risk: cleanText(record.risk, 240) || fallback.risk,
  };
}

function normalizeLiteOutput(
  candidate: Record<string, any>,
  fallback: LiteUxReviewOutput
): LiteUxReviewOutput {
  const verdict = cleanText(candidate.gateVerdict, 20).toLowerCase();
  return {
    gateVerdict:
      verdict === "pass" || verdict === "block" || verdict === "revise"
        ? (verdict as LiteUxReviewOutput["gateVerdict"])
        : fallback.gateVerdict,
    decision: cleanText(candidate.decision, 280) || fallback.decision,
    primaryAction: cleanText(candidate.primaryAction, 240) || fallback.primaryAction,
    secondaryActions: cleanList(candidate.secondaryActions, 2, 180).length
      ? cleanList(candidate.secondaryActions, 2, 180)
      : fallback.secondaryActions,
    p0:
      Array.isArray(candidate.p0) && candidate.p0.length
        ? candidate.p0
            .slice(0, 5)
            .map((item, index) =>
              normalizeLiteIssue(item, fallback.p0[Math.min(index, fallback.p0.length - 1)])
            )
        : fallback.p0,
    fastFixes: cleanList(candidate.fastFixes, 5, 180).length
      ? cleanList(candidate.fastFixes, 5, 180)
      : fallback.fastFixes,
    missingEvidence: cleanList(candidate.missingEvidence, 6, 200).length
      ? cleanList(candidate.missingEvidence, 6, 200)
      : fallback.missingEvidence,
    assumptions: cleanList(candidate.assumptions, 6, 200).length
      ? cleanList(candidate.assumptions, 6, 200)
      : fallback.assumptions,
  };
}

function normalizeDeepOutput(
  candidate: Record<string, any>,
  fallback: DeepUxReviewOutput
): DeepUxReviewOutput {
  const iaRecommendation = asRecord(candidate.iaRecommendation);
  const statePolicies = asRecord(candidate.statePolicies);
  const top3Flows = Array.isArray(candidate.top3Flows) ? candidate.top3Flows.slice(0, 3) : [];
  return {
    summary: cleanText(candidate.summary, 400) || fallback.summary,
    flowMap:
      Array.isArray(candidate.flowMap) && candidate.flowMap.length
        ? candidate.flowMap
            .slice(0, 6)
            .map((item, index) =>
              normalizeFlowStep(
                item,
                fallback.flowMap[Math.min(index, fallback.flowMap.length - 1)]
              )
            )
        : fallback.flowMap,
    priorityIssues:
      Array.isArray(candidate.priorityIssues) && candidate.priorityIssues.length
        ? candidate.priorityIssues
            .slice(0, 6)
            .map((item, index) =>
              normalizePriorityIssue(
                item,
                fallback.priorityIssues[Math.min(index, fallback.priorityIssues.length - 1)]
              )
            )
        : fallback.priorityIssues,
    iaRecommendation: {
      primaryGrouping:
        cleanText(iaRecommendation.primaryGrouping, 180) ||
        fallback.iaRecommendation.primaryGrouping,
      why: cleanText(iaRecommendation.why, 280) || fallback.iaRecommendation.why,
    },
    top3Flows: top3Flows.length
      ? top3Flows.map((item, index) => {
          const record = asRecord(item);
          const fallbackItem = fallback.top3Flows[Math.min(index, fallback.top3Flows.length - 1)];
          const priority = cleanText(record.priority, 4).toUpperCase();
          return {
            name: cleanText(record.name, 160) || fallbackItem.name,
            why: cleanText(record.why, 240) || fallbackItem.why,
            priority:
              priority === "P0" || priority === "P1" || priority === "P2"
                ? (priority as "P0" | "P1" | "P2")
                : fallbackItem.priority,
          };
        })
      : fallback.top3Flows,
    statePolicies: {
      loading: cleanText(statePolicies.loading, 220) || fallback.statePolicies.loading,
      empty: cleanText(statePolicies.empty, 220) || fallback.statePolicies.empty,
      error: cleanText(statePolicies.error, 220) || fallback.statePolicies.error,
      success: cleanText(statePolicies.success, 220) || fallback.statePolicies.success,
    },
    experimentPlan: cleanList(candidate.experimentPlan, 5, 220).length
      ? cleanList(candidate.experimentPlan, 5, 220)
      : fallback.experimentPlan,
    missingEvidence: cleanList(candidate.missingEvidence, 8, 220).length
      ? cleanList(candidate.missingEvidence, 8, 220)
      : fallback.missingEvidence,
    assumptions: cleanList(candidate.assumptions, 8, 220).length
      ? cleanList(candidate.assumptions, 8, 220)
      : fallback.assumptions,
  };
}

function buildPromptBundle(
  input: UxReviewRequest,
  tier: UxReviewTier,
  fallback: LiteUxReviewOutput | DeepUxReviewOutput
) {
  const responseShape =
    tier === "lite"
      ? {
          gateVerdict: "pass|revise|block",
          decision: "string",
          primaryAction: "string",
          secondaryActions: ["string"],
          p0: [
            {
              title: "string",
              userImpact: "string",
              codeOrEvidence: "string",
              recommendation: "string",
            },
          ],
          fastFixes: ["string"],
          missingEvidence: ["string"],
          assumptions: ["string"],
        }
      : {
          summary: "string",
          flowMap: [{ step: "string", userIntent: "string", risk: "string" }],
          priorityIssues: [
            {
              priority: "P0|P1|P2",
              title: "string",
              userImpact: "string",
              codeOrEvidence: "string",
              recommendation: "string",
            },
          ],
          iaRecommendation: { primaryGrouping: "string", why: "string" },
          top3Flows: [{ name: "string", why: "string", priority: "P0|P1|P2" }],
          statePolicies: { loading: "string", empty: "string", error: "string", success: "string" },
          experimentPlan: ["string"],
          missingEvidence: ["string"],
          assumptions: ["string"],
        };

  return {
    system: `You are ux-review-orchestrator, a product UX reviewer for ACP. Return strict JSON only. Follow these rules: ${CORE_PROMPT_RULES.join(
      " "
    )}`,
    user: JSON.stringify({
      tier,
      input,
      responseShape,
      fallbackReference: fallback,
    }),
  };
}

function buildMessages(
  input: UxReviewRequest,
  tier: UxReviewTier,
  fallback: LiteUxReviewOutput | DeepUxReviewOutput
) {
  const prompt = buildPromptBundle(input, tier, fallback);
  return [
    {
      role: "system",
      content: prompt.system,
    },
    {
      role: "user",
      content: prompt.user,
    },
  ];
}

export function normalizeUxReviewRequest(request: unknown, tier: UxReviewTier): UxReviewRequest {
  const record = asRecord(request);

  // Support legacy / minimal params: { url, focus } sent by ops-buyer-hub
  const url = cleanText(record.url, 400);
  const focus = cleanText(record.focus, 400);

  // Infer surfaceType from url when not explicitly provided
  let surfaceType = cleanText(record.surfaceType, 120);
  if (!surfaceType && url) {
    surfaceType = "web app";
  }

  // Infer artifactLinks from url when not provided
  let artifactLinks = cleanList(record.artifactLinks, 6, 400);
  if (artifactLinks.length === 0 && url) {
    artifactLinks = [url];
  }

  // Infer other fields from url/focus when not explicitly provided
  const productSummary = cleanText(record.productSummary, 1000) || (url ? `Product at ${url}` : "");
  const targetUser = cleanText(record.targetUser, 240) || "end user";
  const primaryGoal =
    cleanText(record.primaryGoal, 280) || focus || "complete the primary user flow";
  const primaryFlow = cleanText(record.primaryFlow, 400) || focus || "main user journey";

  return {
    surfaceType,
    productSummary,
    targetUser,
    primaryGoal,
    primaryFlow,
    artifactLinks,
    currentIA: tier === "deep" ? cleanText(record.currentIA, 1200) || "not provided" : undefined,
    coreScreensOrStates:
      tier === "deep"
        ? cleanList(record.coreScreensOrStates, 10, 180).length
          ? cleanList(record.coreScreensOrStates, 10, 180)
          : ["main screen"]
        : undefined,
    changeBudget: tier === "deep" ? cleanText(record.changeBudget, 120) || "medium" : undefined,
    successMetrics:
      tier === "deep"
        ? cleanList(record.successMetrics, 8, 160).length
          ? cleanList(record.successMetrics, 8, 160)
          : ["task completion rate"]
        : undefined,
  };
}

export function validateUxReviewRequest(request: unknown, tier: UxReviewTier): ValidationResult {
  const record = asRecord(request);
  const url = cleanText(record.url, 400);

  // Accept minimal params: at least a url OR (surfaceType + artifactLinks) must be present
  // normalizeUxReviewRequest will infer all missing fields from url/focus
  const normalized = normalizeUxReviewRequest(request, tier);

  // After normalization with defaults, only check that we have enough to proceed
  if (!normalized.surfaceType) {
    return { valid: false, reason: "surfaceType is required (or provide a url)" };
  }
  if (!normalized.artifactLinks.length) {
    return { valid: false, reason: "artifactLinks is required (or provide a url)" };
  }

  // Deep tier fields are now auto-defaulted by normalizeUxReviewRequest,
  // so no additional validation needed for deep tier
  return { valid: true };
}

export async function buildUxReviewAnalysis(
  input: UxReviewRequest,
  tier: UxReviewTier,
  options: BuildUxReviewAnalysisOptions = {}
): Promise<UxReviewAnalysisResult<LiteUxReviewOutput | DeepUxReviewOutput>> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  const model = resolveModel(env);
  const openRouterApiKey = cleanText(env.OPENROUTER_API_KEY, 400);
  const geminiApiKey = resolveGeminiApiKey(env);
  const fallbackOutput = tier === "lite" ? buildLiteFallback(input) : buildDeepFallback(input);
  const fallbackMeta = {
    provider: "fallback" as const,
    model: "rule-based",
    tier,
  };

  if (!fetchImpl) {
    return { meta: fallbackMeta, output: fallbackOutput };
  }

  if (geminiApiKey) {
    const geminiModel = resolveGeminiModel(env);
    const prompt = buildPromptBundle(input, tier, fallbackOutput);
    const endpoint = `${resolveGeminiBaseUrl(env)}/models/${geminiModel}:generateContent`;
    const requestBody = {
      systemInstruction: {
        parts: [{ text: prompt.system }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: prompt.user }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    };

    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": geminiApiKey,
        },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        return { meta: fallbackMeta, output: fallbackOutput };
      }
      const payload = (await response.json()) as Record<string, any>;
      const content = cleanText(payload?.candidates?.[0]?.content?.parts?.[0]?.text, 40000);
      const parsed = extractFirstJsonObject(content);
      if (!parsed) {
        return { meta: fallbackMeta, output: fallbackOutput };
      }
      const output =
        tier === "lite"
          ? normalizeLiteOutput(parsed, fallbackOutput as LiteUxReviewOutput)
          : normalizeDeepOutput(parsed, fallbackOutput as DeepUxReviewOutput);
      return {
        meta: {
          provider: "gemini",
          model: geminiModel,
          tier,
        },
        output,
      };
    } catch {
      return { meta: fallbackMeta, output: fallbackOutput };
    }
  }

  if (!openRouterApiKey) {
    return { meta: fallbackMeta, output: fallbackOutput };
  }

  const endpoint = `${resolveBaseUrl(env)}/chat/completions`;
  const requestBody = {
    model,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: buildMessages(input, tier, fallbackOutput),
  };

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": cleanText(env.OPENROUTER_SITE_URL, 240) || "https://app.virtuals.io",
        "X-Title": cleanText(env.OPENROUTER_APP_NAME, 160) || "ux-review-orchestrator",
      },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      return { meta: fallbackMeta, output: fallbackOutput };
    }
    const payload = (await response.json()) as Record<string, any>;
    const content = cleanText(payload?.choices?.[0]?.message?.content, 40000);
    const parsed = extractFirstJsonObject(content);
    if (!parsed) {
      return { meta: fallbackMeta, output: fallbackOutput };
    }
    const output =
      tier === "lite"
        ? normalizeLiteOutput(parsed, fallbackOutput as LiteUxReviewOutput)
        : normalizeDeepOutput(parsed, fallbackOutput as DeepUxReviewOutput);
    return {
      meta: {
        provider: "openrouter",
        model,
        tier,
      },
      output,
    };
  } catch {
    return { meta: fallbackMeta, output: fallbackOutput };
  }
}

export function buildUxReviewDeliverable(input: {
  offering: string;
  tier: UxReviewTier;
  request: UxReviewRequest;
  analysis: UxReviewAnalysisResult<LiteUxReviewOutput | DeepUxReviewOutput>;
}): ExecuteJobResult["deliverable"] {
  return {
    type: "json",
    value: {
      service: "ux-review-orchestrator",
      offering: input.offering,
      tier: input.tier,
      input: clipNonEmpty(input.request),
      ...input.analysis.output,
      analysisMeta: input.analysis.meta,
    },
  };
}

export const __testables = {
  extractFirstJsonObject,
  buildLiteFallback,
  buildDeepFallback,
  resolveModel,
  resolveGeminiModel,
};
