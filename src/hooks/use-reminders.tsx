import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listReminders, upsertReminder, type ReminderType } from "@/lib/reminders.functions";

export type ReminderRow = {
  type: ReminderType;
  enabled: boolean;
  time_local: string | null;
  timezone: string;
  threshold: number | null;
};

const DEFAULT_TIMES: Record<ReminderType, string | null> = {
  hydration: "14:00",
  sleep: "22:30",
  protein: "20:00",
  daily_summary: "21:00",
  inactivity: null,
};

const ALL_TYPES: ReminderType[] = ["hydration", "sleep", "protein", "daily_summary", "inactivity"];

export function useReminders() {
  const list = useServerFn(listReminders);
  const upsert = useServerFn(upsertReminder);
  const [rows, setRows] = useState<Record<ReminderType, ReminderRow>>(() =>
    Object.fromEntries(
      ALL_TYPES.map((t) => [t, { type: t, enabled: false, time_local: DEFAULT_TIMES[t], timezone: "Europe/Paris", threshold: null }]),
    ) as Record<ReminderType, ReminderRow>,
  );
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await list();
      const map = { ...rows };
      for (const t of ALL_TYPES) {
        map[t] = { type: t, enabled: false, time_local: DEFAULT_TIMES[t], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris", threshold: null };
      }
      for (const r of res.reminders) {
        map[r.type as ReminderType] = {
          type: r.type as ReminderType,
          enabled: !!r.enabled,
          time_local: r.time_local ?? DEFAULT_TIMES[r.type as ReminderType],
          timezone: r.timezone,
          threshold: r.threshold,
        };
      }
      setRows(map);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  useEffect(() => { refresh(); }, [refresh]);

  const save = useCallback(
    async (patch: ReminderRow) => {
      setRows((m) => ({ ...m, [patch.type]: patch }));
      await upsert({
        data: {
          type: patch.type,
          enabled: patch.enabled,
          time_local: patch.time_local,
          timezone: patch.timezone,
          threshold: patch.threshold ?? undefined,
        },
      });
    },
    [upsert],
  );

  return { rows, loading, save, refresh };
}
