import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";
import { accountSyncStorageKeys, isLatestKeyWrite, isSyncableLocalKey, nextSyncWriteTimestamp, parseSyncMetadata, parseSyncQueue, syncPullPlan } from "@/lib/cloud-sync-scope";
import { fetchAllKeysetPages } from "@/lib/user-state-pagination";
import { flushNutritionFoodLogOutbox } from "@/lib/nutrition-log";
import { NUTRITION_CACHE_OWNER_KEY, NUTRITION_UNASSIGNED_BACKUP_KEY, nutritionAccountCacheKeys } from "@/lib/nutrition-sync";

const PACE_PREFIX = "pace.";
const EXCLUDED = new Set<string>(["pace.sport.active"]);
// When Realtime is unhealthy, poll only rows changed since the per-account
// watermark. Keep a short overlap for equal/late timestamps and do a full
// reconciliation at startup and at least once every 24 hours.
const POLL_MS = 60000;
const FULL_RECONCILIATION_MS = 24 * 60 * 60 * 1000;
const PULL_CURSOR_OVERLAP_MS = 5 * 60 * 1000;
const FULL_RECONCILIATION_META_KEY = "pace.__sync_last_full_reconcile_at";
// PostgREST may cap responses at 1,000 rows; use stable keyset pages so a
// reconciliation never silently leaves later user_state keys unsynchronized.
const USER_STATE_PAGE_SIZE = 500;
const DEVICE_KEY = "pace.__sync_device_id";
const DEVICE_ID = getDeviceId();

type SyncMeta = Record<string, string>;
export type SyncStatus = "idle" | "syncing" | "ok" | "error" | "offline";
type SyncRow = { key: string; value: unknown; updated_at: string; updated_by: string | null };

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

function readQueue(userId: string): string[] { try { return parseSyncQueue(localStorage.getItem(accountSyncStorageKeys(userId).queue)); } catch { return []; } }
function writeQueue(userId: string, keys: string[]) { try { localStorage.setItem(accountSyncStorageKeys(userId).queue, JSON.stringify([...new Set(keys)])); } catch { /* Storage may be unavailable; keep the in-memory sync path. */ } }
function queueKey(userId: string, key: string) { if (!isSyncableLocalKey(key) || EXCLUDED.has(key)) return; writeQueue(userId, [...readQueue(userId), key]); }
function unqueueKey(userId: string, key: string) { writeQueue(userId, readQueue(userId).filter((k) => k !== key)); }
function readMeta(userId: string): SyncMeta { try { return parseSyncMetadata(localStorage.getItem(accountSyncStorageKeys(userId).metadata)); } catch { return {}; } }
function writeMeta(userId: string, meta: SyncMeta) { try { localStorage.setItem(accountSyncStorageKeys(userId).metadata, JSON.stringify(meta)); } catch { /* Storage may be unavailable; metadata can be rebuilt on the next sync. */ } }
function markLocal(userId: string, key: string, timestamp: string) { const meta = readMeta(userId); meta[key] = timestamp; writeMeta(userId, meta); }

function isEmptyValue(value: unknown) {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

/**
 * Cross-device sync with a durable key queue and server-side last-write-wins.
 * The queue is populated synchronously before network I/O. Server writes use
 * an atomic PostgreSQL function so a stale device cannot overwrite a newer row.
 */
export function useCloudSyncEngineInternal() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const running = useRef<Record<string, boolean>>({});
  const keyWrites = useRef<Record<string, Promise<void>>>({});
  const keyWriteVersions = useRef<Record<string, number>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    const userId = user.id;
    try { if (!isLegalCategoryAllowed("sync_cloud")) return; } catch { return; }
    let cancelled = false;
    let lastFullReconciliationAt = 0;
    let pullRunning = false;
    let pullPending = false;
    let forceFullPullPending = false;
    let flushPending = false;

    const markNutritionCacheOwner = (
      key: string,
      nextValue?: unknown,
      preservePreviousGlobal = false,
    ) => {
      if (key !== "pace.nutrition.items" && key !== "pace.nutrition.totals") return;
      try {
        const previousOwner = localStorage.getItem(NUTRITION_CACHE_OWNER_KEY);
        const globalValue = localStorage.getItem(key);
        if (preservePreviousGlobal && globalValue) {
          if (previousOwner && previousOwner !== userId) {
            const previousKeys = nutritionAccountCacheKeys(previousOwner);
            const target = key.endsWith(".items") ? previousKeys.items : previousKeys.totals;
            if (!localStorage.getItem(target)) localStorage.setItem(target, globalValue);
          } else if (!previousOwner && !localStorage.getItem(NUTRITION_UNASSIGNED_BACKUP_KEY)) {
            const target = key.endsWith(".items")
              ? NUTRITION_UNASSIGNED_BACKUP_KEY
              : `${NUTRITION_UNASSIGNED_BACKUP_KEY}:totals`;
            localStorage.setItem(target, globalValue);
          }
        }
        const accountKeys = nutritionAccountCacheKeys(userId);
        const target = key.endsWith(".items") ? accountKeys.items : accountKeys.totals;
        const serialized = nextValue === undefined ? globalValue : JSON.stringify(nextValue);
        if (serialized !== null) localStorage.setItem(target, serialized);
        localStorage.setItem(NUTRITION_CACHE_OWNER_KEY, userId);
      } catch {
        // The active account guard still prevents this tab from reading
        // another account's scoped cache; ownership metadata is best-effort.
      }
    };

    const pushKeyNow = async (key: string) => {
      if (cancelled || EXCLUDED.has(key) || !isSyncableLocalKey(key)) return;
      queueKey(userId, key);

      const writeId = `${userId}:${key}`;
      const writeVersion = (keyWriteVersions.current[writeId] ?? 0) + 1;
      keyWriteVersions.current[writeId] = writeVersion;
      const previous = keyWrites.current[writeId] ?? Promise.resolve();
      const current = previous.then(async () => {
        if (cancelled) return;
        if (!navigator.onLine) { setStatus("offline"); return; }

        let value: unknown;
        try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return; }
        const previousTimestamp = readMeta(userId)[key];
        const updatedAt = nextSyncWriteTimestamp(Date.now(), previousTimestamp);
        setStatus("syncing");

        try {
          const { data, error } = await supabase.rpc("upsert_user_state_if_newer", {
            p_user_id: userId,
            p_key: key,
            p_value: value as Json,
            p_updated_at: updatedAt,
            p_updated_by: DEVICE_ID,
          });
          if (cancelled) return;
          if (error) {
            setStatus("error");
            return;
          }

          // The RPC contract returns a boolean. Treat every other value as
          // ambiguous: never acknowledge a queued mutation without proof that
          // it won or that a newer authoritative row was successfully fetched.
          if (data === false) {
            const { data: rows, error: readError } = await supabase
              .from("user_state")
              .select("key,value,updated_at,updated_by")
              .eq("user_id", userId)
              .eq("key", key)
              .limit(1);
            if (cancelled) return;
            if (readError) {
              setStatus("error");
              return;
            }
            // A later local edit may have arrived while the conflict row was
            // being fetched. Never replace that newer local value with the
            // response for an older queued attempt.
            if (!isLatestKeyWrite(writeVersion, keyWriteVersions.current[writeId] ?? 0)) return;
            const row = rows?.[0] as SyncRow | undefined;
            if (!row) {
              // A false RPC result means a newer row won. If that row cannot
              // be read (RLS/policy/transient inconsistency), keep the outbox
              // entry so a later pass can reconcile instead of losing it.
              setStatus("error");
              return;
            }
            markNutritionCacheOwner(key, row.value, true);
            applyRemoteWrite(key, row.value, row.updated_at);
            markLocal(userId, key, row.updated_at);
          } else if (data === true) {
            markLocal(userId, key, updatedAt);
            localStorage.setItem("pace.__last_sync_at", updatedAt);
          } else {
            setStatus("error");
            return;
          }

          // The queue is shared by invocations for the same key. Only the
          // latest invocation may acknowledge it; an earlier accepted write
          // must not erase a newer edit that is waiting behind it.
          if (!isLatestKeyWrite(writeVersion, keyWriteVersions.current[writeId] ?? 0)) return;
          unqueueKey(userId, key);
          setStatus("ok");
        } catch {
          if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
        }
      });

      keyWrites.current[writeId] = current.catch(() => undefined);
      await current;
      if (isLatestKeyWrite(writeVersion, keyWriteVersions.current[writeId] ?? 0)) {
        delete keyWriteVersions.current[writeId];
      }
    };

    const flushQueue = async () => {
      if (cancelled || !navigator.onLine) return;
      if (running.current[userId] || pullRunning) {
        flushPending = true;
        return;
      }
      flushPending = false;
      running.current[userId] = true;
      try {
        // food_log retries are account-local row operations, never user_state
        // JSON snapshots. Keep them on the same consent-gated online worker.
        await flushNutritionFoodLogOutbox(userId, () => cancelled);
        if (cancelled || !navigator.onLine) return;
        const queue = readQueue(userId);
        for (const key of queue) {
          if (cancelled) return;
          await pushKeyNow(key);
        }
      } finally {
        running.current[userId] = false;
        if (!cancelled && navigator.onLine) {
          if (pullPending || forceFullPullPending) {
            const force = forceFullPullPending;
            pullPending = false;
            void pull(force);
          } else if (flushPending) {
            flushPending = false;
            void flushQueue();
          }
        }
      }
    };

    async function pull(forceFullReconciliation = false) {
      if (forceFullReconciliation) forceFullPullPending = true;
      if (cancelled || !navigator.onLine) return;
      if (running.current[userId] || pullRunning) {
        pullPending = true;
        return;
      }
      pullPending = false;
      pullRunning = true;
      const forceFull = forceFullPullPending;
      forceFullPullPending = false;
      try {
        const now = Date.now();
        const metadataAtStart = readMeta(userId);
        const persistedFullAt = Date.parse(
          metadataAtStart[FULL_RECONCILIATION_META_KEY] ?? "",
        );
        const lastFullAt = Number.isFinite(persistedFullAt)
          ? Math.max(lastFullReconciliationAt, persistedFullAt)
          : lastFullReconciliationAt;
        const pullPlan = syncPullPlan(
          metadataAtStart,
          lastFullAt,
          now,
          PULL_CURSOR_OVERLAP_MS,
          FULL_RECONCILIATION_MS,
        );
        const { cursor: incrementalCursor } = pullPlan;
        const fullReconciliation = forceFull || pullPlan.fullReconciliation;

        // Fetch the complete selected window before applying any row. If a
        // later page fails, no partial batch is marked as reconciled.
        const data = await fetchAllKeysetPages<SyncRow>(
          async (afterKey, pageSize) => {
            let query = supabase.from("user_state")
              .select("key,value,updated_at,updated_by")
              .eq("user_id", userId)
              // Client bookkeeping and account-private Nutrition caches are
              // never domain state. Exclude them in PostgREST so stale rows
              // cannot consume egress before the client-side key guard runs.
              .not("key", "match", "^pace\\.__sync_")
              .not("key", "match", "^pace\\.__nutrition_cache:");
              // Legacy wallpaper values may be large Data URLs. Wallpapers are now device-local IndexedDB data.
              .not("key", "in", "(pace.wallpaper,lt.wallpaper)");
            if (!fullReconciliation) {
              query = query.gte("updated_at", incrementalCursor!);
            }
            query = query.order("key", { ascending: true }).limit(pageSize);
            if (afterKey !== null) query = query.gt("key", afterKey);
            const { data, error } = await query;
            return { data: data as SyncRow[] | null, error };
          },
          { pageSize: USER_STATE_PAGE_SIZE, isCancelled: () => cancelled },
        );
        if (data === null || cancelled) return;

        const queue = new Set(readQueue(userId));
        const meta = readMeta(userId);
        if (fullReconciliation) {
          lastFullReconciliationAt = Date.now();
          meta[FULL_RECONCILIATION_META_KEY] = new Date(lastFullReconciliationAt).toISOString();
        }
        let applied = 0;
        let newest = Date.parse(localStorage.getItem("pace.__last_sync_at") ?? "");

        for (const row of data) {
          if (cancelled || typeof row.key !== "string") return;
          const rawKey = row.key;
          const isLegacy = rawKey.startsWith("lt.");
          const key = isLegacy ? `${PACE_PREFIX}${rawKey.slice(3)}` : rawKey;
          if (!isSyncableLocalKey(key) || EXCLUDED.has(key)) continue;

          const remoteTime = Date.parse(row.updated_at);
          if (!Number.isFinite(remoteTime)) continue;
          newest = Number.isFinite(newest) ? Math.max(newest, remoteTime) : remoteTime;

          const localTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
          if (queue.has(key)) {
            // The pending mutation remains authoritative locally until its
            // push resolves. Record the observed server version so a queued
            // offline key does not force a full-account scan on every poll.
            if (remoteTime > localTime) meta[key] = row.updated_at;
            continue;
          }

          const localRaw = localStorage.getItem(key);
          let localValue: unknown = null;
          try { if (localRaw !== null) localValue = JSON.parse(localRaw); } catch { /* Ignore malformed local JSON and evaluate the remote value below. */ }
          const shouldRecoverLegacy = isLegacy && isEmptyValue(localValue) && !isEmptyValue(row.value);
          if (!shouldRecoverLegacy && remoteTime <= localTime) continue;

          markNutritionCacheOwner(key, row.value, true);
          applyRemoteWrite(key, row.value, row.updated_at);
          meta[key] = row.updated_at;
          applied++;
        }

        writeMeta(userId, meta);
        if (Number.isFinite(newest)) {
          localStorage.setItem("pace.__last_sync_at", new Date(newest).toISOString());
        }
        if (applied > 0) setStatus("ok");
      } catch {
        if (!cancelled && !navigator.onLine) setStatus("offline");
      } finally {
        pullRunning = false;
        if (!cancelled && navigator.onLine) {
          if (flushPending && !running.current[userId]) {
            flushPending = false;
            void flushQueue();
          } else if (pullPending || forceFullPullPending) {
            const force = forceFullPullPending;
            pullPending = false;
            void pull(force);
          }
        }
      }
    }

    let realtimeHealthy = false;

    const applyRemoteRow = (rawRow: unknown) => {
      if (cancelled || !rawRow || typeof rawRow !== "object") return;
      const row = rawRow as SyncRow;
      if (typeof row.key !== "string" || row.updated_by === DEVICE_ID) return;
      // Legacy rows must go through the compatibility merge in pull(); mapping
      // one legacy row directly could overwrite a newer canonical value.
      if (row.key.startsWith("lt.")) {
        // Preserve one-time legacy recovery even when the row's timestamp is
        // older than the incremental cursor.
        void pull(true);
        return;
      }
      const key = row.key;
      if (!isSyncableLocalKey(key) || EXCLUDED.has(key)) return;
      const remoteTime = Date.parse(row.updated_at);
      if (!Number.isFinite(remoteTime)) return;
      const localTime = Date.parse(readMeta(userId)[key] ?? "1970-01-01T00:00:00.000Z");
      if (remoteTime <= localTime || readQueue(userId).includes(key)) return;

      markNutritionCacheOwner(key, row.value, true);
      applyRemoteWrite(key, row.value, row.updated_at);
      markLocal(userId, key, row.updated_at);
      localStorage.setItem("pace.__last_sync_at", row.updated_at);
      setStatus("ok");
    };

    const syncNow = async () => {
      if (!navigator.onLine) { setStatus("offline"); return; }
      await flushQueue();
      await pull();
    };

    const offLocal = onLocalWrite((key, value) => {
      if (EXCLUDED.has(key) || !isSyncableLocalKey(key)) return;
      markNutritionCacheOwner(key, value, false);
      queueKey(userId, key);
      void pushKeyNow(key);
    });

    const onOnline = () => { void syncNow(); };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Realtime is the normal cross-device transport. Full user_state pulls
    // remain a recovery path only when the channel is unavailable.
    const realtimeChannel = supabase.channel(`pace-user-state-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_state", filter: `user_id=eq.${userId}` }, (payload) => applyRemoteRow(payload.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "user_state", filter: `user_id=eq.${userId}` }, (payload) => applyRemoteRow(payload.new));
    void realtimeChannel.subscribe((subscriptionStatus) => {
      // removeChannel may report CLOSED after this effect has already cleaned up.
      if (cancelled) return;
      if (subscriptionStatus === "SUBSCRIBED") {
        realtimeHealthy = true;
        void syncNow();
      } else if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT" || subscriptionStatus === "CLOSED") {
        realtimeHealthy = false;
        setStatus(navigator.onLine ? "error" : "offline");
      }
    });

    const isFullReconciliationDue = () => {
      const metadata = readMeta(userId);
      const persistedAt = Date.parse(metadata[FULL_RECONCILIATION_META_KEY] ?? "");
      const lastFullAt = Number.isFinite(persistedAt)
        ? Math.max(lastFullReconciliationAt, persistedAt)
        : lastFullReconciliationAt;
      return syncPullPlan(
        metadata,
        lastFullAt,
        Date.now(),
        PULL_CURSOR_OVERLAP_MS,
        FULL_RECONCILIATION_MS,
      ).fullReconciliation;
    };

    // Flush queued writes immediately. The timer also retries them while
    // Realtime is healthy; otherwise one transient RPC error could leave an
    // outbox key waiting until the next reconnect or daily reconciliation.
    void flushQueue();
    const interval = window.setInterval(() => {
      if (!realtimeHealthy) {
        // Realtime outage: incremental pull + outbox retry, not a full scan.
        void syncNow();
        return;
      }

      // Realtime is the normal transport. Retry only pending mutations here;
      // pull remote state only when the persisted daily recovery scan is due.
      void flushQueue();
      if (isFullReconciliationDue()) void syncNow();
    }, POLL_MS);

    return () => {
      cancelled = true;
      offLocal();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(interval);
      void supabase.removeChannel(realtimeChannel);
    };
  }, [user]);

  return { status, queuedCount: user ? readQueue(user.id).length : 0 };
}

const SyncStatusContext = createContext<SyncStatus>("idle");
export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { status } = useCloudSyncEngineInternal();
  return <SyncStatusContext.Provider value={status}>{children}</SyncStatusContext.Provider>;
}
export function useCloudSyncStatus(): SyncStatus { return useContext(SyncStatusContext); }