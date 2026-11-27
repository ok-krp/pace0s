import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { createPrivateRealtimeChannel, supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";
import { readDomain, sanitizeNutritionItems } from "@/lib/domain-store";

const PACE_PREFIX = "pace.";
const INTERNAL_PREFIX = "pace.__";
const DOMAIN_PREFIX = "pace.domain.";
const DOMAIN_OUTBOX_KEY = "pace.domain.outbox";
function keyPrefixRegex(prefix: string) {
  // Prefixes contain literal dots and underscores; a regex keeps underscores
  // literal (unlike SQL LIKE, where _ is a one-character wildcard).
  return `^${prefix.replaceAll(".", "[.]")}`;
}
const DEVICE_LOCAL_SYNC_KEYS = [
  "pace.sport.active",
  "pace.legal.consent",
  "pace.billing.device_id",
  "pace.watch.last_metrics",
  "pace.ai.conversations",
  "pace.ai.deleted_conversations",
  DOMAIN_OUTBOX_KEY,
] as const;
const DEVICE_LOCAL_SYNC_PREFIXES = [
  "pace.__",
  "pace.ai.pending:",
  "pace.ai.debug",
  "pace.local-ai.",
  "pace.ai.local.",
  "pace.privacy.",
  "pace.finance.",
  "pace.ble.",
  "pace.import.",
] as const;
const DEVICE_LOCAL_DOMAIN_SYNC_KEYS = DEVICE_LOCAL_SYNC_KEYS
  .filter((key) => !key.startsWith(DOMAIN_PREFIX))
  .map((key) => `${DOMAIN_PREFIX}${key.slice(PACE_PREFIX.length)}`);
const LEGACY_DEVICE_LOCAL_SYNC_KEYS = DEVICE_LOCAL_SYNC_KEYS.map(
  (key) => `lt.${key.slice(PACE_PREFIX.length)}`,
);
const LEGACY_DEVICE_LOCAL_DOMAIN_SYNC_KEYS = DEVICE_LOCAL_DOMAIN_SYNC_KEYS.map(
  (key) => `lt.${key.slice(PACE_PREFIX.length)}`,
);
const DEVICE_LOCAL_DOMAIN_SYNC_PREFIXES = DEVICE_LOCAL_SYNC_PREFIXES.map(
  (prefix) => `${DOMAIN_PREFIX}${prefix.slice(PACE_PREFIX.length)}`,
);
const ALL_DEVICE_LOCAL_SYNC_PREFIXES = [
  ...DEVICE_LOCAL_SYNC_PREFIXES,
  ...DEVICE_LOCAL_DOMAIN_SYNC_PREFIXES,
] as const;
const DEVICE_LOCAL_PULL_KEYS = [
  ...DEVICE_LOCAL_SYNC_KEYS,
  ...LEGACY_DEVICE_LOCAL_SYNC_KEYS,
  ...DEVICE_LOCAL_DOMAIN_SYNC_KEYS,
  ...LEGACY_DEVICE_LOCAL_DOMAIN_SYNC_KEYS,
] as const;
const DEVICE_LOCAL_PULL_FILTER = `(${DEVICE_LOCAL_PULL_KEYS.map((key) => `"${key}"`).join(",")})`;
const EXCLUDED = new Set<string>(DEVICE_LOCAL_SYNC_KEYS);
const QUEUE_KEY = "pace.__sync_queue";
const META_KEY = "pace.__sync_meta";
const DEVICE_KEY = "pace.__sync_device_id";
const DEVICE_ID = getDeviceId();
const CONFLICTS_KEY = "pace.__sync_conflicts";

type SyncMeta = Record<string, string>;
export type SyncStatus = "idle" | "syncing" | "ok" | "error" | "offline";
export type SyncConflict = { id: string; key: string; localValue: unknown; remoteValue: unknown; remoteUpdatedAt: string; detectedAt: string; };
type SyncRow = { key: string; value: unknown; updated_at: string; updated_by: string | null };
type ServerWriteResult = { accepted: boolean; updated_at: string | null };
type QueueItem = { key: string; value: unknown; updatedAt: string; mutationId?: string; ownerUserId?: string };
type LegacyQueue = string[] | QueueItem[];
type DomainRecord = { version: 1; updatedAt: string; mutationId: string; value: unknown };

function getDeviceId() {
  if (typeof window === "undefined") return "server";
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch { return `${Date.now()}-${Math.random()}`; }
}
function isDeviceLocalSyncKey(key: string) {
  const canonicalKey = key.startsWith("lt.") ? `${PACE_PREFIX}${key.slice("lt.".length)}` : key;
  const domainCanonicalKey = canonicalKey.startsWith(DOMAIN_PREFIX)
    ? `${PACE_PREFIX}${canonicalKey.slice(DOMAIN_PREFIX.length)}`
    : canonicalKey;
  return EXCLUDED.has(canonicalKey) ||
    EXCLUDED.has(domainCanonicalKey) ||
    ALL_DEVICE_LOCAL_SYNC_PREFIXES.some((prefix) => canonicalKey.startsWith(prefix));
}
function isSyncableKey(key: string) {
  return key.startsWith(PACE_PREFIX) &&
    !key.startsWith(INTERNAL_PREFIX) &&
    key !== DOMAIN_OUTBOX_KEY &&
    !isDeviceLocalSyncKey(key);
}
function readWallpaperCandidate(key: string, value: unknown): unknown {
  const canonicalKey = key.startsWith("lt.") ? `pace.${key.slice(3)}` : key;
  if (!["pace.wallpaper", "pace.domain.wallpaper"].includes(canonicalKey)) return undefined;
  let candidate = value;
  while (candidate && typeof candidate === "object" && "value" in candidate &&
      "version" in candidate && (candidate as { version?: unknown }).version === 1) {
    candidate = (candidate as { value: unknown }).value;
  }
  return candidate;
}
function isInlineWallpaperValue(key: string, value: unknown) {
  const candidate = readWallpaperCandidate(key, value);
  if (!candidate || typeof candidate !== "object" || !("kind" in candidate) ||
      (candidate as { kind?: unknown }).kind !== "custom") return false;
  const wallpaper = candidate as {
    dataUrl?: unknown;
    localPath?: unknown;
    storagePath?: unknown;
  };
  // A custom wallpaper is portable only when it references an object in the
  // account-private Storage bucket. Reject legacy inline bytes, native paths,
  // and malformed custom records before queueing or applying remote state.
  return (
    typeof wallpaper.dataUrl === "string" ||
    typeof wallpaper.localPath === "string" ||
    typeof wallpaper.storagePath !== "string" ||
    wallpaper.storagePath.trim().length === 0
  );
}
function isWallpaperPathOwnedByUser(key: string, value: unknown, userId: string) {
  const candidate = readWallpaperCandidate(key, value);
  if (!candidate || typeof candidate !== "object" || !("kind" in candidate) ||
      (candidate as { kind?: unknown }).kind !== "custom") return true;
  const storagePath = (candidate as { storagePath?: unknown }).storagePath;
  return typeof storagePath === "string" && storagePath.startsWith(`${userId}/`);
}
function isSyncableRecord(key: string, value: unknown, userId: string) {
  return isSyncableKey(key) &&
    !isInlineWallpaperValue(key, value) &&
    isWallpaperPathOwnedByUser(key, value, userId);
}
function scopedSyncStorageKey(base: string, userId: string) {
  return `${base}:account:${encodeURIComponent(userId)}`;
}
function readScopedSyncValue<T>(base: string, userId: string, fallback: T): T {
  const scopedKey = scopedSyncStorageKey(base, userId);
  try {
    const scoped = localStorage.getItem(scopedKey);
    if (scoped !== null) return JSON.parse(scoped) as T;

    // One-time compatibility claim for the old unscoped browser queue/meta.
    // This preserves the existing user's pending work without sharing it with
    // any later account that signs into the same browser profile.
    const legacy = localStorage.getItem(base);
    if (legacy !== null) {
      const parsed = JSON.parse(legacy) as T;
      localStorage.setItem(scopedKey, JSON.stringify(parsed));
      localStorage.removeItem(base);
      return parsed;
    }
  } catch {}
  return fallback;
}
function writeScopedSyncValue<T>(base: string, userId: string, value: T) {
  try {
    localStorage.setItem(scopedSyncStorageKey(base, userId), JSON.stringify(value));
  } catch {}
}
function readQueue(userId: string): QueueItem[] {
  try {
    const raw = readScopedSyncValue<LegacyQueue>(QUEUE_KEY, userId, []);
    if (!Array.isArray(raw)) return [];
    const meta = readMeta(userId);
    return raw.flatMap((item) => {
      if (typeof item === "string") {
        const timestamp = meta[item];
        if (!timestamp) return [];
        let value: unknown;
        try { value = JSON.parse(localStorage.getItem(item) ?? "null"); } catch { value = null; }
        return isSyncableRecord(item, value, userId)
          ? [{ key: item, value, updatedAt: timestamp, ownerUserId: userId }]
          : [];
      }
      if (!item?.key || !item?.updatedAt) return [];
      if (item.ownerUserId && item.ownerUserId !== userId) return [];
      return isSyncableRecord(item.key, item.value, userId)
        ? [{ ...item, ownerUserId: userId }]
        : [];
    });
  } catch { return []; }
}
function writeQueue(items: QueueItem[], userId: string) {
  writeScopedSyncValue(
    QUEUE_KEY,
    userId,
    items
      .filter((item) => isSyncableRecord(item.key, item.value, userId) && (!item.ownerUserId || item.ownerUserId === userId))
      .map((item) => ({ ...item, ownerUserId: userId })),
  );
}
function queueItem(item: QueueItem, userId: string) {
  if (!isSyncableRecord(item.key, item.value, userId) || !item.updatedAt) return;
  const next = readQueue(userId).filter((queued) => queued.key !== item.key);
  next.push({ ...item, ownerUserId: userId });
  writeQueue(next, userId);
}
function getQueued(key: string, userId: string) {
  return readQueue(userId).find((item) => item.key === key);
}
function unqueueIfMutation(key: string, updatedAt: string, userId: string) {
  writeQueue(
    readQueue(userId).filter((item) => !(item.key === key && item.updatedAt === updatedAt)),
    userId,
  );
}
function readMeta(userId: string): SyncMeta {
  return readScopedSyncValue<SyncMeta>(META_KEY, userId, {});
}
function writeMeta(meta: SyncMeta, userId: string) {
  writeScopedSyncValue(META_KEY, userId, meta);
}
function markVersion(key: string, timestamp: string, userId: string) {
  const meta = readMeta(userId);
  meta[key] = timestamp;
  writeMeta(meta, userId);
}
function readConflicts(userId: string): SyncConflict[] {
  const raw = readScopedSyncValue<SyncConflict[]>(CONFLICTS_KEY, userId, []);
  return Array.isArray(raw) ? raw.filter((item) => item?.id && item?.key) : [];
}
function writeConflicts(items: SyncConflict[], userId: string) {
  writeScopedSyncValue(CONFLICTS_KEY, userId, items.slice(-20));
}
function conflictForKey(key: string, userId: string): SyncConflict | undefined {
  return readConflicts(userId).find((item) => item.key === key);
}

function readDomainRecord(key: string): DomainRecord | null {
  try {
    const storageKey = key.startsWith(DOMAIN_PREFIX) ? key : `${DOMAIN_PREFIX}${key.slice(PACE_PREFIX.length)}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const record = JSON.parse(raw) as DomainRecord;
    return record?.version === 1 && typeof record.updatedAt === "string" ? record : null;
  } catch { return null; }
}

function mergeRecoveredValues(legacy: unknown, current: unknown): unknown {
  if (current == null) return legacy;
  if (legacy == null) return current;
  if (Array.isArray(current) && Array.isArray(legacy)) {
    const currentIds = new Set(current.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? "") : "").filter(Boolean));
    const output = [...current];
    for (const item of legacy) {
      const id = item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? "") : "";
      if (id ? !currentIds.has(id) : !output.some((existing) => serialize(existing) === serialize(item))) {
        output.push(item);
        if (id) currentIds.add(id);
      }
    }
    return output;
  }
  if (typeof current === "object" && !Array.isArray(current) && typeof legacy === "object" && !Array.isArray(legacy)) {
    const output: Record<string, unknown> = { ...(current as Record<string, unknown>) };
    for (const [key, legacyValue] of Object.entries(legacy as Record<string, unknown>)) {
      output[key] = key in output ? mergeRecoveredValues(legacyValue, output[key]) : legacyValue;
    }
    return output;
  }
  return current;
}

function isEmptyRecoveredValue(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}
function serialize(value: unknown): string | undefined {
  try {
    const seen = new WeakSet<object>();
    const normalize = (input: unknown): unknown => {
      if (input === null || typeof input !== "object") return input;
      if (seen.has(input)) throw new TypeError("circular sync value");
      seen.add(input);
      try {
        if (Array.isArray(input)) return input.map(normalize);
        const object = input as Record<string, unknown>;
        if (
          object.version === 1 &&
          typeof object.updatedAt === "string" &&
          typeof object.mutationId === "string" &&
          "value" in object
        ) {
          return normalize(object.value);
        }
        return Object.fromEntries(
          Object.keys(object).sort().map((key) => [key, normalize(object[key])]),
        );
      } finally {
        seen.delete(input);
      }
    };
    return JSON.stringify(normalize(value));
  } catch {
    return undefined;
  }
}
function unwrapNutritionValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.version === 1 && typeof candidate.updatedAt === "string" && typeof candidate.mutationId === "string" && "value" in candidate) return candidate.value;
  return value;
}

function mergeNutritionRemoteValue(incomingValue: unknown) {
  // user_state stores the complete daily projection, not a patch. Treat each
  // monotonic remote write as authoritative so explicit item deletions converge.
  return sanitizeNutritionItems(unwrapNutritionValue(incomingValue));
}


export function useCloudSyncEngineInternal() {
  const { user, session } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const running = useRef<Record<string, boolean>>({});
  const keyWrites = useRef<Record<string, Promise<void>>>({});
  const lastRemoteValues = useRef<Record<string, string>>({});

  const rememberRemote = (key: string, value: unknown, userId: string) => {
    const encoded = serialize(value);
    if (encoded !== undefined) lastRemoteValues.current[userId + ":" + key] = encoded;
  };
  const applyRemoteAndRemember = (key: string, value: unknown, updatedAt: string) => {
    const safeValue = key === "pace.nutrition.items" ? mergeNutritionRemoteValue(value) : value;
    if (user) rememberRemote(key, safeValue, user.id);
    applyRemoteWrite(key, safeValue, updatedAt);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!user) {
      setConflicts([]);
      setStatus("idle");
      return;
    }
    setConflicts(readConflicts(user.id));
    setStatus("idle");
    let cancelled = false;
    const allowed = () => { try { return isLegalCategoryAllowed("sync_cloud"); } catch { return false; } };

    const recordConflict = (key: string, localValue: unknown, remoteValue: unknown, remoteUpdatedAt: string) => {
      const currentConflicts = readConflicts(user.id);
      if (serialize(localValue) === serialize(remoteValue)) {
        const remaining = currentConflicts.filter((item) => item.key !== key);
        if (remaining.length !== currentConflicts.length) {
          writeConflicts(remaining, user.id);
          setConflicts(remaining);
        }
        return;
      }
      const existing = conflictForKey(key, user.id);
      if (existing && serialize(existing.remoteValue) === serialize(remoteValue) && serialize(existing.localValue) === serialize(localValue)) return;
      const next: SyncConflict = { id: `${key}:${Date.now()}`, key, localValue, remoteValue, remoteUpdatedAt, detectedAt: new Date().toISOString() };
      const all = [...currentConflicts.filter((item) => item.key !== key), next];
      writeConflicts(all, user.id);
      setConflicts(all);
    };

    const pruneEquivalentConflicts = () => {
      const currentConflicts = readConflicts(user.id);
      const remaining = currentConflicts.filter((item) => serialize(item.localValue) !== serialize(item.remoteValue));
      if (remaining.length !== currentConflicts.length) {
        writeConflicts(remaining, user.id);
        setConflicts(remaining);
      }
      return remaining;
    };

    const writeItem = async (item: QueueItem): Promise<boolean> => {
      if (conflictForKey(item.key, user.id)) return false;

      // Let the monotonic RPC be the single write authority. Avoid a pre-write
      // SELECT on every queued mutation; if the server rejects the write because
      // a newer row exists, fetch that row once to reconcile the client.
      const result = await supabase.rpc("upsert_user_state_if_newer", {
        p_user_id: user.id,
        p_key: item.key,
        p_value: item.value as Json,
        // Kept for RPC compatibility. Ordering is server-authoritative.
        p_updated_at: item.updatedAt,
        p_updated_by: DEVICE_ID,
      });
      if (result?.error) {
        console.error("[Pace sync] user_state RPC rejected a write", {
          key: item.key,
          code: result.error.code,
          message: result.error.message,
        });
        throw result.error;
      }
      const responseData: unknown = result?.data;
      const payload: ServerWriteResult | null =
        typeof responseData === "boolean"
          ? { accepted: responseData, updated_at: item.updatedAt }
          : responseData && typeof responseData === "object"
            ? (responseData as ServerWriteResult)
            : null;
      if (
        !payload ||
        typeof payload.accepted !== "boolean" ||
        typeof payload.updated_at !== "string" ||
        payload.updated_at.length === 0
      ) {
        throw new Error("invalid cloud sync write response");
      }
      if (!payload.accepted) {
        const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id).eq("key", item.key).limit(1);
        if (error) throw error;
        const row = data?.[0] as SyncRow | undefined;
        if (!row) throw new Error("cloud sync row disappeared");
        // A stale local timestamp is not permission to discard local intent.
        // Keep the queued mutation and expose an explicit conflict for resolution;
        // do not hydrate the remote snapshot over the user's pending local value.
        recordConflict(row.key, item.value, row.value, row.updated_at);
        markVersion(row.key, row.updated_at, user.id);
        return false;
      }
      markVersion(item.key, payload.updated_at, user.id);
      localStorage.setItem("pace.__last_sync_at", payload.updated_at);
      return true;
    };

    const pushItem = async (item: QueueItem) => {
      if (cancelled || !allowed() || !isSyncableRecord(item.key, item.value, user.id) || !navigator.onLine) return;
      const writeKey = `${user.id}:${item.key}`;
      const previous = keyWrites.current[writeKey] ?? Promise.resolve();
      const current = previous.then(async () => {
        if (cancelled || !allowed() || !navigator.onLine) return;
        const latest = getQueued(item.key, user.id);
        if (!latest || latest.updatedAt !== item.updatedAt) return;
        setStatus("syncing");
        let accepted = false;
        try {
          accepted = await writeItem(latest);
        } catch (error) {
          console.error("[Pace sync] queued write failed", {
            key: latest.key,
            message: error instanceof Error ? error.message : "unknown error",
          });
          throw new Error("cloud write failed");
        }
        if (cancelled) return;
        if (accepted) {
          localStorage.setItem("pace.__last_sync_at", readMeta(user.id)[latest.key] ?? latest.updatedAt);
          // Remove only the exact mutation the server acknowledged.
          unqueueIfMutation(latest.key, latest.updatedAt, user.id);
          setStatus("ok");
        } else {
          // Rejected writes remain durable in the outbox until conflict resolution.
          setStatus("error");
        }
      });
      keyWrites.current[writeKey] = current.catch(() => undefined);
      try { await current; } catch { if (!cancelled) setStatus(navigator.onLine ? "error" : "offline"); }
    };

    const flushQueue = async () => {
      if (cancelled || !allowed() || !navigator.onLine || running.current[user.id]) return;
      const queue = readQueue(user.id);
      if (!queue.length) return;
      running.current[user.id] = true;
      try { await Promise.all(queue.map((item) => pushItem(item))); } finally { running.current[user.id] = false; }
    };

    const pull = async () => {
      if (cancelled || !allowed() || !navigator.onLine || running.current[user.id]) return;
      try {
        // A full user_state snapshot can contain large Nutrition/Health JSON.
        // Bootstrap once per account, then fetch only recent changes. Keep a
        // two-minute overlap to tolerate small clock skew and writes racing a
        // previous pull; The 60-second filtered pull is the remote-state reconciliation path.
        const pullCursorKey = `pace.__cloud_sync_last_pull:${user.id}`;
        const previousPullAt = localStorage.getItem(pullCursorKey);
        const pullStartedAt = Date.now();
        let request = supabase.from("user_state")
          .select("key,value,updated_at,updated_by")
          .eq("user_id", user.id)
          // Filter device-local state in PostgREST before JSONB values cross
          // the network; checking only after download still incurs egress.
          .not("key", "in", DEVICE_LOCAL_PULL_FILTER);
        for (const prefix of ALL_DEVICE_LOCAL_SYNC_PREFIXES) {
          const legacyPrefix = `lt.${prefix.slice(PACE_PREFIX.length)}`;
          request = request.not("key", "match", keyPrefixRegex(prefix));
          request = request.not("key", "match", keyPrefixRegex(legacyPrefix));
        }
        const previousPullTime = previousPullAt ? Date.parse(previousPullAt) : Number.NaN;
        if (Number.isFinite(previousPullTime)) {
          request = request.gt("updated_at", new Date(previousPullTime - 120_000).toISOString());
        }
        const { data, error } = await request;
        if (cancelled) return;
        if (error) {
          console.error("[Pace sync] user_state pull failed", {
            code: error.code,
            message: error.message,
          });
          setStatus("error");
          return;
        }
        if (!data) {
          console.error("[Pace sync] user_state pull returned no data");
          setStatus("error");
          return;
        }
        const queue = new Set(readQueue(user.id).map((item) => item.key));
        const meta = readMeta(user.id);
        const grouped = new Map<string, { canonical?: SyncRow; legacy?: SyncRow }>();
        for (const raw of data) {
          const row = raw as unknown as SyncRow;
          const key = row.key.startsWith("lt.") ? `${PACE_PREFIX}${row.key.slice(3)}` : row.key;
          if (!isSyncableRecord(key, row.value, user.id)) continue;
          const bucket = grouped.get(key) ?? {};
          if (row.key.startsWith("lt.")) bucket.legacy = row;
          else bucket.canonical = row;
          grouped.set(key, bucket);
        }
        let newest = "";
        for (const [key, bucket] of grouped) {
          const canonical = bucket.canonical;
          const legacy = bucket.legacy;
          // Each user_state row is a complete snapshot. Select the newest row;
          // union-merging an older legacy array can resurrect explicitly deleted items.
          const sourceRow = !canonical ? legacy : !legacy ? canonical
            : Date.parse(legacy.updated_at) > Date.parse(canonical.updated_at) ? legacy : canonical;
          if (!sourceRow) continue;
          const remoteValue = sourceRow.value;
          const sourceTime = Date.parse(sourceRow.updated_at);
          if (!Number.isFinite(sourceTime)) continue;
          const updatedAt = new Date(sourceTime).toISOString();
          const localDomain = readDomainRecord(key);
          let localStoredValue: unknown;
          try {
            const rawLocalValue = localStorage.getItem(key);
            if (rawLocalValue !== null) localStoredValue = JSON.parse(rawLocalValue);
          } catch {}
          // A custom wallpaper kept locally because Storage upload failed is a
          // device-local override. Do not replace it with an older cloud pointer
          // during the periodic pull; a successful migration or an explicit
          // preset/custom replacement will make the next local write syncable.
          const localWallpaperOverride = isInlineWallpaperValue(key, localStoredValue) ||
            Boolean(localDomain && isInlineWallpaperValue(key, localDomain.value));
          if (localWallpaperOverride) {
            meta[key] = updatedAt;
            newest = newest && Date.parse(newest) > sourceTime ? newest : updatedAt;
            continue;
          }
          const localIsEmpty = localDomain ? isEmptyRecoveredValue(localDomain.value) : true;
          const localTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
          const queued = getQueued(key, user.id);
          if (queued) {
            if (serialize(queued.value) === serialize(remoteValue)) {
              const currentConflicts = readConflicts(user.id);
              const remainingConflicts = currentConflicts.filter((item) => item.key !== key);
              if (remainingConflicts.length !== currentConflicts.length) {
                writeConflicts(remainingConflicts, user.id);
                setConflicts(remainingConflicts);
              }
              unqueueIfMutation(key, queued.updatedAt, user.id);
              meta[key] = updatedAt;
              newest = newest && Date.parse(newest) > sourceTime ? newest : updatedAt;
              continue;
            }
            recordConflict(key, queued.value, remoteValue, updatedAt);
            continue;
          }
          const localDomainTime = localDomain ? Date.parse(localDomain.updatedAt) : Number.NaN;
          // Compare the actual persisted local mutation timestamp with the
          // canonical cloud snapshot. meta[key] is only the last acknowledged
          // cloud version; it must not decide whether a newer local edit wins.
          if (localDomain && !localIsEmpty && Number.isFinite(localDomainTime) && localDomainTime > sourceTime) {
            queueItem({
              key,
              value: localDomain.value,
              updatedAt: localDomain.updatedAt,
              mutationId: localDomain.mutationId,
            }, user.id);
            meta[key] = localDomain.updatedAt;
            newest = newest && Date.parse(newest) > localDomainTime ? newest : localDomain.updatedAt;
            continue;
          }
          if (sourceTime <= localTime && !localIsEmpty) continue;
          applyRemoteAndRemember(key, remoteValue, updatedAt);
          meta[key] = updatedAt;
          newest = newest && Date.parse(newest) > sourceTime ? newest : updatedAt;
          if (legacy && canonical && sourceRow === legacy) {
            // Promote the newer legacy snapshot verbatim; do not union two
            // generations of full-state rows.
            const recoveryTime = new Date().toISOString();
            try {
              await supabase.rpc("upsert_user_state_if_newer", {
                p_user_id: user.id,
                p_key: key,
                p_value: remoteValue as never,
                p_updated_at: recoveryTime,
                p_updated_by: "state_recovery_v5",
              });
              meta[key] = recoveryTime;
              newest = recoveryTime;
            } catch {}
          }
        }
        // Bootstrap pre-existing local domain state that has no cloud row yet.
        try {
          for (const storageKey of Object.keys(localStorage)) {
            if (!storageKey.startsWith(DOMAIN_PREFIX)) continue;
            const domain = storageKey.slice(DOMAIN_PREFIX.length);
            if (!domain || domain.startsWith("__")) continue;
            const key = PACE_PREFIX + domain;
            if (!isSyncableKey(key) || grouped.has(key)) continue;
            const localDomain = readDomainRecord(key);
            if (!localDomain || isEmptyRecoveredValue(localDomain.value)) continue;
            queueItem({
              key,
              value: localDomain.value,
              updatedAt: localDomain.updatedAt,
              mutationId: localDomain.mutationId,
            }, user.id);
            meta[key] = localDomain.updatedAt;
            newest = newest && Date.parse(newest) > Date.parse(localDomain.updatedAt) ? newest : localDomain.updatedAt;
          }
        } catch {}

        // Recover pre-existing local app state written by useLocalState (raw
        // pace.* keys). A key is bootstrapped only when no cloud/legacy row
        // exists, so this cannot overwrite an existing server snapshot.
        try {
          for (const key of Object.keys(localStorage)) {
            if (!key.startsWith(PACE_PREFIX) || key.startsWith(INTERNAL_PREFIX) || key.startsWith(DOMAIN_PREFIX)) continue;
            if (!isSyncableKey(key) || grouped.has(key) || getQueued(key, user.id) || readDomainRecord(key)) continue;
            let value: unknown;
            try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { continue; }
            if (isEmptyRecoveredValue(value)) continue;
            const updatedAt = new Date().toISOString();
            const mutationId = `local-bootstrap-${updatedAt}-${key}`;
            queueItem({ key, value, updatedAt, mutationId }, user.id);
            meta[key] = updatedAt;
            newest = newest && Date.parse(newest) > Date.parse(updatedAt) ? newest : updatedAt;
          }
        } catch {}
        writeMeta(meta, user.id);
        localStorage.setItem(pullCursorKey, new Date(pullStartedAt).toISOString());
        if (newest) localStorage.setItem("pace.__last_sync_at", newest);
        if (newest) setStatus("ok");
      } catch (error) {
        console.error("[Pace sync] user_state pull threw", {
          message: error instanceof Error ? error.message : "unknown error",
        });
        if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
      }
    };

    let syncInFlight: Promise<void> | null = null;
    let syncRequested = false;
    const syncNow = async () => {
      if (!allowed()) return;
      if (syncInFlight) {
        // Coalesce Realtime bursts but never lose the last remote-change signal.
        syncRequested = true;
        await syncInFlight;
        return;
      }
      const run = async () => {
        do {
          syncRequested = false;
          pruneEquivalentConflicts();
          if (!navigator.onLine) { setStatus("offline"); return; }
          await flushQueue();
          await pull();
          await flushQueue();
          pruneEquivalentConflicts();
        } while (syncRequested && !cancelled && allowed() && navigator.onLine);
      };
      syncInFlight = run();
      try {
        await syncInFlight;
      } finally {
        syncInFlight = null;
      }
    };

    // Low-payload private Broadcast is the primary remote-change signal.
    // The database trigger publishes only the changed key and server timestamp;
    // clients then pull the authoritative JSONB value through the existing
    // account-scoped, device-local-filtered PostgREST query.
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
    if (session?.access_token) {
      // Private Broadcast authorization uses the current Supabase user JWT.
      void supabase.realtime.setAuth(session.access_token).then(() => {
        if (cancelled) return;
        const topic = `pace-user-state:${user.id}`;
        realtimeChannel = createPrivateRealtimeChannel(topic)
          .on("broadcast", { event: "user_state_changed" }, (message) => {
            if (cancelled || !allowed() || !navigator.onLine) return;
            const payload = message.payload as { key?: unknown } | undefined;
            if (typeof payload?.key !== "string" || !isSyncableKey(payload.key)) return;
            void syncNow();
          })
          .subscribe((state, error) => {
            if (state === "SUBSCRIBED" && !cancelled) {
              console.info("[Pace sync] private user_state Broadcast subscribed", { topic });
              void syncNow();
              return;
            }
            if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
              console.error("[Pace sync] private Broadcast channel unavailable", { topic, state, message: error instanceof Error ? error.message : undefined });
              if (!cancelled) setStatus("error");
            }
          });
      }).catch((error) => {
        console.error("[Pace sync] failed to authorize private Realtime channel", {
          message: error instanceof Error ? error.message : "unknown error",
        });
        if (!cancelled) setStatus("error");
        // The filtered 60-second pull remains the recovery path if private
        // Realtime authorization cannot be established.
      });
    }

    const offLocal = onLocalWrite((key, value, updatedAt, mutationId) => {
      if (!isSyncableRecord(key, value, user.id) || !updatedAt) return;
      const encoded = serialize(value);
      const memoryKey = user.id + ':' + key;
      if (encoded !== undefined && lastRemoteValues.current[memoryKey] === encoded) { delete lastRemoteValues.current[memoryKey]; return; }
      delete lastRemoteValues.current[memoryKey];
      queueItem({ key, value, updatedAt, mutationId }, user.id);
      if (allowed()) void pushItem({ key, value, updatedAt, mutationId });
    });

    const onOnline = () => {
      void syncNow();
    };
    const onOffline = () => {
      setStatus("offline");
    };

    // Generic user_state Realtime is intentionally disabled: its documented
    // filter operators cannot exclude arbitrary device-local key prefixes
    // before payload delivery. The incremental PostgREST pull applies exact
    // and regex exclusions server-side. Local writes push immediately; remote
    // writes reconcile every 60s or when the tab returns online/visible.
    const reconcileTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && allowed()) void syncNow();
    }, 60_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    const onPageShow = () => {
      void syncNow();
    };
    const onLegalChanged = () => {
      if (allowed()) void syncNow();
      else setStatus("idle");
    };
    const onConflictResolved = () => { void syncNow(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pace.legal.changed", onLegalChanged);
    window.addEventListener("pace.sync.conflict.resolved", onConflictResolved);
    pruneEquivalentConflicts();
    void syncNow();
    return () => {
      cancelled = true; offLocal();
      if (realtimeChannel) void supabase.removeChannel(realtimeChannel);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(reconcileTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pace.legal.changed", onLegalChanged);
      window.removeEventListener("pace.sync.conflict.resolved", onConflictResolved);
    };
  }, [user, session?.access_token]);

  const resolveConflict = useCallback(async (conflictId: string, choice: "local" | "remote" | "merge") => {
    const userId = user?.id; if (!userId) return; const conflict = readConflicts(userId).find((item) => item.id === conflictId); if (!conflict) return;
    const merged = choice === "merge" ? mergeRecoveredValues(conflict.remoteValue, conflict.localValue) : choice === "local" ? conflict.localValue : conflict.remoteValue;
    if (choice === "remote") { applyRemoteWrite(conflict.key, conflict.remoteValue, conflict.remoteUpdatedAt); unqueueIfMutation(conflict.key, getQueued(conflict.key, userId)?.updatedAt ?? "", userId); markVersion(conflict.key, conflict.remoteUpdatedAt, userId); }
    else { const updatedAt = new Date().toISOString(); applyRemoteWrite(conflict.key, merged, updatedAt); queueItem({ key: conflict.key, value: merged, updatedAt, mutationId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : updatedAt }, userId); }
    const remaining = readConflicts(userId).filter((item) => item.id !== conflictId); writeConflicts(remaining, userId); setConflicts(remaining); window.dispatchEvent(new Event("pace.sync.conflict.resolved"));
  }, [user?.id]);

  return { status, queuedCount: user ? readQueue(user.id).length : 0, conflicts, resolveConflict };
}

type SyncContextValue = {
  status: SyncStatus;
  queuedCount: number;
  conflicts: SyncConflict[];
  resolveConflict: (conflictId: string, choice: "local" | "remote" | "merge") => Promise<void>;
};
const SyncStatusContext = createContext<SyncContextValue>({
  status: "idle",
  queuedCount: 0,
  conflicts: [],
  resolveConflict: async () => {},
});
export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const value = useCloudSyncEngineInternal();
  return <SyncStatusContext.Provider value={value}>{children}</SyncStatusContext.Provider>;
}
export function useCloudSyncStatus(): SyncContextValue { return useContext(SyncStatusContext); }