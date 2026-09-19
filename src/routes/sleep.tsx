import { createFileRoute } from "@tanstack/react-router";
import { liquidTooltipStyle } from "@/lib/chart-style";
import { useEffect, useMemo, useState } from "react";
import { Moon } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid } from "recharts";
import { PageHeader, StatCard } from "@/components/Stat";
import { useDomainState } from "@/lib/domain-store";
import { fmtDay, todayKey } from "@/lib/storage";
import { formatSleepDuration } from "@/lib/sleep-format";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/sleep")({
  head: () => ({ meta: [{ title: "Sommeil — Pace" }, { name: "description", content: "Suivi du sommeil intelligent : heures, dette, qualité, tendances." }] }),
  component: SleepPage,
});

type SleepEntry = { start?: string; end?: string; hours: number; quality?: number };

function diffHours(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  let s = sh + sm / 60;
  let e = eh + em / 60;
  if (e < s) e += 24;
  return Math.max(0, e - s);
}

function unwrapSleepValue(value: unknown): Record<string, SleepEntry> {
  let current = value;
  for (let i = 0; i < 8; i++) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return {};
    const object = current as Record<string, unknown>;
    if (object.version === 1 && typeof object.updatedAt === "string" && "value" in object) {
      current = object.value;
      continue;
    }
    const output: Record<string, SleepEntry> = {};
    for (const [day, raw] of Object.entries(object)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const entry = raw as Partial<SleepEntry>;
      if (typeof entry.hours !== "number" || !Number.isFinite(entry.hours) || entry.hours <= 0) continue;
      output[day] = {
        start: typeof entry.start === "string" ? entry.start : undefined,
        end: typeof entry.end === "string" ? entry.end : undefined,
        hours: entry.hours,
        quality: typeof entry.quality === "number" ? entry.quality : undefined,
      };
    }
    return output;
  }
  return {};
}

function mergeSleep(a: Record<string, SleepEntry>, b: Record<string, SleepEntry>) {
  const result = { ...a };
  for (const [day, incoming] of Object.entries(b)) result[day] = { ...(result[day] ?? {}), ...incoming };
  return result;
}

function SleepPage() {
  const [entries, setEntries] = useDomainState<Record<string, SleepEntry>>("sleep", {});
  const [cloudLoaded, setCloudLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const hydrateCloudSleep = async () => {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (cancelled || userError || !userData.user) {
        if (!cancelled) setCloudLoaded(true);
        return;
      }

      const { data, error } = await supabase
        .from("user_state")
        .select("key,value")
        .eq("user_id", userData.user.id)
        .in("key", ["lt.sleep", "pace.sleep", "pace.domain.sleep"]);

      if (cancelled) return;
      if (!error && data) {
        const cloud = (data as Array<{ key: string; value: unknown }>)
          .sort((a, b) => {
            const rank = (key: string) => key === "lt.sleep" ? 0 : key === "pace.sleep" ? 1 : 2;
            return rank(a.key) - rank(b.key);
          })
          .reduce<Record<string, SleepEntry>>((acc, row) => mergeSleep(acc, unwrapSleepValue(row.value)), {});
        if (Object.keys(cloud).length) setEntries((current) => mergeSleep(cloud, current));
      }
      setCloudLoaded(true);
    };

    void hydrateCloudSleep();
    return () => { cancelled = true; };
  }, [setEntries]);

  const today = todayKey();
  const existingToday = entries[today];
  const [start, setStart] = useState(existingToday?.start ?? "23:30");
  const [end, setEnd] = useState(existingToday?.end ?? "07:00");
  const [quality, setQuality] = useState(existingToday?.quality ?? 8);

  useEffect(() => {
    const stored = entries[today];
    if (!stored) return;
    if (stored.start) setStart(stored.start);
    if (stored.end) setEnd(stored.end);
    if (stored.quality != null) setQuality(stored.quality);
  }, [entries, today]);

  const chartDays = useMemo(() => {
    const days = new Set<string>();
    const cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    for (let i = 0; i < 30; i++) {
      days.add(cursor.toISOString().slice(0, 10));
      cursor.setDate(cursor.getDate() - 1);
    }
    Object.keys(entries).forEach((day) => { if (/^\d{4}-\d{2}-\d{2}$/.test(day)) days.add(day); });
    return [...days].sort();
  }, [entries]);

  const data = chartDays.map((d) => ({ d, label: fmtDay(d), h: entries[d]?.hours ?? null }));
  const valid = data.filter((x) => x.h !== null) as { d: string; label: string; h: number }[];
  const avg = valid.length ? valid.reduce((s, x) => s + x.h, 0) / valid.length : 0;
  const best = valid.reduce((b, x) => (x.h > b ? x.h : b), 0);
  const worst = valid.length ? valid.reduce((w, x) => (x.h < w ? x.h : w), 24) : 0;
  const debt = Math.max(0, valid.length * 8 - valid.reduce((s, x) => s + x.h, 0));

  useEffect(() => {
    if (!cloudLoaded) return;
    const h = diffHours(start, end);
    if (h <= 0 || quality < 1 || quality > 10) return;
    const timer = window.setTimeout(() => {
      setEntries((previous) => {
        const current = previous[today];
        const next: SleepEntry = { start, end, hours: h, quality };
        if (current && current.start === next.start && current.end === next.end && current.hours === next.hours && current.quality === next.quality) return previous;
        return { ...previous, [today]: next };
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [start, end, quality, today, cloudLoaded, setEntries]);

  return (
    <div>
      <PageHeader title="Sommeil" subtitle="Détectez les patterns, comblez la dette." />
      <div className="rounded-2xl glass-card p-5 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-muted-foreground">Endormi à</label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" /></div>
          <div><label className="text-xs text-muted-foreground">Réveil</label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" /></div>
          <div><label className="text-xs text-muted-foreground">Qualité (1-10)</label><NumberField allowDecimal={true} min={1} max={10} value={quality} onChange={(v) => { if (v != null) setQuality(v); }} className="w-24" /></div>
          <div className="text-sm text-muted-foreground ml-auto" aria-live="polite"><Moon className="inline size-4 mr-1" /> {formatSleepDuration(diffHours(start, end))} · sauvegardé automatiquement</div>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Moyenne" value={formatSleepDuration(avg)} />
        <StatCard label="Meilleur" value={formatSleepDuration(best)} />
        <StatCard label="Pire" value={worst === 24 ? "—" : formatSleepDuration(worst)} />
        <StatCard label="Dette" value={formatSleepDuration(debt)} />
      </div>
      <div className="rounded-2xl glass-card p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="font-display text-lg font-semibold">Historique complet</h2>
          <span className="text-xs text-muted-foreground">{cloudLoaded ? `${valid.length} nuit${valid.length > 1 ? "s" : ""}` : "Récupération…"}</span>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
            <YAxis fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
            <Tooltip contentStyle={liquidTooltipStyle} formatter={(v: number) => [formatSleepDuration(v), "Sommeil"]} />
            <Line type="monotone" dataKey="h" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-4 max-h-80 overflow-y-auto space-y-1">
          {valid.slice().sort((a, b) => b.d.localeCompare(a.d)).map((row) => (
            <div key={row.d} className="flex items-center justify-between rounded-xl glass-thin px-3 py-2 text-sm">
              <span>{new Date(row.d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
              <span className="font-medium">{formatSleepDuration(row.h)}{entries[row.d]?.quality != null ? ` · qualité ${entries[row.d].quality}/10` : ""}</span>
            </div>
          ))}
          {!valid.length && <div className="text-sm text-muted-foreground text-center py-8">Aucune donnée de sommeil récupérée.</div>}
        </div>
      </div>
    </div>
  );
}
