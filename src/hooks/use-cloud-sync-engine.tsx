import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";

const PACE_PREFIX = "pace.";
const INTERNAL_PREFIX = "pace.__";
const DOMAIN_OUTBOX_KEY = "pace.domain.outbox";
const EXCLUDED = new Set<string>(["pace.sport.active"]);
const QUEUE_KEY = "pace.__sync_queue";
const META_KEY = "pace.__sync_meta";
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

function isSyncableKey(key: string): boolean {
  return key.startsWith(PACE_PREFIX) &&
    !key.startsWith(INTERNAL_PREFIX) &&
    key !== DOMAIN_OUTBOX_KEY &&
    !EXCLUDED.has(key);
}

function readQueue(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((key): key is string => isSyncableKey(key)))];
  } catch { return []; }
}
function writeQueue(keys: string[]) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify([...new Set(keys)])); } catch {} }
function queueKey(key: string) { if (!isSyncableKey(key)) return; writeQueue([...readQueue(), key]); }
function unqueueKey(key: string) { writeQueue(readQueue().filter((k) => k !== key)); }
function readMeta(): SyncMeta {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(META_KEY) ?? "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([key, value]) =>
        isSyncableKey(key) &&
        typeof value === "string" &&
        Number.isFinite(Date.parse(value)),
      ),
    ) as SyncMeta;
  } catch { return {}; }
}
function writeMeta(meta: SyncMeta) { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {} }
function markLocal(key: string, timestamp: string) { const meta = readMeta(); meta[key] = timestamp; writeMeta(meta); }

/**
 * Cross-device sync with a durable key queue and server-side last-write-wins.
 * The queue is populated synchronously before network I/O. Server writes use
 * an atomic PostgreSQL function so a stale device cannot overwrite a newer row.
 */
export function useCloudSyncEngineInternal() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [legalRevision, setLegalRevision] = useState(0);
  const running = useRef(false);
  const keyWrites = useRef<Record<string, Promise<void>>>({});

  // Keep listening even when consent is currently absent. Otherwise a later
  // opt-in would never restart sync because the guarded effect had returned.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let previousAllowed = false;
    try { previousAllowed = isLegalCategoryAllowed("sync_cloud"); } catch {}
    const onLegalChanged = () => {
      let nextAllowed = false;
      try { nextAllowed = isLegalCategoryAllowed("sync_cloud"); } catch {}
      // Other consent categories must not restart the cloud channel or trigger
      // an unnecessary full reconciliation.
      if (nextAllowed === previousAllowed) return;
      previousAllowed = nextAllowed;
      setLegalRevision((revision) => revision + 1);
      if (!nextAllowed) setStatus("idle");
    };
    window.addEventListener("pace.legal.changed", onLegalChanged);
    return () => window.removeEventListener("pace.legal.changed", onLegalChanged);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    try { if (!isLegalCategoryAllowed("sync_cloud")) return; } catch { return; }
    let cancelled = false;
    const allowed = () => {
      try { return isLegalCategoryAllowed("sync_cloud"); } catch { return false; }
    };

    const pushKeyNow = async (key: string) => {
      if (cancelled || !allowed() || !isSyncableKey(key)) return;
      queueKey(key);

      // Coalesce repeated local-write events for the same key. The in-flight
      // write checks whether the local value changed and schedules one trailing
      // push if necessary, instead of issuing a chain of duplicate RPCs.
      const existing = keyWrites.current[key];
      if (existing) return existing;
      const current = (async () => {
        if (cancelled) return;
        if (!navigator.onLine) { setStatus("offline"); return; }

        const rawValue = localStorage.getItem(key);
        let value: unknown;
        try { value = JSON.parse(rawValue ?? "null"); } catch { setStatus("error"); return; }
        const updatedAt = new Date().toISOString();
        setStatus("syncing");

        try {
          const { data, error } = await (supabase.rpc as never)("upsert_user_state_if_newer", {
            p_user_id: user.id,
            p_key: key,
            p_value: value,
            p_updated_at: updatedAt,
            p_updated_by: DEVICE_ID,
          });
          if (cancelled) return;
          if (error) {
            setStatus("error");
            return;
          }
          if (typeof data !== "boolean") {
            throw new Error("invalid cloud sync write response");
          }

          // true = our mutation won; false = the server already had a newer row.
          // A rejected write is not complete until the authoritative row is read;
          // keep the queue entry if that read fails so no local mutation is lost.
          if (data === false) {
            const { data: rows, error: readError } = await supabase
              .from("user_state")
              .select("key,value,updated_at,updated_by")
              .eq("user_id", user.id)
              .eq("key", key)
              .limit(1);
            if (readError) throw readError;
            const row = rows?.[0] as SyncRow | undefined;
            if (!row || typeof row.updated_at !== "string" ||
                !Number.isFinite(Date.parse(row.updated_at)) ||
                !Object.prototype.hasOwnProperty.call(row, "value")) {
              throw new Error("authoritative cloud sync row missing or invalid");
            }
            // Do not let a conflict read overwrite a local edit made while
            // the RPC/SELECT was in flight. Keep the queued mutation and retry it.
            if (localStorage.getItem(key) !== rawValue) {
              queueKey(key);
              window.setTimeout(() => void pushKeyNow(key), 0);
              return;
            }
            applyRemoteWrite(key, row.value);
            markLocal(key, row.updated_at);
            localStorage.setItem("pace.__last_sync_at", row.updated_at);
          } else {
            markLocal(key, updatedAt);
            localStorage.setItem("pace.__last_sync_at", updatedAt);
            if (localStorage.getItem(key) !== rawValue) {
              // The accepted value was already superseded locally. The newer
              // value must stay queued and be sent after this request finishes.
              queueKey(key);
              window.setTimeout(() => void pushKeyNow(key), 0);
              return;
            }
          }

          unqueueKey(key);
          setStatus("ok");
        } catch {
          if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
        }
      })();
      const tracked = current.catch(() => undefined).finally(() => {
        if (keyWrites.current[key] === tracked) delete keyWrites.current[key];
      });
      keyWrites.current[key] = tracked;
      await tracked;
    };

    const flushQueue = async () => {
      if (cancelled || !allowed() || !navigator.onLine || running.current) return;
      const queue = readQueue();
      if (!queue.length) return;
      running.current = true;
      try { for (const key of queue) await pushKeyNow(key); }
      finally { running.current = false; }
    };

    // Prevent overlapping full-table pulls when a request is slow and an online,
    // visibility, Realtime-recovery, or fallback event arrives concurrently.
    let pulling = false;
    const pull = async () => {
      if (cancelled || !allowed() || !navigator.onLine || running.current || pulling) return;
      pulling = true;
      try {
        const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id);
        if (cancelled || !allowed()) return;
        if (error) { setStatus(navigator.onLine ? "error" : "offline"); return; }
        if (!data) { setStatus("error"); return; }
        const queue = new Set(readQueue());
        const meta = readMeta();
        let applied = 0;
        let newest = "";

        for (const rawRow of data) {
          const row = rawRow as unknown as SyncRow;
          const rawKey = row.key;
          const isLegacy = rawKey.startsWith("lt.");
          const key = isLegacy ? `${PACE_PREFIX}${rawKey.slice(3)}` : rawKey;
          if (!isSyncableKey(key) || queue.has(key)) continue;

          const remoteTime = Date.parse(row.updated_at);
          const localTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
          // Legacy aliases must not resurrect a value after a newer canonical
          // empty value was synced (for example, an intentionally cleared list).
          if (!Number.isFinite(remoteTime) || remoteTime <= localTime) continue;

          applyRemoteWrite(key, row.value);
          meta[key] = row.updated_at;
          if (!newest || remoteTime > Date.parse(newest)) newest = row.updated_at;
          applied++;
        }

        writeMeta(meta);
        if (newest) {
          try { localStorage.setItem("pace.__last_sync_at", newest); } catch {}
        }
        if (applied > 0) setStatus("ok");
      } catch {
        if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
      } finally {
        pulling = false;
      }
    };

    const syncNow = async () => {
      if (cancelled) return;
      if (!allowed()) { setStatus("idle"); return; }
      if (!navigator.onLine) { setStatus("offline"); return; }
      await flushQueue();
      await pull();
    };

    // Realtime is the low-egress fast path. Keep the existing full pull as an
    // initial/recovery reconciliation, but do not repeat it every 15 seconds
    // while the per-user channel is healthy.
    let realtimeHealthy = false;
    const applyRemoteRow = (row: SyncRow) => {
      if (
        cancelled ||
        !allowed() ||
        !navigator.onLine ||
        !row ||
        typeof row.key !== "string" ||
        !Object.prototype.hasOwnProperty.call(row, "value")
      ) return;
      if (row.updated_by === DEVICE_ID) return;
      const isLegacy = row.key.startsWith("lt.");
      const key = isLegacy ? `${PACE_PREFIX}${row.key.slice(3)}` : row.key;
      if (!isSyncableKey(key)) return;

      // Local edits win until the queued write has been acknowledged. Realtime
      // must never race a local mutation and silently replace its value.
      if (readQueue().includes(key)) return;
      const remoteTime = Date.parse(row.updated_at);
      if (!Number.isFinite(remoteTime)) return;

      const meta = readMeta();
      const localTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
      // A stale legacy alias must never replace a newer canonical value,
      // including an intentionally empty list or object.
      if (remoteTime <= localTime) return;

      applyRemoteWrite(key, row.value);
      meta[key] = row.updated_at;
      writeMeta(meta);
      try { localStorage.setItem("pace.__last_sync_at", row.updated_at); } catch {}
      setStatus("ok");
    };

    const realtimeChannel = supabase.channel(`pace-user-state-${user.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "user_state",
        filter: `user_id=eq.${user.id}`,
      }, (payload) => applyRemoteRow(payload.new as SyncRow))
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "user_state",
        filter: `user_id=eq.${user.id}`,
      }, (payload) => applyRemoteRow(payload.new as SyncRow));

    void realtimeChannel.subscribe((subscriptionStatus) => {
      if (cancelled) return;
      if (subscriptionStatus === "SUBSCRIBED") {
        realtimeHealthy = true;
        // Reconcile after subscribing to close the gap between the initial
        // snapshot and the channel becoming active.
        void syncNow();
      } else if (
        subscriptionStatus === "CHANNEL_ERROR" ||
        subscriptionStatus === "TIMED_OUT" ||
        subscriptionStatus === "CLOSED"
      ) {
        realtimeHealthy = false;
        setStatus(navigator.onLine ? "error" : "offline");
      }
    });

    const offLocal = onLocalWrite((key) => {
      if (!allowed() || !isSyncableKey(key)) return;
      queueKey(key);
      void pushKeyNow(key);
    });

    const onOnline = () => { void syncNow(); };
    const onOffline = () => setStatus("offline");
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    const onPageShow = () => { void syncNow(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    void syncNow();

    // A 60-second reconciliation is only a fallback when Realtime is down.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !realtimeHealthy) void syncNow();
    }, 60_000);

    return () => {
      cancelled = true;
      offLocal();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.clearInterval(interval);
      void supabase.removeChannel(realtimeChannel);
    };
  }, [user, legalRevision]);

  return { status, queuedCount: readQueue().length };
}

const SyncStatusContext = createContext<SyncStatus>("idle");
export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { status } = useCloudSyncEngineInternal();
  return <SyncStatusContext.Provider value={status}>{children}</SyncStatusContext.Provider>;
}
export function useCloudSyncStatus(): SyncStatus { return useContext(SyncStatusContext); }