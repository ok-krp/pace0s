import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite } from "@/lib/storage";

const PACE_PREFIX = "pace.";
const EXCLUDED = new Set<string>(["pace.sport.active"]);

export type SyncStatus = "idle" | "syncing" | "ok" | "error";

function localKeys(): string[] {
  return Object.keys(localStorage).filter((k) =>
    k.startsWith(PACE_PREFIX) &&
    !k.startsWith("pace.__") &&
    !k.startsWith("pace.domain.") &&
    !EXCLUDED.has(k),
  );
}

function deviceId() {
  try {
    const key = "pace.__sync_device_id";
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return "manual-sync";
  }
}

function isNewerOrEqual(remote: string, local: string) {
  const remoteTime = Date.parse(remote);
  const localTime = Date.parse(local);
  return Number.isFinite(remoteTime) && Number.isFinite(localTime) && remoteTime >= localTime;
}

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
    if (!isLegalCategoryAllowed("sync_cloud")) {
      setStatus("error");
      setLastMessage("Consentement Synchronisation Cloud requis.");
      return;
    }
    setStatus("syncing");
    try {
      const id = deviceId();
      const keys = localKeys();
      let pushed = 0;
      let rejected = 0;
      for (const key of keys) {
        let value: unknown;
        try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { continue; }
        const updatedAt = new Date().toISOString();
        const result = await (supabase.rpc as never)("upsert_user_state_if_newer", {
          p_user_id: user.id,
          p_key: key,
          p_value: value,
          p_updated_at: updatedAt,
          p_updated_by: id,
        });
        if (result?.error) throw result.error;
        if (result?.data === false) {
          rejected++;
          const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id).eq("key", key).limit(1);
          if (error) throw error;
          const row = data?.[0] as { key: string; value: unknown; updated_at: string; updated_by: string | null } | undefined;
          if (row) applyRemoteWrite(key, row.value, row.updated_at);
        } else {
          pushed++;
        }
      }
      setStatus("ok");
      setLastMessage(`${pushed} clés synchronisées${rejected ? `, ${rejected} version${rejected > 1 ? "s" : ""} distante${rejected > 1 ? "s" : ""} conservée${rejected > 1 ? "s" : ""}` : ""}.`);
    } catch (e) {
      setStatus("error");
      setLastMessage(e instanceof Error ? e.message : "Erreur de synchronisation");
    }
  }, [user]);

  const pullAll = useCallback(async (overwrite = true) => {
    if (!user) return;
    if (!isLegalCategoryAllowed("sync_cloud")) {
      setStatus("error");
      setLastMessage("Consentement Synchronisation Cloud requis.");
      return;
    }
    setStatus("syncing");
    try {
      const { data, error } = await supabase.from("user_state").select("key,value,updated_at,updated_by").eq("user_id", user.id);
      if (error) throw error;
      let n = 0;
      const meta = (() => {
        try { return JSON.parse(localStorage.getItem("pace.__sync_meta") ?? "{}"); } catch { return {}; }
      })() as Record<string, string>;
      (data ?? []).forEach((rawRow) => {
        const row = rawRow as { key: string; value: unknown; updated_at: string; updated_by: string | null };
        const key = row.key.startsWith("lt.") ? "pace." + row.key.slice(3) : row.key;
        if (!key.startsWith(PACE_PREFIX) || key.startsWith("pace.__") || key.startsWith("pace.domain.") || EXCLUDED.has(key)) return;
        const localUpdatedAt = meta[key] ?? "1970-01-01T00:00:00.000Z";
        if (!overwrite && localStorage.getItem(key) !== null) return;
        if (overwrite || !isNewerOrEqual(localUpdatedAt, row.updated_at)) {
          applyRemoteWrite(key, row.value, row.updated_at);
          meta[key] = row.updated_at;
          n++;
        }
      });
      localStorage.setItem("pace.__sync_meta", JSON.stringify(meta));
      setStatus("ok");
      setLastMessage(`${n} clés restaurées.`);
    } catch (e) {
      setStatus("error");
      setLastMessage(e instanceof Error ? e.message : "Erreur de synchronisation");
    }
  }, [user]);

  return { status, lastMessage, pushAll, pullAll, available: !!user && consentAllowed };
}
