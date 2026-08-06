import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { isLegalCategoryAllowed } from "@/lib/legal";
import { applyRemoteWrite, onLocalWrite } from "@/lib/storage";

const LT_PREFIX = "lt.";
const EXCLUDED = new Set<string>(["lt.sport.active"]); // en cours, propre à l'appareil
const DEBOUNCE_MS = 1200;
const QUEUE_KEY = "lt.__sync_queue"; // clés en attente d'envoi (hors-ligne / échec)
// Identifiant de cet onglet/appareil : sert à ignorer nos propres écritures
// quand elles reviennent via le canal temps réel (évite les boucles).
const DEVICE_ID = typeof crypto !== "undefined" ? crypto.randomUUID() : String(Math.random());

export type SyncStatus = "idle" | "syncing" | "ok" | "error" | "offline";

function readQueue(): string[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]"); } catch { return []; }
}
function writeQueue(keys: string[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(keys)); } catch {}
}

/**
 * Sync Cloud automatique et temps réel. Aucune action manuelle requise :
 * - chaque écriture locale (via useLocalState) est poussée vers Supabase après un
 *   court debounce, taguée avec l'appareil d'origine et un timestamp ;
 * - les changements des autres appareils arrivent via Realtime et sont appliqués
 *   immédiatement en local (sans recharger la page) ;
 * - hors-ligne : les clés modifiées sont mises en file d'attente locale et
 *   renvoyées automatiquement dès le retour de la connexion.
 */
export function useCloudSyncEngineInternal() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!user) return;
    if (!isLegalCategoryAllowed("sync_cloud")) return;

    let cancelled = false;

    const pushKey = async (key: string) => {
      if (EXCLUDED.has(key) || !key.startsWith(LT_PREFIX)) return;
      if (!navigator.onLine) { queueKey(key); setStatus("offline"); return; }
      let value: unknown;
      try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return; }
      setStatus("syncing");
      const { error } = await supabase.from("user_state").upsert(
        { user_id: user.id, key, value, updated_by: DEVICE_ID, updated_at: new Date().toISOString() } as never,
        { onConflict: "user_id,key" },
      );
      if (cancelled) return;
      if (error) { queueKey(key); setStatus("error"); return; }
      unqueueKey(key);
      setStatus("ok");
    };

    const queueKey = (key: string) => {
      const q = readQueue();
      if (!q.includes(key)) writeQueue([...q, key]);
    };
    const unqueueKey = (key: string) => {
      const q = readQueue();
      if (q.includes(key)) writeQueue(q.filter((k) => k !== key));
    };

    // Premier montage : on récupère ce qui existe déjà dans le Cloud (ex: nouvel
    // appareil, ou app réinstallée) — silencieux, sans bouton ni confirmation.
    const initialPull = async () => {
      const { data, error } = await supabase.from("user_state").select("key,value,updated_by").eq("user_id", user.id);
      if (error || !data) return;
      data.forEach((row) => {
        if (!row.key || EXCLUDED.has(row.key)) return;
        if (row.updated_by === DEVICE_ID) return;
        applyRemoteWrite(row.key, row.value);
      });
    };
    initialPull();

    // Écriture locale → push debouncé (regroupe les saisies rapides, ex: un slider).
    const offLocal = onLocalWrite((key) => {
      if (EXCLUDED.has(key) || !key.startsWith(LT_PREFIX)) return;
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => pushKey(key), DEBOUNCE_MS);
    });

    // Retour de connexion → on vide la file d'attente hors-ligne.
    const flushQueue = () => { readQueue().forEach((k) => pushKey(k)); };
    window.addEventListener("online", flushQueue);
    if (navigator.onLine) flushQueue(); else setStatus("offline");

    // Canal temps réel : un autre appareil modifie une donnée → on l'applique ici,
    // en direct, sans recharger la page.
    const channel = supabase
      .channel(`user_state:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_state", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as { key?: string; value?: unknown; updated_by?: string } | null;
          if (!row?.key || EXCLUDED.has(row.key)) return;
          if (row.updated_by === DEVICE_ID) return; // écho de notre propre push, on ignore
          if (payload.eventType === "DELETE") return;
          applyRemoteWrite(row.key, row.value);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      offLocal();
      window.removeEventListener("online", flushQueue);
      Object.keys(timers.current).forEach((k) => clearTimeout(timers.current[k]));
      supabase.removeChannel(channel);
    };
  }, [user]);

  return { status };
}

const SyncStatusContext = createContext<SyncStatus>("idle");

/**
 * À monter UNE SEULE FOIS, à la racine de l'app (voir __root.tsx). Fait tourner
 * le moteur de sync réel ; expose le statut à tous les composants enfants via
 * le contexte, sans dupliquer les abonnements Realtime.
 */
export function CloudSyncProvider({ children }: { children: React.ReactNode }) {
  const { status } = useCloudSyncEngineInternal();
  return <SyncStatusContext.Provider value={status}>{children}</SyncStatusContext.Provider>;
}

/** À utiliser dans n'importe quel composant (ex: l'écran Réglages) pour juste lire le statut courant. */
export function useCloudSyncStatus(): SyncStatus {
  return useContext(SyncStatusContext);
}
