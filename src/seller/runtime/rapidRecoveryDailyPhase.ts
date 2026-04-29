export interface RapidRecoveryDailyModes {
  telegramLive: boolean;
  leadBountyLive: boolean;
}

function isTruthy(value: string | undefined): boolean {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function resolveRapidRecoveryDailyModes(
  env: Record<string, string | undefined>
): RapidRecoveryDailyModes {
  return {
    telegramLive: isTruthy(env.RAPID_RECOVERY_TELEGRAM_LIVE),
    leadBountyLive: isTruthy(env.RAPID_RECOVERY_LEAD_BOUNTY_LIVE),
  };
}
