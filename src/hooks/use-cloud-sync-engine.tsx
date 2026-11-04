import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";
import { accountSyncStorageKeys, parseSyncMetadata, parseSyncQueue } from "@/lib/cloud-sync-scope";
import { fetchAllKeysetPages } from "@/lib/user-state-pagination";

const PACE_PREFIX = "pace.";
const EXCLUDED = new Set<string>(["pace.sport.active"]);
// Full user_state reconciliation is a fallback, not a realtime transport.
// Keep it at 60s to reduce repeated downloads of large account snapshots.
const POLL_MS = 60000;
const FULL_RECONCILIATION_MS = 24 * 60 * 60 * 1000;
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
function queueKey(userId: string, key: string) { if (!key.startsWith(PACE_PREFIX) || EXCLUDED.has(key)) return; writeQueue(userId, [...readQueue(userId), key]); }
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

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    try { if (!isLegalCategoryAllowed("sync_cloud")) return; } catch { return; }
    let cancelled = false;
    let lastFullReconciliationAt = 0;

    const pushKeyNow = async (key: string) => {
      if (cancelled || EXCLUDED.has(key) || !key.startsWith(PACE_PREFIX)) return;
      queueKey(user.id, key);

      const writeId = `${user.id}:${key}`;
      const previous = keyWrites.current[writeId] ?? Promise.resolve();
      const current = previous.then(async () => {
        if (cancelled) return;
        if (!navigator.onLine) { setStatus("offline"); return; }

        let value: unknown;
        try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return; }
        const updatedAt = new Date().toISOString();
        setStatus("syncing");

        try {
          const { data, error } = await supabase.rpc("upsert_user_state_if_newer", {
            p_user_id: user.id,
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

          // true = our mutation won; false = the server already had a newer row.
          // In the latter case, immediately pull the authoritative value instead
          // of allowing this stale local state to remain marked as current.
          if (data === false) {
            const { data: rows } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id).eq("key", key).limit(1);
            const row = rows?.[0] as SyncRow | undefined;
            if (row) {
              applyRemoteWrite(key, row.value, row.updated_at);
              markLocal(user.id, key, row.updated_at);
            }
          } else {
            markLocal(user.id, key, updatedAt);
            localStorage.setItem("pace.__last_sync_at", updatedAt);
          }

          unqueueKey(user.id, key);
          setStatus("ok");
        } catch {
          if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
        }
      });

      keyWrites.current[writeId] = current.catch(() => undefined);
      await current;
    };

    const flushQueue = async () => {
      if (cancelled || !navigator.onLine || running.current[user.id]) return;
      const queue = readQueue(user.id);
      if (!queue.length) return;
      running.current[user.id] = true;
      try { for (const key of queue) await pushKeyNow(key); }
      finally { running.current[user.id] = false; }
    };

    const pull = async () => {
      if (cancelled || !navigator.onLine || running.current[user.id]) return;
      try {
        // Fetch every row before applying any: a failed later page must not
        // leave a partially reconciled local snapshot marked as complete.
        const data = await fetchAllKeysetPages<SyncRow>(
          async (afterKey, pageSize) => {
            let query = supabase.from("user_state")
              .select("key,value,updated_at,updated_by")
              .eq("user_id", user.id)
              .order("key", { ascending: true })
              .limit(pageSize);
            if (afterKey !== null) query = query.gt("key", afterKey);
            const { data, error } = await query;
            return { data: data as SyncRow[] | null, error };
          },
          { pageSize: USER_STATE_PAGE_SIZE, isCancelled: () => cancelled },
        );
        if (data === null || cancelled) return;
        lastFullReconciliationAt = Date.now();
        const queue = new Set(readQueue(user.id));
        const meta = readMeta(user.id);
        let applied = 0;
        let newest = "";

        for (const rawRow of data) {
          const row = rawRow as unknown as SyncRow;
          const rawKey = row.key;
          const isLegacy = rawKey.startsWith("lt.");
          const key = isLegacy ? `${PACE_PREFIX}${rawKey.slice(3)}` : rawKey;
          if (!key.startsWith(PACE_PREFIX) || EXCLUDED.has(key) || queue.has(key)) continue;

          const localRaw = localStorage.getItem(key);
          let localValue: unknown = null;
          try { if (localRaw !== null) localValue = JSON.parse(localRaw); } catch { /* Ignore malformed local JSON and evaluate the remote value below. */ }
          const shouldRecoverLegacy = isLegacy && isEmptyValue(localValue) && !isEmptyValue(row.value);

          const remoteTime = Date.parse(row.updated_at);
          const localTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
          if (!shouldRecoverLegacy && (!Number.isFinite(remoteTime) || remoteTime <= localTime)) continue;

          applyRemoteWrite(key, row.value, row.updated_at);
          meta[key] = row.updated_at;
          newest = row.updated_at;
          applied++;
        }

        writeMeta(user.id, meta);
        if (newest) localStorage.setItem("pace.__last_sync_at", newest);
        if (applied > 0) setStatus("ok");
      } catch {
        if (!cancelled && !navigator.onLine) setStatus("offline");
      }
    };

    let realtimeHealthy = false;

    const applyRemoteRow = (rawRow: unknown) => {
      if (cancelled || !rawRow || typeof rawRow !== "object") return;
      const row = rawRow as SyncRow;
      if (typeof row.key !== "string" || row.updated_by === DEVICE_ID) return;
      // Legacy rows must go through the compatibility merge in pull(); mapping
      // one legacy row directly could overwrite a newer canonical value.
      if (row.key.startsWith("lt.")) {
        void pull();
        return;
      }
      const key = row.key;
      if (!key.startsWith(PACE_PREFIX) || EXCLUDED.has(key)) return;
      const remoteTime = Date.parse(row.updated_at);
      if (!Number.isFinite(remoteTime)) return;
      const localTime = Date.parse(readMeta(user.id)[key] ?? "1970-01-01T00:00:00.000Z");
      if (remoteTime <= localTime || readQueue(user.id).includes(key)) return;

      applyRemoteWrite(key, row.value, row.updated_at);
      markLocal(user.id, key, row.updated_at);
      localStorage.setItem("pace.__last_sync_at", row.updated_at);
      setStatus("ok");
    };

    const syncNow = async () => {
      if (!navigator.onLine) { setStatus("offline"); return; }
      await flushQueue();
      await pull();
    };

    const offLocal = onLocalWrite((key) => {
      if (EXCLUDED.has(key) || !key.startsWith(PACE_PREFIX)) return;
      queueKey(user.id, key);
      void pushKeyNow(key);
    });

    const onOnline = () => { void syncNow(); };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    // Realtime is the normal cross-device transport. Full user_state pulls
    // remain a recovery path only when the channel is unavailable.
    const realtimeChannel = supabase.channel(`pace-user-state-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_state", filter: `user_id=eq.${user.id}` }, (payload) => applyRemoteRow(payload.new))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "user_state", filter: `user_id=eq.${user.id}` }, (payload) => applyRemoteRow(payload.new));
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

    // Queue writes immediately; the subscription callback performs the first
    // reconciliation once Realtime is active. If it never connects, recover
    // through the bounded polling fallback below.
    void flushQueue();
    const interval = window.setInterval(() => {
      // A healthy channel is the fast path, but a daily full scan still
      // recovers events missed without an observable channel disconnect.
      if (!realtimeHealthy || Date.now() - lastFullReconciliationAt >= FULL_RECONCILIATION_MS) {
        void syncNow();
      }
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