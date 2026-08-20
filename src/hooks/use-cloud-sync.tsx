import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite } from "@/lib/storage";

const PACE_PREFIX = "pace.";
const EXCLUDED = new Set<string>(["pace.sport.active"]);

type SyncStatus = "idle" | "syncing" | "ok" | "error";
type SyncRow = { key: string; value: unknown; updated_at: string; updated_by: string | null };

function localKeys(): string[] {
  return Object.keys(localStorage).filter((k) => k.startsWith(PACE_PREFIX) && !k.startsWith("pace.__") && !k.startsWith("pace.domain.") && !EXCLUDED.has(k));
}
function deviceId() {
  try {
    const key = "pace.__sync_device_id";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(key, id);
    return id;
  } catch { return "manual-sync"; }
}
function readMeta(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem("pace.__sync_meta") ?? "{}"); } catch { return {}; }
}
function writeMeta(meta: Record<string, string>) { try { localStorage.setItem("pace.__sync_meta", JSON.stringify(meta)); } catch {} }
function encoded(value: unknown) { try { return JSON.stringify(value); } catch { return undefined; } }

export function useCloudSync() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [consentAllowed, setConsentAllowed] = useState(() => isLegalCategoryAllowed("sync_cloud"));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => setConsentAllowed(isLegalCategoryAllowed("sync_cloud"));
    window.addEventListener("pace.legal.changed", refresh);
    return () => window.removeEventListener("pace.legal.changed", refresh);
  }, []);

  const pushAll = useCallback(async () => {
    if (!user) return;
    if (!isLegalCategoryAllowed("sync_cloud")) { setStatus("error"); setLastMessage("Consentement Synchronisation Cloud requis."); return; }
    setStatus("syncing");
    try {
      const id = deviceId();
      const keys = localKeys();
      const meta = readMeta();
      const { data: remoteRows, error: readError } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id);
      if (readError) throw readError;
      const remote = new Map((remoteRows ?? []).map((row) => [row.key, row as SyncRow]));
      let pushed = 0, unchanged = 0, rejected = 0;
      for (const key of keys) {
        let value: unknown;
        try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { continue; }
        const row = remote.get(key);
        const localTimestamp = meta[key] ?? "1970-01-01T00:00:00.000Z";
        if (row && encoded(row.value) === encoded(value)) { unchanged++; meta[key] = row.updated_at; continue; }
        if (row && Date.parse(row.updated_at) >= Date.parse(localTimestamp)) {
          applyRemoteWrite(key, row.value, row.updated_at);
          meta[key] = row.updated_at;
          rejected++;
          continue;
        }
        const updatedAt = localTimestamp === "1970-01-01T00:00:00.000Z" ? new Date().toISOString() : localTimestamp;
        const result = await (supabase.rpc as never)("upsert_user_state_if_newer", { p_user_id: user.id, p_key: key, p_value: value, p_updated_at: updatedAt, p_updated_by: id });
        if (result?.error) throw result.error;
        if (result?.data === false) {
          rejected++;
          const latest = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id).eq("key", key).limit(1);
          if (latest.error) throw latest.error;
          const latestRow = latest.data?.[0] as SyncRow | undefined;
          if (latestRow) { applyRemoteWrite(key, latestRow.value, latestRow.updated_at); meta[key] = latestRow.updated_at; }
        } else { pushed++; meta[key] = updatedAt; }
      }
      writeMeta(meta);
      setStatus("ok");
      setLastMessage(`${pushed} clé${pushed > 1 ? "s" : ""} synchronisée${pushed > 1 ? "s" : ""}${unchanged ? `, ${unchanged} inchangée${unchanged > 1 ? "s" : ""}` : ""}${rejected ? `, ${rejected} version${rejected > 1 ? "s" : ""} distante${rejected > 1 ? "s" : ""} conservée${rejected > 1 ? "s" : ""}` : ""}.`);
    } catch (e) {
      setStatus("error"); setLastMessage(e instanceof Error ? e.message : "Erreur de synchronisation");
    }
  }, [user]);

  const pullAll = useCallback(async (overwrite = true) => {
    if (!user) return;
    if (!isLegalCategoryAllowed("sync_cloud")) { setStatus("error"); setLastMessage("Consentement Synchronisation Cloud requis."); return; }
    setStatus("syncing");
    try {
      const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id);
      if (error) throw error;
      let n = 0;
      const meta = readMeta();
      for (const rawRow of data ?? []) {
        const row = rawRow as SyncRow;
        const key = row.key.startsWith("lt.") ? `${PACE_PREFIX}${row.key.slice(3)}` : row.key;
        if (!key.startsWith(PACE_PREFIX) || key.startsWith("pace.__") || key.startsWith("pace.domain.") || EXCLUDED.has(key)) continue;
        const localUpdatedAt = meta[key] ?? "1970-01-01T00:00:00.000Z";
        const remoteTime = Date.parse(row.updated_at), localTime = Date.parse(localUpdatedAt);
        if (!overwrite && localStorage.getItem(key) !== null) continue;
        if (!overwrite && remoteTime <= localTime) continue;
        if (encoded(JSON.parse(localStorage.getItem(key) ?? "null")) === encoded(row.value)) { meta[key] = row.updated_at; continue; }
        applyRemoteWrite(key, row.value, row.updated_at);
        meta[key] = row.updated_at;
        n++;
      }
      writeMeta(meta);
      setStatus("ok"); setLastMessage(`${n} clé${n > 1 ? "s" : ""} restaurée${n > 1 ? "s" : ""}.`);
    } catch (e) {
      setStatus("error"); setLastMessage(e instanceof Error ? e.message : "Erreur de synchronisation");
    }
  }, [user]);

  return { status, lastMessage, pushAll, pullAll, available: !!user && consentAllowed };
}
