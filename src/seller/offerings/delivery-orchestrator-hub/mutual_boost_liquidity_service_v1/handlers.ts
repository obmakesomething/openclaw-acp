import type { ExecuteJobResult, ValidationResult } from "../../../runtime/offeringTypes.js";

const OFFERING_NAME = "mutual_boost_liquidity_service_v1";

function normalizeObject(input: unknown): Record<string, any> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, any>) : {};
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

export async function executeJob(request: any): Promise<ExecuteJobResult> {
  const req = normalizeObject(request);
  const agentName = String(req.agent_name || "unknown-agent");
  const agentWallet = String(req.agent_wallet || "");

  const targetDailyBoosts = clampNumber(req.target_daily_boosts, 5, 1, 500);
  const budgetUsdc = clampNumber(req.budget_usdc, 0.2, 0.01, 5000);
  const minOffer = clampNumber(req.min_offer_price, 0.01, 0.01, 10);
  const maxOffer = clampNumber(req.max_offer_price, 0.03, minOffer, 10);

  const pricingLadder = [
    {
      tier: "onboarding_micro",
      suggestedName: "boost_onboarding_micro_v1",
      price: Number(minOffer.toFixed(2)),
      role: "max fill-rate and cold-start transactions",
    },
    {
      tier: "onboarding_basic",
      suggestedName: "boost_onboarding_basic_v1",
      price: Number(Math.min(maxOffer, minOffer + 0.01).toFixed(2)),
      role: "balanced fill-rate with slightly higher margin",
    },
    {
      tier: "signal_plus",
      suggestedName: "boost_signal_plus_v1",
      price: Number(Math.min(maxOffer, minOffer + 0.02).toFixed(2)),
      role: "retain conversion while signaling service quality",
    },
  ];

  const counterpartTargets = [
    {
      agent: "AgentHub",
      wallet: "0x803F95cC43e940548b55846BCBbAe5476d8cD8c7",
      offering: "mutual_boost",
      expectedFillProbability: 0.75,
    },
    {
      agent: "Manus - #1 ACP Marketing & Growth Agency",
      wallet: "0xBD89F06a349228FE9E67B142C4BdEb27DCf187BC",
      offering: "mutual_boost",
      expectedFillProbability: 0.7,
    },
    {
      agent: "GrowthForge",
      wallet: "0xB3be81fB1DaE557A65dfF57F3cCCCc9Cc05842eF",
      offering: "mutual_boost_micro",
      expectedFillProbability: 0.65,
    },
  ];

  const blendedPrice = pricingLadder.reduce((acc, item) => acc + item.price, 0) / pricingLadder.length;
  const theoreticalBoostCapacity = Math.floor(budgetUsdc / Math.max(blendedPrice, 0.01));
  const expectedDailyBoosts = Math.min(targetDailyBoosts, theoreticalBoostCapacity);
  const expectedUniqueBuyerDelta7d = Math.max(1, Math.floor(expectedDailyBoosts * 0.4));

  return {
    deliverable: {
      type: "json",
      value: {
        service: "mutual-boost-liquidity",
        offering: OFFERING_NAME,
        target: {
          agentName,
          agentWallet,
        },
        strategy: {
          targetDailyBoosts,
          budgetUsdc,
          priceBand: {
            min: Number(minOffer.toFixed(2)),
            max: Number(maxOffer.toFixed(2)),
          },
          pricingLadder,
          counterpartTargets,
          executionRules: [
            "Route first to highest fill-probability counterpart.",
            "Retry rejected/expired jobs with next counterpart within 15 minutes.",
            "Keep at least one 0.01-tier offer always listed for reciprocal compatibility.",
          ],
        },
        forecast: {
          theoreticalBoostCapacity,
          expectedDailyBoosts,
          expectedUniqueBuyerDelta7d,
        },
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

  const target = Number(req.target_daily_boosts);
  if (!Number.isFinite(target) || target <= 0) {
    return { valid: false, reason: "target_daily_boosts must be > 0" };
  }

  const budget = Number(req.budget_usdc);
  if (!Number.isFinite(budget) || budget < 0.01) {
    return { valid: false, reason: "budget_usdc must be >= 0.01" };
  }

  return { valid: true };
}

export function requestPayment(): string {
  return "Mutual boost liquidity request accepted. Building low-tier offer ladder and reciprocal execution map.";
}
