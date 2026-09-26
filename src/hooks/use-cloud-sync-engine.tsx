import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";
import { readDomain, sanitizeNutritionItems } from "@/lib/domain-store";

const PACE_PREFIX = "pace.";
const INTERNAL_PREFIX = "pace.__";
const DOMAIN_PREFIX = "pace.domain.";
const DOMAIN_OUTBOX_KEY = "pace.domain.outbox";
const EXCLUDED = new Set<string>(["pace.sport.active"]);
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
function serialize(value: unknown) { try { return JSON.stringify(value); } catch { return undefined; } }
function readConflicts(): SyncConflict[] { try { const raw = JSON.parse(localStorage.getItem(CONFLICTS_KEY) ?? "[]") as SyncConflict[]; return Array.isArray(raw) ? raw.filter((item) => item?.id && item?.key) : []; } catch { return []; } }
function writeConflicts(items: SyncConflict[]) { try { localStorage.setItem(CONFLICTS_KEY, JSON.stringify(items.slice(-20))); } catch {} }
function conflictForKey(key: string): SyncConflict | undefined { return readConflicts().find((item) => item.key === key); }

function unwrapNutritionValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const candidate = value as Record<string, unknown>;
  if (candidate.version === 1 && typeof candidate.updatedAt === "string" && typeof candidate.mutationId === "string" && "value" in candidate) return candidate.value;
  return value;
}

function mergeNutritionRemoteValue(incomingValue: unknown, authoritative = false) {
  const incoming = unwrapNutritionValue(incomingValue);
  if (authoritative) return sanitizeNutritionItems(incoming);
  const current = readDomain<Record<string, unknown>>("nutrition.items", {}).value;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming) || !current || typeof current !== "object" || Array.isArray(current)) return sanitizeNutritionItems(incoming);
  const merged: Record<string, unknown> = { ...(current as Record<string, unknown>) };
  for (const [day, rawIncoming] of Object.entries(incoming as Record<string, unknown>)) {
    if (!Array.isArray(rawIncoming)) continue;
    const local = Array.isArray(merged[day]) ? merged[day] as unknown[] : [];
    const byId = new Set(local.map((item) => item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? "") : "").filter(Boolean));
    const output = [...local];
    for (const item of rawIncoming) {
      const id = item && typeof item === "object" ? String((item as Record<string, unknown>).id ?? "") : "";
      if (id && byId.has(id)) {
        const index = output.findIndex((existing) => existing && typeof existing === "object" && String((existing as Record<string, unknown>).id ?? "") === id);
        if (index >= 0) output[index] = item;
      } else {
        output.push(item);
        if (id) byId.add(id);
      }
    }
    merged[day] = output;
  }
  return sanitizeNutritionItems(merged);
}

function isAuthoritativeNutritionWriter(updatedBy: string | null | undefined) {
  return updatedBy === "coach_ai" || updatedBy === "nutrition_state_repair";
}

export function useCloudSyncEngineInternal() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const running = useRef(false);
  const keyWrites = useRef<Record<string, Promise<void>>>({});
  const lastRemoteValues = useRef<Record<string, string>>({});

  const rememberRemote = (key: string, value: unknown) => {
    const encoded = serialize(value);
    if (encoded !== undefined) lastRemoteValues.current[key] = encoded;
  };
  const applyRemoteAndRemember = (key: string, value: unknown, updatedAt: string, updatedBy?: string | null) => {
    const safeValue = key === "pace.nutrition.items" ? mergeNutritionRemoteValue(value, isAuthoritativeNutritionWriter(updatedBy)) : value;
    rememberRemote(key, safeValue);
    applyRemoteWrite(key, safeValue, updatedAt);
  };

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    let cancelled = false;
    const allowed = () => { try { return isLegalCategoryAllowed("sync_cloud"); } catch { return false; } };

    const recordConflict = (key: string, localValue: unknown, remoteValue: unknown, remoteUpdatedAt: string) => {
      if (serialize(localValue) === serialize(remoteValue)) return;
      const existing = conflictForKey(key);
      if (existing && serialize(existing.remoteValue) === serialize(remoteValue)) return;
      const next: SyncConflict = { id: `${key}:${Date.now()}`, key, localValue, remoteValue, remoteUpdatedAt, detectedAt: new Date().toISOString() };
      const all = [...readConflicts().filter((item) => item.key !== key), next]; writeConflicts(all); setConflicts(all);
    };

    const writeItem = async (item: QueueItem): Promise<boolean> => {
      if (conflictForKey(item.key)) return false;

      // A lost RPC response must be idempotent: if the canonical row already
      // contains this exact value, acknowledge the queue item without writing again.
      const { data: existingRows, error: existingError } = await supabase
        .from("user_state")
        .select("key,value,updated_at,updated_by")
        .eq("user_id", user.id)
        .eq("key", item.key)
        .limit(1);
      if (existingError) throw existingError;
      const existing = existingRows?.[0] as SyncRow | undefined;
      if (existing && serialize(existing.value) === serialize(item.value)) {
        markVersion(existing.key, existing.updated_at);
        localStorage.setItem("pace.__last_sync_at", existing.updated_at);
        return true;
      }

      const rpc = supabase.rpc as unknown as (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown | null }>;
      const result = await rpc("upsert_user_state_if_newer", {
        p_user_id: user.id,
        p_key: item.key,
        p_value: item.value,
        // Kept for RPC compatibility. Ordering is server-authoritative.
        p_updated_at: item.updatedAt,
        p_updated_by: DEVICE_ID,
      });
      if (result?.error) throw result.error;
      const payload = result?.data as ServerWriteResult | null;
      if (!payload || typeof payload.accepted !== "boolean" || typeof payload.updated_at !== "string") {
        throw new Error("invalid cloud sync write response");
      }
      if (!payload.accepted) {
        const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id).eq("key", item.key).limit(1);
        if (error) throw error;
        const row = data?.[0] as SyncRow | undefined;
        if (!row) throw new Error("cloud sync row disappeared");
        applyRemoteAndRemember(row.key, row.value, row.updated_at, row.updated_by);
        markVersion(row.key, row.updated_at);
        return false;
      }
      markVersion(item.key, payload.updated_at);
      localStorage.setItem("pace.__last_sync_at", payload.updated_at);
      return true;
    };

    const pushItem = async (item: QueueItem) => {
      if (cancelled || !allowed() || !isSyncableKey(item.key) || !navigator.onLine) return;
      const previous = keyWrites.current[item.key] ?? Promise.resolve();
      const current = previous.then(async () => {
        if (cancelled || !allowed() || !navigator.onLine) return;
        const latest = getQueued(item.key);
        if (!latest || latest.updatedAt !== item.updatedAt) return;
        let accepted = false;
        try {
          accepted = await writeItem(latest);
        } catch {
          throw new Error("cloud write failed");
        }
        if (cancelled) return;
        if (accepted) {
          localStorage.setItem("pace.__last_sync_at", readMeta()[latest.key] ?? latest.updatedAt);
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
      if (queued) { recordConflict(row.key, queued.value, row.value, row.updated_at); return; }
      const domain = readDomainRecord(row.key);
      if (domain && Date.parse(domain.updatedAt) >= remoteTime && !isEmptyRecoveredValue(domain.value)) return;
      applyRemoteAndRemember(row.key, row.value, row.updated_at, row.updated_by);
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
        const grouped = new Map<string, { canonical?: SyncRow; legacy?: SyncRow }>();
        for (const raw of data) {
          const row = raw as unknown as SyncRow;
          const key = row.key.startsWith("lt.") ? `${PACE_PREFIX}${row.key.slice(3)}` : row.key;
          if (!isSyncableKey(key)) continue;
          const bucket = grouped.get(key) ?? {};
          if (row.key.startsWith("lt.")) bucket.legacy = row;
          else bucket.canonical = row;
          grouped.set(key, bucket);
        }
        let newest = "";
        for (const [key, bucket] of grouped) {
          const canonical = bucket.canonical;
          const legacy = bucket.legacy;
          const mergedValue = legacy ? mergeRecoveredValues(legacy.value, canonical?.value) : canonical?.value;
          const sourceTime = Math.max(Date.parse(canonical?.updated_at ?? "1970-01-01T00:00:00.000Z"), Date.parse(legacy?.updated_at ?? "1970-01-01T00:00:00.000Z"));
          if (!Number.isFinite(sourceTime)) continue;
          const updatedAt = new Date(sourceTime).toISOString();
          const localDomain = readDomainRecord(key);
          const localIsEmpty = localDomain ? isEmptyRecoveredValue(localDomain.value) : true;
          const localTime = Date.parse(meta[key] ?? "1970-01-01T00:00:00.000Z");
          const queued = getQueued(key);
          if (queued) {
            if (serialize(queued.value) === serialize(mergedValue)) {
              unqueueIfMutation(key, queued.updatedAt);
              meta[key] = updatedAt;
              newest = newest && Date.parse(newest) > sourceTime ? newest : updatedAt;
              continue;
            }
            recordConflict(key, queued.value, mergedValue, updatedAt);
            continue;
          }
          if (sourceTime <= localTime && !localIsEmpty) continue;
          applyRemoteAndRemember(key, mergedValue, updatedAt, canonical?.updated_by ?? legacy?.updated_by);
          meta[key] = updatedAt;
          newest = newest && Date.parse(newest) > sourceTime ? newest : updatedAt;
          if (legacy && canonical && serialize(mergedValue) !== serialize(canonical.value)) {
            const recoveryTime = new Date().toISOString();
            try {
              await supabase.rpc("upsert_user_state_if_newer", {
                p_user_id: user.id,
                p_key: key,
                p_value: mergedValue as never,
                p_updated_at: recoveryTime,
                p_updated_by: "state_recovery_v4",
              });
              meta[key] = recoveryTime;
              newest = recoveryTime;
            } catch {}
          }
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
    let realtimeRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let realtimeRetryAttempt = 0;
    const retryRealtime = () => {
      if (cancelled || realtimeRetryTimer) return;
      const delay = Math.min(30_000, 1_000 * 2 ** realtimeRetryAttempt);
      realtimeRetryAttempt = Math.min(realtimeRetryAttempt + 1, 5);
      realtimeRetryTimer = setTimeout(() => {
        realtimeRetryTimer = null;
        if (cancelled) return;
        void realtimeChannel.subscribe((subscriptionStatus) => {
          if (subscriptionStatus === "SUBSCRIBED") {
            realtimeRetryAttempt = 0;
            void syncNow();
          } else if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT" || subscriptionStatus === "CLOSED") {
            setStatus(navigator.onLine ? "error" : "offline");
            retryRealtime();
          }
        });
      }, delay);
    };
    void realtimeChannel.subscribe((subscriptionStatus) => {
      if (subscriptionStatus === "SUBSCRIBED") {
        realtimeRetryAttempt = 0;
        void pull();
      } else if (subscriptionStatus === "CHANNEL_ERROR" || subscriptionStatus === "TIMED_OUT" || subscriptionStatus === "CLOSED") {
        setStatus(navigator.onLine ? "error" : "offline");
        retryRealtime();
      }
    });

    const offLocal = onLocalWrite((key, value, updatedAt, mutationId) => {
      if (!isSyncableKey(key) || !allowed() || !updatedAt) return;
      const encoded = serialize(value);
      if (encoded !== undefined && lastRemoteValues.current[key] === encoded) { delete lastRemoteValues.current[key]; return; }
      delete lastRemoteValues.current[key];
      queueItem({ key, value, updatedAt, mutationId });
      void pushItem({ key, value, updatedAt, mutationId });
    });

    const onOnline = () => {
      realtimeRetryAttempt = 0;
      void syncNow();
      void realtimeChannel.subscribe();
    };
    const onOffline = () => setStatus("offline");
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        realtimeRetryAttempt = 0;
        void syncNow();
        void realtimeChannel.subscribe();
      }
    };
    const onPageShow = () => {
      void syncNow();
      void realtimeChannel.subscribe();
    };
    const onLegalChanged = () => { if (allowed()) void syncNow(); else setStatus("idle"); };
    const onConflictResolved = () => { void syncNow(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pace.legal.changed", onLegalChanged);
    window.addEventListener("pace.sync.conflict.resolved", onConflictResolved);
    setConflicts(readConflicts());
    void syncNow();
    return () => {
      cancelled = true; offLocal();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pace.legal.changed", onLegalChanged);
      window.removeEventListener("pace.sync.conflict.resolved", onConflictResolved);
      if (realtimeRetryTimer) clearTimeout(realtimeRetryTimer);
      realtimeRetryTimer = null;
      void supabase.removeChannel(realtimeChannel);
    };
  }, [user]);

  const resolveConflict = useCallback(async (conflictId: string, choice: "local" | "remote" | "merge") => {
    const conflict = readConflicts().find((item) => item.id === conflictId); if (!conflict) return;
    const merged = choice === "merge" ? mergeRecoveredValues(conflict.remoteValue, conflict.localValue) : choice === "local" ? conflict.localValue : conflict.remoteValue;
    if (choice === "remote") { applyRemoteWrite(conflict.key, conflict.remoteValue, conflict.remoteUpdatedAt); unqueueIfMutation(conflict.key, getQueued(conflict.key)?.updatedAt ?? ""); markVersion(conflict.key, conflict.remoteUpdatedAt); }
    else { const updatedAt = new Date().toISOString(); applyRemoteWrite(conflict.key, merged, updatedAt); queueItem({ key: conflict.key, value: merged, updatedAt, mutationId: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : updatedAt }); }
    const remaining = readConflicts().filter((item) => item.id !== conflictId); writeConflicts(remaining); setConflicts(remaining); window.dispatchEvent(new Event("pace.sync.conflict.resolved"));
  }, []);

  return { status, queuedCount: readQueue().length, conflicts, resolveConflict };
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
