
/**
 * Keys under the reserved sync namespace are client bookkeeping, not user
 * domain state. The native client already excludes this namespace; the Web
 * queue and remote pull must enforce the same boundary.
 */
export function isSyncableLocalKey(key: string): boolean {
  return key.startsWith("pace.") &&
    !key.startsWith("pace.__sync_") &&
    !key.startsWith("pace.__nutrition_cache:");
}

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
    return [...new Set(value.filter((key): key is string => typeof key === "string" && isSyncableLocalKey(key)))];
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
        key.startsWith("pace.") &&
        typeof timestamp === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) &&
        Number.isFinite(Date.parse(timestamp)),
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Returns an overlap cursor for incremental pulls. A future-dated watermark is
 * capped at the current time so a device clock skew cannot suppress updates
 * indefinitely or force an expensive full scan on every fallback poll.
 */
export function syncPullCursor(
  metadata: Record<string, string>,
  nowMs = Date.now(),
  overlapMs = 5 * 60 * 1000,
): string | null {
  if (!Number.isFinite(nowMs) || !Number.isFinite(overlapMs) || overlapMs < 0) {
    throw new RangeError("nowMs and overlapMs must be finite, with a non-negative overlap");
  }

  let newest = Number.NEGATIVE_INFINITY;
  for (const timestamp of Object.values(metadata)) {
    const parsed = Date.parse(timestamp);
    if (Number.isFinite(parsed) && parsed > newest) newest = parsed;
  }

  if (!Number.isFinite(newest)) return null;
  return new Date(Math.max(0, Math.min(newest, nowMs) - overlapMs)).toISOString();
}

export type SyncPullPlan = {
  fullReconciliation: boolean;
  cursor: string | null;
};

/**
 * Plans a bounded incremental pull, using the latest per-key watermark and
 * the last successful full scan as independent recovery anchors.
 */
export function syncPullPlan(
  metadata: Record<string, string>,
  lastFullAt: number,
  nowMs = Date.now(),
  overlapMs = 5 * 60 * 1000,
  fullIntervalMs = 24 * 60 * 60 * 1000,
): SyncPullPlan {
  if (
    !Number.isFinite(lastFullAt) ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(overlapMs) ||
    overlapMs < 0 ||
    !Number.isFinite(fullIntervalMs) ||
    fullIntervalMs < 1
  ) {
    throw new RangeError("Sync pull timestamps and intervals must be finite and non-negative");
  }

  const metadataCursor = syncPullCursor(metadata, nowMs, overlapMs);
  const lastFullCursor = lastFullAt > 0
    ? new Date(Math.max(0, Math.min(lastFullAt, nowMs) - overlapMs)).toISOString()
    : null;
  const candidates = [metadataCursor, lastFullCursor].filter(
    (value): value is string => value !== null,
  );
  const cursor = candidates.reduce<string | null>(
    (newest, value) =>
      newest === null || Date.parse(value) > Date.parse(newest) ? value : newest,
    null,
  );

  const fullReconciliation =
    lastFullAt <= 0 ||
    nowMs < lastFullAt ||
    nowMs - lastFullAt >= fullIntervalMs;

  return { fullReconciliation, cursor };
}

/**
 * A queued push may finish after a newer local edit was enqueued for the same
 * key. Only the latest invocation is allowed to acknowledge that key's outbox
 * entry or apply a conflict response over local state.
 */
export function isLatestKeyWrite(attemptedVersion: number, latestVersion: number): boolean {
  return Number.isSafeInteger(attemptedVersion) &&
    attemptedVersion > 0 &&
    Number.isSafeInteger(latestVersion) &&
    latestVersion > 0 &&
    attemptedVersion === latestVersion;
}

/**
 * Ensures two local edits of the same key cannot share an updated_at value
 * when they are queued within one clock millisecond. The server RPC uses a
 * strict newest-wins comparison, so equal timestamps would otherwise turn a
 * later local edit into a conflict with the earlier one.
 */
export function nextSyncWriteTimestamp(nowMs: number, previousTimestamp?: string): string {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new RangeError("nowMs must be a non-negative finite timestamp");
  }

  const previousMs = previousTimestamp ? Date.parse(previousTimestamp) : Number.NaN;
  const nextMs = Number.isFinite(previousMs)
    ? Math.max(nowMs, previousMs + 1)
    : nowMs;
  return new Date(nextMs).toISOString();
}
