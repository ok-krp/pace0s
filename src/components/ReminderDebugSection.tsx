import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listReminderDebug } from "@/lib/reminder-debug.functions";
import { Button } from "@/components/ui/button";
import { Bug, CheckCircle2, XCircle, MinusCircle, RefreshCw } from "lucide-react";

type Entry = {
  id: string;
  type: string;
  status: "sent" | "skipped" | "error" | string;
  reason: string | null;
  trigger: string;
  target_segment: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  hydration: "Hydratation",
  sleep: "Sommeil",
  protein: "Protéines",
  daily_summary: "Résumé",
  inactivity: "Inactivité",
};

function StatusIcon({ s }: { s: string }) {
  if (s === "sent") return <CheckCircle2 className="size-4 text-emerald-500" />;
  if (s === "error") return <XCircle className="size-4 text-destructive" />;
  return <MinusCircle className="size-4 text-muted-foreground" />;
}

export function ReminderDebugSection() {
  const list = useServerFn(listReminderDebug);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await list();
      setEntries(res.entries as Entry[]);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-muted grid place-items-center">
          <Bug className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">Mode débogage rappels</div>
          <div className="text-xs text-muted-foreground">Timeline des déclenchements cron, segments OneSignal et raisons d'annulation</div>
        </div>
        <Button variant="secondary" size="sm" className="rounded-xl" onClick={() => setOpen((v) => !v)}>
          {open ? "Masquer" : "Afficher"}
        </Button>
      </div>

      {open && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-muted-foreground">{entries.length} évènement{entries.length === 1 ? "" : "s"} (50 derniers)</div>
            <Button variant="ghost" size="sm" className="rounded-xl gap-1" onClick={refresh} disabled={loading}>
              <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} /> Rafraîchir
            </Button>
          </div>

          {loading && entries.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">Chargement…</div>
          ) : entries.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4">Aucun évènement encore. Le cron s'exécute toutes les 15 min.</div>
          ) : (
            <ol className="relative border-l border-border pl-4 space-y-3">
              {entries.map((e) => {
                const date = new Date(e.created_at);
                const time = date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
                const payload = e.payload as { title?: string; message?: string } | null;
                return (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[22px] top-1 size-3 rounded-full bg-background border-2 border-border grid place-items-center">
                      <StatusIcon s={e.status} />
                    </span>
                    <div className="rounded-xl bg-muted/40 p-3">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="font-medium text-foreground">{TYPE_LABEL[e.type] ?? e.type}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${
                          e.status === "sent" ? "bg-emerald-500/10 text-emerald-600" :
                          e.status === "error" ? "bg-destructive/10 text-destructive" :
                          "bg-muted text-muted-foreground"
                        }`}>{e.status}</span>
                        <span className="text-muted-foreground">· {e.trigger}</span>
                        <span className="ml-auto text-muted-foreground">{time}</span>
                      </div>
                      {e.target_segment && (
                        <div className="mt-1 text-[11px] text-muted-foreground font-mono truncate">segment: {e.target_segment}</div>
                      )}
                      {e.reason && (
                        <div className="mt-1 text-xs text-foreground/80">{e.reason}</div>
                      )}
                      {payload?.title && (
                        <div className="mt-1 text-xs">
                          <span className="font-medium">{payload.title}</span>
                          {payload.message ? <span className="text-muted-foreground"> — {payload.message}</span> : null}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
