import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";

const PACE_PREFIX = "pace.";
const EXCLUDED = new Set<string>(["pace.sport.active"]);
const DEBOUNCE_MS = 1000;
const POLL_MS = 15000;
const QUEUE_KEY = "pace.__sync_queue";
const META_KEY = "pace.__sync_meta";
const DEVICE_KEY = "pace.__sync_device_id";
const DEVICE_ID = getDeviceId();

type SyncMeta = Record<string, string>;
export type SyncStatus = "idle" | "syncing" | "ok" | "error" | "offline";

function getDeviceId() {
  if (typeof window === "undefined") return "server";
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

function readQueue(): string[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); } catch { return []; }
}
function writeQueue(keys: string[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify([...new Set(keys)])); } catch {}
}
function queueKey(key: string) {
  if (!key.startsWith(PACE_PREFIX) || EXCLUDED.has(key)) return;
  writeQueue([...readQueue(), key]);
}
function unqueueKey(key: string) {
  writeQueue(readQueue().filter((k) => k !== key));
}
function readMeta(): SyncMeta {
  try { return JSON.parse(localStorage.getItem(META_KEY) ?? "{}"); } catch { return {}; }
}
function writeMeta(meta: SyncMeta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {}
}
function markLocal(key: string, timestamp: string) {
  const meta = readMeta();
  meta[key] = timestamp;
  writeMeta(meta);
}

/**
 * Automatic cloud sync.
 *
 * Local writes are persisted immediately and queued while offline. When the
 * connection returns, queued keys are retried automatically. Remote state wins
 * only when its server timestamp is newer than the local sync timestamp, which
 * prevents an older device from overwriting a newer device during polling.
 */
export function useCloudSyncEngineInternal() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const running = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    try { if (!isLegalCategoryAllowed("sync_cloud")) return; } catch { return; }

    let cancelled = false;

    const pushKey = async (key: string) => {
      if (cancelled || EXCLUDED.has(key) || !key.startsWith(PACE_PREFIX)) return;
      if (!navigator.onLine) { queueKey(key); setStatus("offline"); return; }

      let value: unknown;
      try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return; }
      const updatedAt = new Date().toISOString();
      markLocal(key, updatedAt);
      setStatus("syncing");

      try {
        const { error } = await supabase.from("user_state").upsert(
          { user_id: user.id, key, value, updated_by: DEVICE_ID, updated_at: updatedAt } as never,
          { onConflict: "user_id,key" },
        );
        if (cancelled) return;
        if (error) {
          queueKey(key);
          setStatus("error");
          return;
        }
        unqueueKey(key);
        setStatus("ok");
      } catch {
        queueKey(key);
        if (!cancelled) setStatus("error");
      }
    };

    const flushQueue = async () => {
      if (cancelled || !navigator.onLine || running.current) return;
      const queue = readQueue();
      if (!queue.length) return;
      running.current = true;
      try {
        for (const key of queue) await pushKey(key);
      } finally {
        running.current = false;
      }
    };

    const pull = async () => {
      if (cancelled || !navigator.onLine || running.current) return;
      try {
        const { data, error } = await supabase
          .from("user_state")
          .select("key,value,updated_at,updated_by")
          .eq("user_id", user.id);
        if (error || !data || cancelled) return;

        const queue = new Set(readQueue());
        const meta = readMeta();
        let applied = 0;
        let newest = "";

        for (const row of data) {
          const rawKey = row.key as string;
          const key = rawKey.startsWith("lt.") ? `${PACE_PREFIX}${rawKey.slice(3)}` : rawKey;
          if (!key.startsWith(PACE_PREFIX) || EXCLUDED.has(key) || queue.has(key)) continue;
          if (row.updated_by === DEVICE_ID) {
            meta[key] = row.updated_at as string;
            continue;
          }

          const remoteTime = Date.parse(row.updated_at as string);
          const localTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
          if (!Number.isFinite(remoteTime) || remoteTime <= localTime) continue;

          applyRemoteWrite(key, row.value);
          meta[key] = row.updated_at as string;
          newest = row.updated_at as string;
          applied++;
        }

        writeMeta(meta);
        if (applied > 0) setStatus("ok");
        if (newest) localStorage.setItem("pace.__last_sync_at", newest);
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
      const timestamp = new Date().toISOString();
      markLocal(key, timestamp);
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => pushKey(key), DEBOUNCE_MS);
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
      Object.values(timers.current).forEach(clearTimeout);
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

export function useCloudSyncStatus(): SyncStatus {
  return useContext(SyncStatusContext);
}
