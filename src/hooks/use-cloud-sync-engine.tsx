import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";

const PACE_PREFIX = "pace.";
const EXCLUDED = new Set<string>(["pace.sport.active"]);
const POLL_MS = 15000;
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

function readQueue(): string[] { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); } catch { return []; } }
function writeQueue(keys: string[]) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify([...new Set(keys)])); } catch {} }
function queueKey(key: string) { if (!key.startsWith(PACE_PREFIX) || EXCLUDED.has(key)) return; writeQueue([...readQueue(), key]); }
function unqueueKey(key: string) { writeQueue(readQueue().filter((k) => k !== key)); }
function readMeta(): SyncMeta { try { return JSON.parse(localStorage.getItem(META_KEY) ?? "{}"); } catch { return {}; } }
function writeMeta(meta: SyncMeta) { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {} }
function markLocal(key: string, timestamp: string) { const meta = readMeta(); meta[key] = timestamp; writeMeta(meta); }

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
  const running = useRef(false);
  const keyWrites = useRef<Record<string, Promise<void>>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    try { if (!isLegalCategoryAllowed("sync_cloud")) return; } catch { return; }
    let cancelled = false;

    const pushKeyNow = async (key: string) => {
      if (cancelled || EXCLUDED.has(key) || !key.startsWith(PACE_PREFIX)) return;
      queueKey(key);

      const previous = keyWrites.current[key] ?? Promise.resolve();
      const current = previous.then(async () => {
        if (cancelled) return;
        if (!navigator.onLine) { setStatus("offline"); return; }

        let value: unknown;
        try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return; }
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

          // true = our mutation won; false = the server already had a newer row.
          // In the latter case, immediately pull the authoritative value instead
          // of allowing this stale local state to remain marked as current.
          if (data === false) {
            const { data: rows } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id).eq("key", key).limit(1);
            const row = rows?.[0] as SyncRow | undefined;
            if (row) {
              applyRemoteWrite(key, row.value);
              markLocal(key, row.updated_at);
            }
          } else {
            markLocal(key, updatedAt);
            localStorage.setItem("pace.__last_sync_at", updatedAt);
          }

          unqueueKey(key);
          setStatus("ok");
        } catch {
          if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
        }
      });

      keyWrites.current[key] = current.catch(() => undefined);
      await current;
    };

    const flushQueue = async () => {
      if (cancelled || !navigator.onLine || running.current) return;
      const queue = readQueue();
      if (!queue.length) return;
      running.current = true;
      try { for (const key of queue) await pushKeyNow(key); }
      finally { running.current = false; }
    };

    const pull = async () => {
      if (cancelled || !navigator.onLine || running.current) return;
      try {
        const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id);
        if (error || !data || cancelled) return;
        const queue = new Set(readQueue());
        const meta = readMeta();
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
          try { if (localRaw !== null) localValue = JSON.parse(localRaw); } catch {}
          const shouldRecoverLegacy = isLegacy && isEmptyValue(localValue) && !isEmptyValue(row.value);

          const remoteTime = Date.parse(row.updated_at);
          const localTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
          if (!shouldRecoverLegacy && (!Number.isFinite(remoteTime) || remoteTime <= localTime)) continue;

          applyRemoteWrite(key, row.value);
          meta[key] = row.updated_at;
          newest = row.updated_at;
          applied++;
        }

        writeMeta(meta);
        if (newest) localStorage.setItem("pace.__last_sync_at", newest);
        if (applied > 0) setStatus("ok");
      } catch {
        if (!cancelled && !navigator.onLine) setStatus("offline");
      }
    };

    const syncNow = async () => {
      if (!navigator.onLine) { setStatus("offline"); return; }
      await flushQueue();
      await pull();
    };

    const offLocal = onLocalWrite((key) => {
      if (EXCLUDED.has(key) || !key.startsWith(PACE_PREFIX)) return;
      queueKey(key);
      void pushKeyNow(key);
    });

    const onOnline = () => { void syncNow(); };
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void syncNow();
    const interval = window.setInterval(() => void syncNow(), POLL_MS);

    return () => {
      cancelled = true;
      offLocal();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.clearInterval(interval);
    };
  }, [user]);

  return { status, queuedCount: readQueue().length };
}

const SyncStatusContext = createContext<SyncStatus>("idle");
export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { status } = useCloudSyncEngineInternal();
  return <SyncStatusContext.Provider value={status}>{children}</SyncStatusContext.Provider>;
}
export function useCloudSyncStatus(): SyncStatus { return useContext(SyncStatusContext); }