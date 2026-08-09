import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";

const LT_PREFIX = "pace.";
// Keys excluded from sync (volatile / device-specific)
const EXCLUDED = new Set<string>([
  "pace.sport.active", // ongoing workout — device-local
]);

export type SyncStatus = "idle" | "syncing" | "ok" | "error";

function localKeys(): string[] {
  return Object.keys(localStorage).filter((k) => k.startsWith(LT_PREFIX) && !EXCLUDED.has(k));
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
      const rows = localKeys()
        .map((k) => {
          try { return { user_id: user.id, key: k, value: JSON.parse(localStorage.getItem(k) ?? "null") }; }
          catch { return null; }
        })
        .filter(Boolean) as { user_id: string; key: string; value: unknown }[];
      if (!rows.length) { setStatus("ok"); setLastMessage("Rien à sauvegarder."); return; }
      const { error } = await supabase.from("user_state").upsert(rows as never, { onConflict: "user_id,key" });
      if (error) throw error;
      setStatus("ok"); setLastMessage(`${rows.length} clés sauvegardées.`);
    } catch (e) {
      setStatus("error"); setLastMessage(e instanceof Error ? e.message : "Erreur");
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
      const { data, error } = await supabase.from("user_state").select("key,value").eq("user_id", user.id);
      if (error) throw error;
      let n = 0;
      (data ?? []).forEach((row) => {
        // Anciennes sauvegardes cloud faites avant le renommage lt.* → pace.* :
        // on remappe la clé à la volée pour que la restauration retombe sur les
        // bonnes clés, celles que useLocalState lit réellement aujourd'hui.
        const key = row.key.startsWith("lt.") ? "pace." + row.key.slice(3) : row.key;
        if (EXCLUDED.has(key)) return;
        if (!overwrite && localStorage.getItem(key) !== null) return;
        localStorage.setItem(key, JSON.stringify(row.value));
        n++;
      });
      setStatus("ok"); setLastMessage(`${n} clés restaurées.`);
      if (n > 0) setTimeout(() => location.reload(), 800);
    } catch (e) {
      setStatus("error"); setLastMessage(e instanceof Error ? e.message : "Erreur");
    }
  }, [user]);

  return { status, lastMessage, pushAll, pullAll, available: !!user && consentAllowed };
}
