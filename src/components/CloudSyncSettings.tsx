import { Cloud, Download, Upload, Loader2, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCloudSync } from "@/hooks/use-cloud-sync";
import { useCloudSyncStatus } from "@/hooks/use-cloud-sync-engine";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";

export function CloudSyncSettings() {
  const { user } = useAuth();
  const { status, lastMessage, pushAll, pullAll, available } = useCloudSync();
  const autoStatus = useCloudSyncStatus();
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

  const busy = status === "syncing";
  const autoLabel = !online || autoStatus === "offline"
    ? "Hors ligne — les modifications sont mises en file d'attente"
    : autoStatus === "error"
      ? "Synchronisation automatique — nouvelle tentative…"
      : "Synchronisation automatique active";

  return (
    <div className="rounded-2xl glass-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-muted grid place-items-center text-foreground shrink-0">
          {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">Synchronisation cloud</div>
          <div className="text-xs text-muted-foreground">
            {user ? autoLabel : "Connecte-toi pour activer la sync."}
          </div>
        </div>
        {user && <span className={`size-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`} aria-label={online ? "En ligne" : "Hors ligne"} />}
      </div>

      {user && (
        <>
          <div className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Les modifications sont enregistrées localement immédiatement. En cas de coupure, elles restent dans une file d'attente et sont envoyées automatiquement dès le retour de la connexion. Sur un autre appareil connecté au même compte, la dernière version synchronisée est appliquée automatiquement.
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1 rounded-xl" disabled={!available || busy || !online} onClick={() => pushAll()}>
              {busy ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Upload className="size-3.5 mr-1.5" />}
              Sauvegarder
            </Button>
            <Button size="sm" variant="secondary" className="flex-1 rounded-xl" disabled={!available || busy || !online} onClick={() => pullAll(true)}>
              {busy ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Download className="size-3.5 mr-1.5" />}
              Restaurer
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="rounded-xl" disabled={!available || busy || !online} onClick={() => pushAll()}>
              <RefreshCw className="size-3.5 mr-1.5" />
              Synchroniser maintenant
            </Button>
            {status === "syncing" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>

          {lastMessage && (
            <div className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{lastMessage}</div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Les boutons restent disponibles comme secours. "Sauvegarder" force l'envoi des données locales. "Restaurer" force l'application des données actuellement enregistrées dans le Cloud sur cet appareil.
          </p>
        </>
      )}
    </div>
  );
}
