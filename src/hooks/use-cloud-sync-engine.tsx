import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";

const PACE_PREFIX = "pace.";
const DOMAIN_PREFIX = "pace.domain.";
const EXCLUDED = new Set<string>(["pace.sport.active"]);
const POLL_MS = 15000;
const QUEUE_KEY = "pace.__sync_queue";
const META_KEY = "pace.__sync_meta";
const DEVICE_KEY = "pace.__sync_device_id";
const DEVICE_ID = getDeviceId();

type SyncMeta = Record<string, string>;
export type SyncStatus = "idle" | "syncing" | "ok" | "error" | "offline";
type SyncRow = { key: string; value: unknown; updated_at: string; updated_by: string | null };
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
function readDomainRecord(key: string): DomainRecord | null {
  if (!key.startsWith(PACE_PREFIX)) return null;
  try {
    const raw = localStorage.getItem(`${DOMAIN_PREFIX}${key.slice(PACE_PREFIX.length)}`);
    if (!raw) return null;
    const record = JSON.parse(raw) as DomainRecord;
    if (record?.version !== 1 || typeof record.updatedAt !== "string" || typeof record.mutationId !== "string" || !("value" in record)) return null;
    return record;
  } catch { return null; }
}
function writeDomainRecordFromRemote(key: string, value: unknown, updatedAt: string) {
  if (!key.startsWith(PACE_PREFIX) || EXCLUDED.has(key)) return;
  try {
    const existing = readDomainRecord(key);
    if (existing && Date.parse(existing.updatedAt) > Date.parse(updatedAt)) return;
    localStorage.setItem(`${DOMAIN_PREFIX}${key.slice(PACE_PREFIX.length)}`, JSON.stringify({ version: 1, updatedAt, mutationId: `remote-${updatedAt}-${DEVICE_ID}`, value } satisfies DomainRecord));
  } catch {}
}

export function useCloudSyncEngineInternal() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const running = useRef(false);
  const keyWrites = useRef<Record<string, Promise<void>>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    let cancelled = false;
    const cloudSyncAllowed = () => { try { return isLegalCategoryAllowed("sync_cloud"); } catch { return false; } };

    const pushKeyNow = async (key: string) => {
      if (cancelled || EXCLUDED.has(key) || !key.startsWith(PACE_PREFIX) || !cloudSyncAllowed()) return;
      queueKey(key);
      const previous = keyWrites.current[key] ?? Promise.resolve();
      const current = previous.then(async () => {
        if (cancelled || !cloudSyncAllowed()) return;
        if (!navigator.onLine) { setStatus("offline"); return; }
        let value: unknown;
        try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return; }
        const updatedAt = new Date().toISOString();
        setStatus("syncing");
        try {
          let rpcError: unknown = null;
          let accepted: boolean | null = null;
          try {
            const result = await (supabase.rpc as never)("upsert_user_state_if_newer", { p_user_id: user.id, p_key: key, p_value: value, p_updated_at: updatedAt, p_updated_by: DEVICE_ID });
            rpcError = result?.error ?? null;
            accepted = result?.data === false ? false : result?.data === true ? true : null;
          } catch (error) { rpcError = error; }

          // Backward-compatible fallback for databases where the RPC migration has not yet been applied.
          if (rpcError) {
            const { error } = await supabase.from("user_state").upsert(
              { user_id: user.id, key, value, updated_at: updatedAt, updated_by: DEVICE_ID } as never,
              { onConflict: "user_id,key" },
            );
            if (error) throw error;
            accepted = true;
          }

          if (cancelled) return;
          if (accepted === false) {
            const { data: rows, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id).eq("key", key).limit(1);
            if (error) throw error;
            const row = rows?.[0] as SyncRow | undefined;
            if (row) {
              applyRemoteWrite(key, row.value);
              writeDomainRecordFromRemote(key, row.value, row.updated_at);
              markLocal(key, row.updated_at);
            }
          } else {
            markLocal(key, updatedAt);
            writeDomainRecordFromRemote(key, value, updatedAt);
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
      if (cancelled || !cloudSyncAllowed() || !navigator.onLine || running.current) return;
      const queue = readQueue();
      if (!queue.length) return;
      running.current = true;
      try { for (const key of queue) await pushKeyNow(key); } finally { running.current = false; }
    };

    const applyRemoteRow = (row: SyncRow) => {
      if (cancelled || !row.key.startsWith(PACE_PREFIX) || EXCLUDED.has(row.key)) return;
      if (row.updated_by === DEVICE_ID) return;
      const meta = readMeta();
      const remoteTime = Date.parse(row.updated_at);
      const localTime = Date.parse(meta[row.key] ?? "1970-01-01T00:00:00.000Z");
      if (!Number.isFinite(remoteTime) || remoteTime <= localTime) return;
      const domain = readDomainRecord(row.key);
      const domainTime = domain ? Date.parse(domain.updatedAt) : Number.NaN;
      if (Number.isFinite(domainTime) && domainTime >= remoteTime) return;
      applyRemoteWrite(row.key, row.value);
      writeDomainRecordFromRemote(row.key, row.value, row.updated_at);
      meta[row.key] = row.updated_at;
      writeMeta(meta);
      localStorage.setItem("pace.__last_sync_at", row.updated_at);
      setStatus("ok");
    };

    const pull = async () => {
      if (cancelled || !cloudSyncAllowed() || !navigator.onLine || running.current) return;
      try {
        const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id);
        if (error || !data || cancelled) return;
        const queue = new Set(readQueue());
        const meta = readMeta();
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
          const localSyncTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
          const domainRecord = readDomainRecord(key);
          const domainTime = domainRecord ? Date.parse(domainRecord.updatedAt) : Number.NaN;
          if (!shouldRecoverLegacy && Number.isFinite(domainTime) && Number.isFinite(remoteTime) && domainTime > remoteTime) { queueKey(key); continue; }
          if (!shouldRecoverLegacy && (!Number.isFinite(remoteTime) || remoteTime <= localSyncTime)) continue;
          applyRemoteWrite(key, row.value);
          writeDomainRecordFromRemote(key, row.value, row.updated_at);
          meta[key] = row.updated_at;
          newest = row.updated_at;
        }
        writeMeta(meta);
        if (newest) localStorage.setItem("pace.__last_sync_at", newest);
        if (newest) setStatus("ok");
      } catch { if (!cancelled && !navigator.onLine) setStatus("offline"); }
    };

    const syncNow = async () => {
      if (!cloudSyncAllowed()) return;
      if (!navigator.onLine) { setStatus("offline"); return; }
      await flushQueue();
      await pull();
    };

    const realtimeChannel = supabase
      .channel(`pace-user-state-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "user_state", filter: `user_id=eq.${user.id}` }, (payload) => applyRemoteRow(payload.new as SyncRow))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "user_state", filter: `user_id=eq.${user.id}` }, (payload) => applyRemoteRow(payload.new as SyncRow));
    void realtimeChannel.subscribe((subscriptionStatus) => {
      if (subscriptionStatus === "SUBSCRIBED") void pull();
    });

    const offLocal = onLocalWrite((key) => {
      if (EXCLUDED.has(key) || !key.startsWith(PACE_PREFIX) || !cloudSyncAllowed()) return;
      queueKey(key);
      void pushKeyNow(key);
    });
    const onOnline = () => { void syncNow(); };
    const onOffline = () => setStatus("offline");
    const onLegalChanged = () => { if (cloudSyncAllowed()) void syncNow(); else setStatus("idle"); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pace.legal.changed", onLegalChanged);
    void syncNow();
    const interval = window.setInterval(() => void syncNow(), POLL_MS);
    return () => {
      cancelled = true;
      offLocal();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pace.legal.changed", onLegalChanged);
      window.clearInterval(interval);
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
