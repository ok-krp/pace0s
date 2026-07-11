import { Cloud, Upload, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCloudSync } from "@/hooks/use-cloud-sync";
import { toast } from "sonner";

export function CloudSyncSettings() {
  const sync = useCloudSync();
  const busy = sync.status === "syncing";

  const onPush = async () => {
    await sync.pushAll();
    if (sync.lastMessage) toast.success(sync.lastMessage);
  };
  const onPull = async () => {
    if (!confirm("Restaurer les données depuis le cloud ? Les données locales différentes seront écrasées.")) return;
    await sync.pullAll(true);
    if (sync.lastMessage) toast.success(sync.lastMessage);
  };

  return (
    <div className="flex items-center gap-4 rounded-2xl glass-card p-4">
      <div className="size-10 rounded-xl bg-muted grid place-items-center text-foreground"><Cloud className="size-4" /></div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">Synchronisation cloud</div>
        <div className="text-xs text-muted-foreground">
          {sync.available
            ? "Sauvegardez et restaurez préférences, objectifs, sport, recettes…"
            : "Connectez-vous pour activer la sync."}
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onPush} disabled={!sync.available || busy} className="rounded-xl">
          <Upload className="size-3.5 mr-1" />Sauver
        </Button>
        <Button variant="secondary" size="sm" onClick={onPull} disabled={!sync.available || busy} className="rounded-xl">
          <Download className="size-3.5 mr-1" />Restaurer
        </Button>
      </div>
    </div>
  );
}
