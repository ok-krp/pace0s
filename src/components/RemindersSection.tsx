import { useReminders, type ReminderRow } from "@/hooks/use-reminders";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Droplet, Moon, Beef, BarChart3, AlarmClock } from "lucide-react";
import { toast } from "sonner";
import type { ReactNode } from "react";

const LABELS: Record<string, { icon: ReactNode; title: string; desc: string; hasTime: boolean }> = {
  hydration: { icon: <Droplet className="size-4" />, title: "Hydratation", desc: "Rappel de boire si tu n'as pas atteint ton objectif", hasTime: true },
  sleep: { icon: <Moon className="size-4" />, title: "Sommeil", desc: "Rappel avant ton heure de coucher", hasTime: true },
  protein: { icon: <Beef className="size-4" />, title: "Protéines", desc: "Alerte si <70% de ton objectif protéique", hasTime: true },
  daily_summary: { icon: <BarChart3 className="size-4" />, title: "Résumé quotidien", desc: "Total kcal + macros en fin de journée", hasTime: true },
  inactivity: { icon: <AlarmClock className="size-4" />, title: "Inactivité", desc: "Te rappelle après 36h sans log", hasTime: false },
};

export function RemindersSection() {
  const { rows, loading, save } = useReminders();

  const handle = async (next: ReminderRow) => {
    try { await save(next); } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-[var(--shadow-soft)]">
      <div className="mb-3">
        <div className="font-medium">Rappels intelligents</div>
        <div className="text-xs text-muted-foreground">Notifications contextuelles basées sur tes données du jour</div>
      </div>
      {loading ? (
        <div className="text-sm text-muted-foreground py-4">Chargement…</div>
      ) : (
        <div className="space-y-2">
          {Object.entries(LABELS).map(([type, meta]) => {
            const row = rows[type as keyof typeof rows];
            return (
              <div key={type} className="flex items-center gap-3 rounded-xl bg-muted/40 p-3">
                <div className="size-9 rounded-lg bg-background grid place-items-center">{meta.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{meta.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{meta.desc}</div>
                </div>
                {meta.hasTime && row.enabled && (
                  <Input
                    type="time"
                    value={row.time_local ?? ""}
                    onChange={(e) => handle({ ...row, time_local: e.target.value || null })}
                    className="w-24 h-9"
                  />
                )}
                <Switch checked={row.enabled} onCheckedChange={(v) => handle({ ...row, enabled: v })} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
