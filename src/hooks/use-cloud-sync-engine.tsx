import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";

const PACE_PREFIX = "pace.";
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
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

function readQueue(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writeQueue(keys: string[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([...new Set(keys)]));
  } catch {}
}

function queueKey(key: string) {
  if (!key.startsWith(PACE_PREFIX) || EXCLUDED.has(key)) return;
  writeQueue([...readQueue(), key]);
}

function unqueueKey(key: string) {
  writeQueue(readQueue().filter((queuedKey) => queuedKey !== key));
}

function readMeta(): SyncMeta {
  try {
    const parsed = JSON.parse(localStorage.getItem(META_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMeta(meta: SyncMeta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
}

function markSynced(key: string, timestamp: string) {
  const meta = readMeta();
  meta[key] = timestamp;
  writeMeta(meta);
}

function readLocalValue(key: string): { value: unknown; serialized: string } | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return { value: null, serialized: "null" };
    return { value: JSON.parse(raw) as unknown, serialized: raw };
  } catch {
    return null;
  }
}

export function useCloudSyncEngineInternal() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const activeWrites = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    let cancelled = false;

    const cloudSyncAllowed = () => {
      try {
        return isLegalCategoryAllowed("sync_cloud");
      } catch {
        return false;
      }
    };

    const readCurrentRow = async (key: string): Promise<SyncRow | null> => {
      const { data, error } = await supabase
        .from("user_state")
        .select("key,value,updated_at,updated_by")
        .eq("user_id", user.id)
        .eq("key", key)
        .limit(1);
      if (error) throw error;
      return (data?.[0] as SyncRow | undefined) ?? null;
    };

    const fallbackWrite = async (key: string, value: unknown, updatedAt: string): Promise<boolean> => {
      let current = await readCurrentRow(key);

      if (current && Date.parse(current.updated_at) >= Date.parse(updatedAt)) {
        const latestLocal = readLocalValue(key);
        const sentSerialized = JSON.stringify(value);
        if (latestLocal?.serialized === sentSerialized) applyRemoteWrite(key, current.value, current.updated_at);
        markSynced(key, current.updated_at);
        return false;
      }

      if (current) {
        const { data, error } = await supabase
          .from("user_state")
          .update({ value, updated_at: updatedAt, updated_by: DEVICE_ID } as never)
          .eq("user_id", user.id)
          .eq("key", key)
          .lt("updated_at", updatedAt)
          .select("key,value,updated_at,updated_by");
        if (error) throw error;
        if (data?.length) return true;

        current = await readCurrentRow(key);
        if (current) {
          const latestLocal = readLocalValue(key);
          if (latestLocal?.serialized === JSON.stringify(value)) applyRemoteWrite(key, current.value, current.updated_at);
          markSynced(key, current.updated_at);
          return false;
        }
      }

      const { error: insertError } = await supabase.from("user_state").insert({
        user_id: user.id,
        key,
        value,
        updated_at: updatedAt,
        updated_by: DEVICE_ID,
      } as never);
      if (!insertError) return true;
      if (!/duplicate|unique/i.test(insertError.message ?? "")) throw insertError;

      current = await readCurrentRow(key);
      if (!current) throw insertError;
      if (Date.parse(current.updated_at) >= Date.parse(updatedAt)) {
        const latestLocal = readLocalValue(key);
        if (latestLocal?.serialized === JSON.stringify(value)) applyRemoteWrite(key, current.value, current.updated_at);
        markSynced(key, current.updated_at);
        return false;
      }
      throw insertError;
    };

    const sendCurrentValue = async (key: string): Promise<void> => {
      if (cancelled || EXCLUDED.has(key) || !key.startsWith(PACE_PREFIX) || !cloudSyncAllowed()) return;
      if (!navigator.onLine) {
        queueKey(key);
        setStatus("offline");
        return;
      }

      const local = readLocalValue(key);
      if (!local) return;
      const sentValue = local.value;
      const sentSerialized = local.serialized;
      const updatedAt = new Date().toISOString();

      setStatus("syncing");

      let accepted: boolean;
      try {
        const result = await (supabase.rpc as never)("upsert_user_state_if_newer", {
          p_user_id: user.id,
          p_key: key,
          p_value: sentValue,
          p_updated_at: updatedAt,
          p_updated_by: DEVICE_ID,
        });
        if (result?.error) {
          accepted = await fallbackWrite(key, sentValue, updatedAt);
        } else if (result?.data === true || result?.data === false) {
          accepted = result.data;
        } else {
          accepted = await fallbackWrite(key, sentValue, updatedAt);
        }
      } catch {
        accepted = await fallbackWrite(key, sentValue, updatedAt);
      }

      if (cancelled) return;

      const latest = readLocalValue(key);
      const localChangedWhileInFlight = latest?.serialized !== sentSerialized;

      if (accepted === false) {
        const current = await readCurrentRow(key);
        if (current) {
          // Never overwrite a newer user mutation that happened while this
          // request was in flight. The queued local value gets its own turn.
          if (!localChangedWhileInFlight) applyRemoteWrite(key, current.value, current.updated_at);
          markSynced(key, current.updated_at);
        }
      } else if (!localChangedWhileInFlight) {
        markSynced(key, updatedAt);
        try {
          localStorage.setItem("pace.__last_sync_at", updatedAt);
        } catch {}
      }

      if (localChangedWhileInFlight) {
        queueKey(key);
        setStatus("syncing");
        return;
      }

      unqueueKey(key);
      setStatus("ok");
    };

    const runKeyWorker = (key: string): Promise<void> => {
      const existing = activeWrites.current.get(key);
      if (existing) return existing;

      const worker = (async () => {
        try {
          while (!cancelled && cloudSyncAllowed() && navigator.onLine) {
            if (!readQueue().includes(key)) break;
            await sendCurrentValue(key);
          }
        } catch {
          queueKey(key);
          if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
        } finally {
          activeWrites.current.delete(key);
        }
      })();

      activeWrites.current.set(key, worker);
      return worker;
    };

    const flushQueue = async () => {
      if (cancelled || !cloudSyncAllowed() || !navigator.onLine) return;
      const queue = [...new Set(readQueue())];
      if (!queue.length) return;
      await Promise.all(queue.map((key) => runKeyWorker(key)));
    };

    const applyRemoteRow = (row: SyncRow) => {
      if (cancelled || !row.key.startsWith(PACE_PREFIX) || EXCLUDED.has(row.key)) return;
      if (row.updated_by === DEVICE_ID) return;

      const meta = readMeta();
      const remoteTime = Date.parse(row.updated_at);
      const localSyncTime = Date.parse(meta[row.key] ?? "1970-01-01T00:00:00.000Z");
      if (!Number.isFinite(remoteTime) || remoteTime <= localSyncTime) return;

      // Local user mutations have priority until their own write has been
      // resolved. This also prevents a late Realtime event from reverting UI.
      if (readQueue().includes(row.key) || activeWrites.current.has(row.key)) return;

      applyRemoteWrite(row.key, row.value, row.updated_at);
      markSynced(row.key, row.updated_at);
      try {
        localStorage.setItem("pace.__last_sync_at", row.updated_at);
      } catch {}
      setStatus("ok");
    };

    const pull = async () => {
      if (cancelled || !cloudSyncAllowed() || !navigator.onLine) return;
      try {
        const { data, error } = await supabase
          .from("user_state")
          .select("key,value,updated_at,updated_by")
          .eq("user_id", user.id);
        if (error || !data || cancelled) return;

        const queue = new Set(readQueue());
        const active = new Set(activeWrites.current.keys());
        const meta = readMeta();
        let newest = "";

        for (const rawRow of data) {
          const row = rawRow as unknown as SyncRow;
          if (!row.key.startsWith(PACE_PREFIX) || EXCLUDED.has(row.key)) continue;
          if (queue.has(row.key) || active.has(row.key)) continue;

          const remoteTime = Date.parse(row.updated_at);
          const localSyncTime = Date.parse(meta[row.key] ?? "1970-01-01T00:00:00.000Z");
          if (!Number.isFinite(remoteTime) || remoteTime <= localSyncTime) continue;

          applyRemoteWrite(row.key, row.value, row.updated_at);
          meta[row.key] = row.updated_at;
          if (!newest || remoteTime > Date.parse(newest)) newest = row.updated_at;
        }

        writeMeta(meta);
        if (newest) {
          try {
            localStorage.setItem("pace.__last_sync_at", newest);
          } catch {}
          setStatus("ok");
        }
      } catch {
        if (!cancelled) setStatus(navigator.onLine ? "error" : "offline");
      }
    };

    const syncNow = async () => {
      if (!cloudSyncAllowed()) return;
      if (!navigator.onLine) {
        setStatus("offline");
        return;
      }
      await flushQueue();
      await pull();
      if (!readQueue().length && !activeWrites.current.size && !cancelled) setStatus("ok");
    };

    const realtimeChannel = supabase
      .channel(`pace-user-state-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "user_state", filter: `user_id=eq.${user.id}` },
        (payload) => applyRemoteRow(payload.new as SyncRow),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "user_state", filter: `user_id=eq.${user.id}` },
        (payload) => applyRemoteRow(payload.new as SyncRow),
      );

    void realtimeChannel.subscribe((subscriptionStatus) => {
      if (subscriptionStatus === "SUBSCRIBED") void syncNow();
      if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT") setStatus("error");
    });

    const offLocal = onLocalWrite((key) => {
      if (EXCLUDED.has(key) || !key.startsWith(PACE_PREFIX) || !cloudSyncAllowed()) return;
      queueKey(key);
      void runKeyWorker(key);
    });

    const onOnline = () => void syncNow();
    const onOffline = () => setStatus("offline");
    const onLegalChanged = () => {
      if (cloudSyncAllowed()) void syncNow();
      else setStatus("idle");
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pace.legal.changed", onLegalChanged);
    void syncNow();

    return () => {
      cancelled = true;
      offLocal();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pace.legal.changed", onLegalChanged);
      void supabase.removeChannel(realtimeChannel);
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
