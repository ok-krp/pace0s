export type AccountSyncStorageKeys = {
  queue: string;
  metadata: string;
};

/**
 * Durable sync bookkeeping must never be shared between authenticated users.
 * The legacy unscoped keys are intentionally not read: they do not record an
 * owner, so replaying them after an account switch could upload another
 * account's pending key names under the newly authenticated user.
 */
export function accountSyncStorageKeys(userId: string): AccountSyncStorageKeys {
  if (!userId.trim()) throw new Error("A user ID is required for sync storage");
  const scope = encodeURIComponent(userId);
  return {
    queue: `pace.__sync_queue:${scope}`,
    metadata: `pace.__sync_meta:${scope}`,
  };
}

export function parseSyncQueue(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((key): key is string => typeof key === "string" && key.startsWith("pace.")))];
  } catch {
    return [];
  }
}

export function parseSyncMetadata(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([key, timestamp]) =>
        key.startsWith("pace.") && typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp)),
      ),
    );
  } catch {
    return {};
  }
}
