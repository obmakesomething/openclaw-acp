import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const OFFERING_NAME = "acp_growth_ops_success_fee_v1";

function normalizeObject(input: unknown): Record<string, any> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, any>) : {};
}

function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.map((v) => String(v)).filter(Boolean);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function chooseProviders(mode: string) {
  const baseline = [
    {
      agent: "Manus - #1 ACP Marketing & Growth Agency",
      wallet: "0xBD89F06a349228FE9E67B142C4BdEb27DCf187BC",
      offering: "promote_agent",
      price: 0.1,
      purpose: "high-visibility promotional distribution",
    },
    {
      agent: "AgentHub",
      wallet: "0x803F95cC43e940548b55846BCBbAe5476d8cD8c7",
      offering: "promote_agent",
      price: 0.2,
      purpose: "keyword-targeted outbound promotion",
    },
    {
      agent: "GrowthForge",
      wallet: "0xB3be81fB1DaE557A65dfF57F3cCCCc9Cc05842eF",
      offering: "growth_audit",
      price: 0.05,
      purpose: "positioning and conversion diagnosis",
    },
  ];

  if (mode === "safe") {
    return baseline;
  }

  if (mode === "aggressive") {
    return [
      ...baseline,
      {
        agent: "ACPilot",
        wallet: "0x72dC31061751A5F93A0B57E37DF951de2De14b94",
        offering: "promote_agent",
        price: 0.05,
        purpose: "low-cost additional reach",
      },
      {
        agent: "GrowthForge",
        wallet: "0xB3be81fB1DaE557A65dfF57F3cCCCc9Cc05842eF",
        offering: "mutual_boost_micro",
        price: 0.01,
        purpose: "quick transaction history velocity",
      },
    ];
  }

  return [
    ...baseline,
    {
      agent: "ACPilot",
      wallet: "0x72dC31061751A5F93A0B57E37DF951de2De14b94",
      offering: "promote_agent",
      price: 0.05,
      purpose: "cost-efficient incremental awareness",
    },
  ];
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const req = normalizeObject(request);

  const agentName = String(req.agent_name || "unknown-agent");
  const agentWallet = String(req.agent_wallet || "");
  const goalDelta = clampNumber(req.goal_unique_buyer_delta, 2, 1, 100);
  const budget = clampNumber(req.budget_usdc, 0.5, 0.05, 5000);
  const campaignDays = clampNumber(req.campaign_days, 7, 1, 90);
  const riskMode = ["safe", "balanced", "aggressive"].includes(String(req.risk_mode))
    ? String(req.risk_mode)
    : "balanced";

  const preferredChannels = normalizeStringArray(req.preferred_channels);
  const providers = chooseProviders(riskMode);

  const perWaveBudget = Number((budget / 3).toFixed(3));
  const retryBudget = Number((budget * (riskMode === "aggressive" ? 0.2 : 0.1)).toFixed(3));

  const baselineMetrics = normalizeObject(req.current_metrics);
  const baselineUniqueBuyer = clampNumber(baselineMetrics.unique_buyers, 0, 0, 1000000);

  const successFeeTerms = {
    model: "pay-on-growth",
    trigger: `uniqueBuyer increases by >= ${goalDelta} within ${campaignDays} days`,
    feeRule: "If trigger met, charge 15% of incremental ACP revenue from new buyers; otherwise 0 success fee.",
    settlementWindowDays: 3,
  };

  const waves = [
    {
      wave: 1,
      objective: "Discovery and messaging fit",
      budgetCapUsdc: perWaveBudget,
      actions: ["promote_agent", "seo_check", "visibility_score"],
      kpiGate: ">=1 qualified inbound inquiry or >=0.5 expected uniqueBuyer uplift",
    },
    {
      wave: 2,
      objective: "Conversion lift",
      budgetCapUsdc: perWaveBudget,
      actions: ["promote_agent", "mutual_boost", "growth_audit"],
      kpiGate: ">=40% acceptance rate on outbound promotion targets",
    },
    {
      wave: 3,
      objective: "Scale and stabilize",
      budgetCapUsdc: perWaveBudget,
      actions: ["promote_agent", "mutual_boost", "retry_failed_paths"],
      kpiGate: `uniqueBuyer baseline ${baselineUniqueBuyer} -> ${baselineUniqueBuyer + goalDelta}`,
    },
  ];

  return {
    deliverable: {
      type: "json",
      value: {
        service: "acp-growth-ops",
        offering: OFFERING_NAME,
        target: {
          agentName,
          agentWallet,
        },
        campaign: {
          days: campaignDays,
          budgetUsdc: budget,
          riskMode,
          preferredChannels,
          retryBudgetUsdc: retryBudget,
        },
        providerMatrix: providers,
        executionWaves: waves,
        successFeeTerms,
        nextActions: [
          "Run wave 1 and collect acceptance/response logs.",
          "Retry expired or rejected providers with alternate provider paths.",
          "Settle success fee only if uniqueBuyer delta trigger is met.",
        ],
      },
    },
  };
}

export function validateRequirements(request: any): ValidationResult {
  const req = normalizeObject(request);
  const wallet = String(req.agent_wallet || "");
  if (!wallet.startsWith("0x")) {
    return { valid: false, reason: "agent_wallet must be a valid 0x address string" };
  }

  const goalDelta = Number(req.goal_unique_buyer_delta);
  if (!Number.isFinite(goalDelta) || goalDelta <= 0) {
    return { valid: false, reason: "goal_unique_buyer_delta must be > 0" };
  }

  const budget = Number(req.budget_usdc);
  if (!Number.isFinite(budget) || budget < 0.05) {
    return { valid: false, reason: "budget_usdc must be >= 0.05" };
  }

  return { valid: true };
}

export function requestPayment(): string {
  return "Growth Ops campaign accepted. Generating multi-agent execution and success-fee settlement plan.";
}
