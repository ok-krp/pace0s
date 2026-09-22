import { useCloudSyncStatus, type SyncConflict } from "@/hooks/use-cloud-sync-engine";

const MAX_SUMMARY_LENGTH = 180;

function summarize(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > MAX_SUMMARY_LENGTH ? text.slice(0, MAX_SUMMARY_LENGTH - 3) + "..." : text;
  } catch {
    return String(value);
  }
}

function labelForKey(key: string): string {
  return key.replace(/^pace\./, "").replace(/^domain\./, "").replaceAll(".", " › ");
}

export function SyncConflictResolver() {
  const { conflicts, resolveConflict } = useCloudSyncStatus();
  if (!conflicts.length) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[80] md:inset-x-auto md:right-5 md:bottom-5 md:w-[460px]">
      {conflicts.map((conflict: SyncConflict) => (
        <section key={conflict.id} className="border border-border bg-background/95 p-4 shadow-2xl backdrop-blur-[6px]" role="alert">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">Données désynchronisées</p>
              <p className="mt-1 text-xs text-muted-foreground">{labelForKey(conflict.key)}</p>
            </div>
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Sync</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Pace a détecté une modification locale et une modification venant d’un autre appareil. Rien n’est écrasé tant que tu n’as pas choisi.
          </p>
          <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground">
            <div className="border border-border/70 p-2"><span className="font-medium text-foreground">Cet appareil</span><pre className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap">{summarize(conflict.localValue)}</pre></div>
            <div className="border border-border/70 p-2"><span className="font-medium text-foreground">Autre appareil</span><pre className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap">{summarize(conflict.remoteValue)}</pre></div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => void resolveConflict(conflict.id, "merge")} className="border border-primary bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Fusionner</button>
            <button type="button" onClick={() => void resolveConflict(conflict.id, "local")} className="border border-border px-3 py-2 text-xs font-medium">Garder cet appareil</button>
            <button type="button" onClick={() => void resolveConflict(conflict.id, "remote")} className="border border-border px-3 py-2 text-xs font-medium">Garder l’autre</button>
          </div>
        </section>
      ))}
    </div>
  );
}
