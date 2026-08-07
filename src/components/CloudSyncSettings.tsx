import { Cloud, CloudOff, RefreshCw, Check } from "lucide-react";
import { useCloudSyncStatus } from "@/hooks/use-cloud-sync-engine";
import { useAuth } from "@/hooks/use-auth";

const LABELS: Record<string, string> = {
  idle: "En veille",
  syncing: "Synchronisation…",
  ok: "Synchronisé",
  error: "Erreur de synchronisation — nouvelle tentative automatique",
  offline: "Hors ligne — en attente de connexion",
};

export function CloudSyncSettings() {
  const { user } = useAuth();
  const status = useCloudSyncStatus();

  const Icon = status === "syncing" ? RefreshCw : status === "offline" ? CloudOff : status === "ok" ? Check : Cloud;

  return (
    <div className="flex items-center gap-4 rounded-2xl glass-card p-4">
      <div className="size-10 rounded-xl bg-muted grid place-items-center text-foreground">
        <Icon className={`size-4 ${status === "syncing" ? "animate-spin" : ""}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">Synchronisation cloud</div>
        <div className="text-xs text-muted-foreground">
          {user
            ? "Automatique sur tous tes appareils (quelques secondes de délai) — rien à faire."
            : "Connecte-toi pour activer la sync."}
        </div>
      </div>
      {user && <div className="text-xs text-muted-foreground shrink-0">{LABELS[status]}</div>}
    </div>
  );
}
