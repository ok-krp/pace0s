import { Cloud, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useCloudSyncStatus } from "@/hooks/use-cloud-sync-engine";
import { useAuth } from "@/hooks/use-auth";

export function CloudSyncSettings() {
  const { user } = useAuth();
  const status = useCloudSyncStatus();
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const label = !user
    ? "Connecte-toi pour activer la synchronisation."
    : !online || status === "offline"
      ? "Hors ligne — modifications conservées localement"
      : status === "syncing"
        ? "Synchronisation…"
        : status === "error"
          ? "Synchronisation impossible — nouvelle tentative automatique"
          : "Synchronisation automatique active";

  return (
    <div className="rounded-2xl glass-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-muted grid place-items-center text-foreground shrink-0">
          {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium flex items-center gap-2"><Cloud className="size-4" /> Synchronisation cloud</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
        {user && <span className={`size-2 rounded-full ${online && status !== "error" ? "bg-emerald-500" : "bg-amber-500"}`} aria-label={online ? "En ligne" : "Hors ligne"} />}
      </div>
      {user && <div className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Les modifications sont enregistrées localement immédiatement et synchronisées automatiquement. En cas de coupure, elles restent en file d'attente puis sont envoyées dès le retour de la connexion.</div>}
    </div>
  );
}
