import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";

const PACE_PREFIX = "pace.";
const INTERNAL_PREFIX = "pace.__";
const DOMAIN_PREFIX = "pace.domain.";
const DOMAIN_OUTBOX_KEY = "pace.domain.outbox";
const EXCLUDED = new Set<string>(["pace.sport.active"]);
const QUEUE_KEY = "pace.__sync_queue";
const META_KEY = "pace.__sync_meta";
const DEVICE_KEY = "pace.__sync_device_id";
const DEVICE_ID = getDeviceId();

type SyncMeta = Record<string, string>;
export type SyncStatus = "idle" | "syncing" | "ok" | "error" | "offline";
type SyncRow = { key: string; value: unknown; updated_at: string; updated_by: string | null };
type QueueItem = { key: string; value: unknown; updatedAt: string; mutationId?: string };
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
function isSyncableKey(key: string) { return key.startsWith(PACE_PREFIX) && !key.startsWith(INTERNAL_PREFIX) && key !== DOMAIN_OUTBOX_KEY && !EXCLUDED.has(key); }
function readQueue(): QueueItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as LegacyQueue;
    if (!Array.isArray(raw)) return [];
    const meta = readMeta();
    return raw.flatMap((item) => {
      if (typeof item === "string") {
        const timestamp = meta[item];
        if (!timestamp) return [];
        let value: unknown;
        try { value = JSON.parse(localStorage.getItem(item) ?? "null"); } catch { value = null; }
        return [{ key: item, value, updatedAt: timestamp }];
      }
      return item?.key && item?.updatedAt ? [item] : [];
    });
  } catch { return []; }
}
function writeQueue(items: QueueItem[]) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items.filter((item) => isSyncableKey(item.key)))); } catch {} }
function queueItem(item: QueueItem) {
  if (!isSyncableKey(item.key) || !item.updatedAt) return;
  const next = readQueue().filter((queued) => queued.key !== item.key);
  next.push(item); writeQueue(next);
}
function getQueued(key: string) { return readQueue().find((item) => item.key === key); }
function unqueueIfMutation(key: string, updatedAt: string) { writeQueue(readQueue().filter((item) => !(item.key === key && item.updatedAt === updatedAt))); }
function readMeta(): SyncMeta { try { return JSON.parse(localStorage.getItem(META_KEY) ?? "{}"); } catch { return {}; } }
function writeMeta(meta: SyncMeta) { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch {} }
function markVersion(key: string, timestamp: string) { const meta = readMeta(); meta[key] = timestamp; writeMeta(meta); }
function readDomainRecord(key: string): DomainRecord | null {
  try {
    const storageKey = key.startsWith(DOMAIN_PREFIX) ? key : `${DOMAIN_PREFIX}${key.slice(PACE_PREFIX.length)}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const record = JSON.parse(raw) as DomainRecord;
    return record?.version === 1 && typeof record.updatedAt === "string" ? record : null;
  } catch { return null; }
}
function serialize(value: unknown) { try { return JSON.stringify(value); } catch { return undefined; } }

export function useCloudSyncEngineInternal() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const running = useRef(false);
  const keyWrites = useRef<Record<string, Promise<void>>>({});
  const lastRemoteValues = useRef<Record<string, string>>({});

  const rememberRemote = (key: string, value: unknown) => {
    const encoded = serialize(value);
    if (encoded !== undefined) lastRemoteValues.current[key] = encoded;
  };
  const applyRemoteAndRemember = (key: string, value: unknown, updatedAt: string) => {
    rememberRemote(key, value); applyRemoteWrite(key, value, updatedAt);
  };

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    let cancelled = false;
    const allowed = () => { try { return isLegalCategoryAllowed("sync_cloud"); } catch { return false; } };

    const fallbackWrite = async (item: QueueItem): Promise<boolean> => {
      const { key, value, updatedAt } = item;
      const selectCurrent = async () => {
        const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id).eq("key", key).limit(1);
        if (error) throw error;
        return (data?.[0] as SyncRow | undefined) ?? null;
      };
      let current = await selectCurrent();
      if (current && Date.parse(current.updated_at) >= Date.parse(updatedAt)) {
        applyRemoteAndRemember(key, current.value, current.updated_at); markVersion(key, current.updated_at); return false;
      }
      if (current) {
        const { data, error } = await supabase.from("user_state").update({ value, updated_at: updatedAt, updated_by: DEVICE_ID } as never).eq("user_id", user.id).eq("key", key).lt("updated_at", updatedAt).select("key,value,updated_at,updated_by");
        if (error) throw error;
        if (data?.length) return true;
        current = await selectCurrent();
        if (current) { applyRemoteAndRemember(key, current.value, current.updated_at); markVersion(key, current.updated_at); return false; }
      }
      const { error: insertError } = await supabase.from("user_state").insert({ user_id: user.id, key, value, updated_at: updatedAt, updated_by: DEVICE_ID } as never);
      if (!insertError) return true;
      if (!/duplicate|unique/i.test(insertError.message ?? "")) throw insertError;
      current = await selectCurrent();
      if (!current) throw insertError;
      if (Date.parse(current.updated_at) >= Date.parse(updatedAt)) { applyRemoteAndRemember(key, current.value, current.updated_at); markVersion(key, current.updated_at); return false; }
      throw insertError;
    };

    const pushItem = async (item: QueueItem) => {
      if (cancelled || !allowed() || !isSyncableKey(item.key) || !navigator.onLine) return;
      const previous = keyWrites.current[item.key] ?? Promise.resolve();
      const current = previous.then(async () => {
        if (cancelled || !allowed() || !navigator.onLine) return;
        // Always use the newest queued mutation for this key. Rapid edits are coalesced.
        const latest = getQueued(item.key);
        if (!latest || latest.updatedAt !== item.updatedAt) return;
        let accepted: boolean | null = null;
        try {
          const result = await (supabase.rpc as never)("upsert_user_state_if_newer", { p_user_id: user.id, p_key: latest.key, p_value: latest.value, p_updated_at: latest.updatedAt, p_updated_by: DEVICE_ID });
          if (result?.error) throw result.error;
          accepted = result?.data === true ? true : result?.data === false ? false : null;
        } catch {
          try { accepted = await fallbackWrite(latest); } catch { throw new Error("cloud write failed"); }
        }
        if (cancelled) return;
        if (accepted === false) {
          const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id).eq("key", latest.key).limit(1);
          if (error) throw error;
          const row = data?.[0] as SyncRow | undefined;
          if (row) { applyRemoteAndRemember(row.key, row.value, row.updated_at); markVersion(row.key, row.updated_at); }
        } else {
          markVersion(latest.key, latest.updatedAt); localStorage.setItem("pace.__last_sync_at", latest.updatedAt);
        }
        unqueueIfMutation(latest.key, latest.updatedAt);
        setStatus("ok");
      });
      keyWrites.current[item.key] = current.catch(() => undefined);
      try { await current; } catch { if (!cancelled) setStatus(navigator.onLine ? "error" : "offline"); }
    };

    const flushQueue = async () => {
      if (cancelled || !allowed() || !navigator.onLine || running.current) return;
      const queue = readQueue();
      if (!queue.length) return;
      running.current = true;
      try { await Promise.all(queue.map((item) => pushItem(item))); } finally { running.current = false; }
    };

    const applyRemoteRow = (row: SyncRow) => {
      if (cancelled || !isSyncableKey(row.key) || row.updated_by === DEVICE_ID) return;
      const remoteTime = Date.parse(row.updated_at);
      if (!Number.isFinite(remoteTime)) return;
      const meta = readMeta();
      const knownTime = Date.parse(meta[row.key] ?? "1970-01-01T00:00:00.000Z");
      if (remoteTime <= knownTime) return;
      const queued = getQueued(row.key);
      if (queued && Date.parse(queued.updatedAt) >= remoteTime) return;
      const domain = readDomainRecord(row.key);
      if (domain && Date.parse(domain.updatedAt) >= remoteTime) return;
      applyRemoteAndRemember(row.key, row.value, row.updated_at);
      markVersion(row.key, row.updated_at);
      localStorage.setItem("pace.__last_sync_at", row.updated_at);
      setStatus("ok");
    };

    const pull = async () => {
      if (cancelled || !allowed() || !navigator.onLine || running.current) return;
      try {
        const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id);
        if (error || !data || cancelled) return;
        const queue = new Set(readQueue().map((item) => item.key));
        const meta = readMeta();
        let newest = "";
        for (const raw of data) {
          const row = raw as unknown as SyncRow;
          const key = row.key.startsWith("lt.") ? `${PACE_PREFIX}${row.key.slice(3)}` : row.key;
          if (!isSyncableKey(key) || queue.has(key)) continue;
          const remoteTime = Date.parse(row.updated_at);
          const localTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
          if (!Number.isFinite(remoteTime) || remoteTime <= localTime) continue;
          applyRemoteAndRemember(key, row.value, row.updated_at);
          meta[key] = row.updated_at;
          newest = newest && Date.parse(newest) > remoteTime ? newest : row.updated_at;
        }
        writeMeta(meta);
        if (newest) localStorage.setItem("pace.__last_sync_at", newest);
        if (newest) setStatus("ok");
      } catch { if (!cancelled) setStatus(navigator.onLine ? "error" : "offline"); }
    };

    const syncNow = async () => {
      if (!allowed()) return;
      if (!navigator.onLine) { setStatus("offline"); return; }
      await flushQueue(); await pull();
    };

    const realtimeChannel = supabase.channel(`pace-user-state-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_state", filter: `user_id=eq.${user.id}` }, (payload) => applyRemoteRow(payload.new as SyncRow))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "user_state", filter: `user_id=eq.${user.id}` }, (payload) => applyRemoteRow(payload.new as SyncRow));
    void realtimeChannel.subscribe((subscriptionStatus) => { if (subscriptionStatus === "SUBSCRIBED") void pull(); });

    const offLocal = onLocalWrite((key, value, updatedAt, mutationId) => {
      if (!isSyncableKey(key) || !allowed() || !updatedAt) return;
      const encoded = serialize(value);
      if (encoded !== undefined && lastRemoteValues.current[key] === encoded) { delete lastRemoteValues.current[key]; return; }
      delete lastRemoteValues.current[key];
      markVersion(key, updatedAt);
      queueItem({ key, value, updatedAt, mutationId });
      void pushItem({ key, value, updatedAt, mutationId });
    });

    const onOnline = () => { void syncNow(); };
    const onOffline = () => setStatus("offline");
    const onLegalChanged = () => { if (allowed()) void syncNow(); else setStatus("idle"); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pace.legal.changed", onLegalChanged);
    void syncNow();
    return () => {
      cancelled = true; offLocal();
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
export function useCloudSyncStatus(): SyncStatus { return useContext(SyncStatusContext); }
