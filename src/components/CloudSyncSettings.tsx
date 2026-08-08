import { Cloud, Download, Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCloudSync } from "@/hooks/use-cloud-sync";
import { useAuth } from "@/hooks/use-auth";

export function CloudSyncSettings() {
  const { user } = useAuth();
  const { status, lastMessage, pushAll, pullAll, available } = useCloudSync();

  return (
    <div className="rounded-2xl glass-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-muted grid place-items-center text-foreground shrink-0">
          <Cloud className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">Synchronisation cloud</div>
          <div className="text-xs text-muted-foreground">
            {user ? "Sauvegarde et restauration manuelles entre tes appareils." : "Connecte-toi pour activer la sync."}
          </div>
        </div>
      </div>

      {user && (
        <>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1 rounded-xl" disabled={!available || status === "syncing"} onClick={() => pushAll()}>
              {status === "syncing" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Upload className="size-3.5 mr-1.5" />}
              Sauvegarder
            </Button>
            <Button size="sm" variant="secondary" className="flex-1 rounded-xl" disabled={!available || status === "syncing"} onClick={() => pullAll(true)}>
              {status === "syncing" ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Download className="size-3.5 mr-1.5" />}
              Restaurer
            </Button>
          </div>
          {lastMessage && (
            <div className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{lastMessage}</div>
          )}
          <p className="text-[11px] text-muted-foreground">
            "Sauvegarder" envoie les données de cet appareil vers le Cloud. "Restaurer" ramène ici les dernières données sauvegardées (recharge la page).
          </p>
        </>
      )}
    </div>
  );
}
