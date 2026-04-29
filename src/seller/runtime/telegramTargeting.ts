export type TelegramTargetLanguage = "en" | "ko";

export interface TelegramTargetRow {
  chatId: string;
  name?: string;
  username?: string;
  chatType?: string;
  source?: string;
  language?: TelegramTargetLanguage;
  enabled?: boolean;
  note?: string;
}

const REVIEW_NOTE = "review before adding to rapid_recovery_telegram_targets.json";

type TelegramChat = {
  id?: string | number;
  type?: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanChatId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return cleanString(value);
}

function cleanLanguage(value: unknown): TelegramTargetLanguage | undefined {
  const normalized = cleanString(value)?.toLowerCase();
  if (normalized === "ko") return "ko";
  if (normalized === "en") return "en";
  return undefined;
}

function chatDisplayName(chat: TelegramChat): string | undefined {
  const title = cleanString(chat.title);
  if (title) return title;
  const first = cleanString(chat.first_name);
  const last = cleanString(chat.last_name);
  if (first && last) return `${first} ${last}`;
  return first || last || cleanString(chat.username);
}

function mergeRows(base: TelegramTargetRow, next: TelegramTargetRow): TelegramTargetRow {
  return {
    chatId: base.chatId,
    name: base.name || next.name,
    username: base.username || next.username,
    chatType: base.chatType || next.chatType,
    source: base.source || next.source,
    language: base.language || next.language,
    enabled: base.enabled ?? next.enabled,
    note: base.note || next.note,
  };
}

function stripUndefined<T extends Record<string, unknown>>(row: T): T {
  const out = {} as T;
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) {
      out[key as keyof T] = value as T[keyof T];
    }
  }
  return out;
}

export function normalizeTelegramTarget(
  value: unknown,
  defaults: Partial<TelegramTargetRow> = {}
): TelegramTargetRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const chatId = cleanChatId(row.chatId);
  if (!chatId) return null;

  return stripUndefined({
    chatId,
    name: cleanString(row.name) || defaults.name,
    username: cleanString(row.username) || defaults.username,
    chatType: cleanString(row.chatType) || defaults.chatType,
    source: cleanString(row.source) || defaults.source || "manual",
    language: cleanLanguage(row.language) || defaults.language || "en",
    enabled: typeof row.enabled === "boolean" ? row.enabled : defaults.enabled,
    note: cleanString(row.note) || defaults.note,
  });
}

export function loadTelegramTargets(payload: unknown): TelegramTargetRow[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row) => normalizeTelegramTarget(row))
    .filter((row): row is TelegramTargetRow => row !== null);
}

export function isTelegramTargetEnabled(target: TelegramTargetRow): boolean {
  return target.enabled !== false;
}

export function buildRapidRecoveryTelegramMessage(target: TelegramTargetRow): string {
  if (target.language === "ko") {
    return [
      `안녕하세요 ${target.name || "운영자"}님,`,
      "timeout/validation/rejected 이슈를 1줄 입력으로 즉시 복구해드립니다.",
      "결과: 원인 분류 + retry payload + 실행 next actions(JSON).",
      "CTA: 0.02 진입(Hotfix) -> 0.05 Turbo -> 0.12 Guardrail",
    ].join("\n");
  }

  return [
    `Hi ${target.name || "there"},`,
    "One-line recovery for timeout, validation, or rejected ACP/API jobs.",
    "Return: root-cause classification + retry-safe payload + next actions (JSON).",
    "CTA: 0.02 Hotfix -> 0.05 Turbo -> 0.12 Guardrail",
  ].join("\n");
}

function readChatFromUpdate(update: Record<string, unknown>): TelegramChat | null {
  const candidates = [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "my_chat_member",
    "chat_member",
  ];

  for (const field of candidates) {
    const node = update[field];
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const chat = (node as Record<string, unknown>).chat;
    if (!chat || typeof chat !== "object" || Array.isArray(chat)) continue;
    return chat as TelegramChat;
  }
  return null;
}

export function extractTelegramSeedCandidates(payload: unknown): TelegramTargetRow[] {
  const root =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const updates = Array.isArray(root.result) ? root.result : [];
  const merged = new Map<string, TelegramTargetRow>();

  for (const update of updates) {
    if (!update || typeof update !== "object" || Array.isArray(update)) continue;
    const chat = readChatFromUpdate(update as Record<string, unknown>);
    const candidate = normalizeTelegramTarget(
      {
        chatId: cleanChatId(chat?.id),
        name: chatDisplayName(chat || {}),
        username: cleanString(chat?.username),
        chatType: cleanString(chat?.type),
      },
      {
        source: "getUpdates",
        language: "en",
        enabled: false,
        note: REVIEW_NOTE,
      }
    );
    if (!candidate) continue;

    const existing = merged.get(candidate.chatId);
    merged.set(candidate.chatId, existing ? mergeRows(existing, candidate) : candidate);
  }

  return [...merged.values()].sort((a, b) =>
    (a.name || a.chatId).localeCompare(b.name || b.chatId, "en")
  );
}

export function mergeTelegramTargets(
  existingRows: TelegramTargetRow[],
  discoveredRows: TelegramTargetRow[]
): TelegramTargetRow[] {
  const merged = new Map<string, TelegramTargetRow>();

  for (const row of existingRows) {
    const normalized = normalizeTelegramTarget(row);
    if (!normalized) continue;
    merged.set(normalized.chatId, normalized);
  }

  for (const row of discoveredRows) {
    const normalized = normalizeTelegramTarget(row, {
      source: "getUpdates",
      language: "en",
      enabled: false,
      note: REVIEW_NOTE,
    });
    if (!normalized) continue;

    const existing = merged.get(normalized.chatId);
    if (!existing) {
      merged.set(normalized.chatId, normalized);
      continue;
    }

    merged.set(
      normalized.chatId,
      {
        chatId: normalized.chatId,
        name: existing.name || normalized.name,
        username: existing.username || normalized.username,
        chatType: existing.chatType || normalized.chatType,
        source: existing.source || normalized.source,
        language: existing.language || normalized.language,
        enabled: existing.enabled ?? normalized.enabled,
        note: existing.note || normalized.note,
      }
    );
  }

  return [...merged.values()].sort((a, b) =>
    (a.name || a.chatId).localeCompare(b.name || b.chatId, "en")
  );
}
