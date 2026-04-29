import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const OFFERING_NAME = "acp_listing_seo_offer_packaging_v1";

function normalizeObject(input: unknown): Record<string, any> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, any>) : {};
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((v) => String(v).trim()).filter(Boolean);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const req = normalizeObject(request);

  const agentName = String(req.agent_name || "unknown-agent");
  const category = String(req.category || "general");
  const targetAudience = String(req.target_audience || "builders");

  const capabilities = normalizeStringArray(req.core_capabilities);
  const primary = capabilities.slice(0, 3);

  const keywordClusters = {
    primary: primary.length ? primary : ["acp automation", "agent operations", "workflow orchestration"],
    intent: ["fast turnaround", "verified deliverable", "automation-ready"],
    category: [category, `${category} automation`, `${category} agent service`],
    conversion: ["fixed-fee", "clear SLA", "easy integration"],
  };

  const optimizedDescription =
    `${agentName} delivers ${keywordClusters.primary.join(", ")} with a ${category}-focused ACP operating model. ` +
    `Built for ${targetAudience}, the service lineup combines clear pricing, explicit deliverables, and fast execution loops. ` +
    `Keywords: ${[
      ...keywordClusters.primary,
      ...keywordClusters.category,
      ...keywordClusters.conversion,
    ].join(", ")}.`;

  const packagedOffers = [
    {
      tier: "entry",
      suggestedName: `${slugify(category)}_quick_entry_v1`,
      suggestedPrice: 0.03,
      valueProp: "Low-friction first transaction and quick proof-of-value",
    },
    {
      tier: "core",
      suggestedName: `${slugify(category)}_core_conversion_v1`,
      suggestedPrice: 0.09,
      valueProp: "Best balance between conversion and margin",
    },
    {
      tier: "premium",
      suggestedName: `${slugify(category)}_premium_control_v1`,
      suggestedPrice: 0.25,
      valueProp: "High-touch enterprise use case with stronger SLA guarantees",
    },
  ];

  const titleVariants = [
    `${agentName}: ${category} automation for ACP buyers`,
    `${agentName} | ${category} operations with fixed-fee delivery`,
    `${agentName} - ${category} control plane for fast ACP execution`,
  ];

  return {
    deliverable: {
      type: "json",
      value: {
        service: "acp-listing-seo-packaging",
        offering: OFFERING_NAME,
        optimizedDescription,
        keywordClusters,
        titleVariants,
        packagedOffers,
        rolloutChecklist: [
          "Update profile description with optimized copy.",
          "Rename offers to standardized lowercase keyword names.",
          "Align entry/core/premium tiers to 0.03/0.09/0.25 price anchors.",
          "Run promote_agent after listing update to test conversion lift.",
        ],
      },
    },
  };
}

export function validateRequirements(request: any): ValidationResult {
  const req = normalizeObject(request);
  const desc = String(req.current_description || "").trim();
  if (!desc) {
    return { valid: false, reason: "current_description is required" };
  }

  const caps = normalizeStringArray(req.core_capabilities);
  if (!caps.length) {
    return { valid: false, reason: "core_capabilities must include at least one capability" };
  }

  return { valid: true };
}

export function requestPayment(): string {
  return "Listing SEO + Offer Packaging request accepted. Generating optimized copy, keyword clusters, and tiered offer structure.";
}
