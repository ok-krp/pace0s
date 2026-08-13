import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ChevronLeft, ChevronRight, Moon, Droplets, Apple, Repeat, Scale, CalendarPlus, Trash2, Clock } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { useLocalState } from "@/lib/storage";
import { formatSleepDuration } from "@/lib/sleep-format";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const searchSchema = z.object({ d: z.string().optional() });

export const Route = createFileRoute("/calendar")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Calendrier — Pace" }, { name: "description", content: "Vue calendaire de toute votre vie." }] }),
  component: CalendarPage,
});

type NutItem = { id: string; name: string; meal: string; kcal: number; p: number; c: number; f: number };
type Habit = { id: string; name: string; emoji: string };
export type CalendarEvent = { id: string; title: string; time?: string; note?: string };

function CalendarPage() {
  const { d: dParam } = Route.useSearch();
  const [cursor, setCursor] = useState(() => dParam ? new Date(dParam) : new Date());
  const [selected, setSelected] = useState<string | null>(dParam ?? null);
  useEffect(() => {
    if (dParam) { setSelected(dParam); setCursor(new Date(dParam)); }
  }, [dParam]);
  const [sleep] = useLocalState<Record<string, { hours?: number; quality?: number; start?: string; end?: string }>>("pace.sleep", {});
  const [water] = useLocalState<Record<string, number>>("pace.water", {});
  const [routines] = useLocalState<Record<string, string[]>>("pace.routine.done", {});
  const [habits] = useLocalState<Habit[]>("pace.routine.list", []);
  const [nutrition] = useLocalState<Record<string, { kcal?: number; p?: number; c?: number; f?: number }>>("pace.nutrition.totals", {});
  const [nutItems] = useLocalState<Record<string, NutItem[]>>("pace.nutrition.items", {});
  const [weights] = useLocalState<Record<string, { w?: number; muscle?: number; fat?: number }>>("pace.weight", {});
  const [events, setEvents] = useLocalState<Record<string, CalendarEvent[]>>("pace.calendar.events", {});

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: Array<string | null> = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) {
    cells.push(new Date(year, month, i).toISOString().slice(0, 10));
  }

  const monthName = cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  const dayActivity = (d: string) => {
    const score = (sleep[d]?.hours ?? 0) > 0 ? 1 : 0;
    const w = (water[d] ?? 0) > 0 ? 1 : 0;
    const r = (routines[d] ?? []).length > 0 ? 1 : 0;
    const n = (nutrition[d]?.kcal ?? 0) > 0 ? 1 : 0;
    return score + w + r + n;
  };

  return (
    <div>
      <PageHeader title="Calendrier" subtitle="Tout ce que vous avez vécu, jour par jour." />

      <div className="rounded-2xl glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-semibold capitalize">{monthName}</h2>
          <div className="flex gap-1">
            <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="size-9 rounded-lg hover:bg-muted grid place-items-center"><ChevronLeft className="size-4" /></button>
            <button onClick={() => setCursor(new Date())} className="px-3 rounded-lg hover:bg-muted text-sm">Aujourd'hui</button>
            <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="size-9 rounded-lg hover:bg-muted grid place-items-center"><ChevronRight className="size-4" /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-[11px] text-muted-foreground mb-2">
          {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => (
            <div key={d} className="text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const a = dayActivity(d);
            const today = d === new Date().toISOString().slice(0, 10);
            const num = parseInt(d.slice(8, 10));
            return (
              <button
                key={i}
                onClick={() => setSelected(d)}
                className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-all border ${
                  selected === d ? "border-primary bg-primary/5"
                  : today ? "border-primary/40"
                  : "border-transparent hover:bg-muted"
                }`}
              >
                <div className="text-sm font-medium">{num}</div>
                {(events[d]?.length ?? 0) > 0 && <div className="w-3 h-0.5 rounded-full bg-amber-500" />}
                {a > 0 && (
                  <div className="flex gap-0.5">
                    {Array.from({ length: a }).map((_, j) => (
                      <div key={j} className="size-1 rounded-full bg-primary" />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selected && (
        <DayDetails
          date={selected}
          sleep={sleep[selected]}
          water={water[selected]}
          nutTotal={nutrition[selected]}
          nutList={nutItems[selected] ?? []}
          routineIds={routines[selected] ?? []}
          habits={habits}
          weight={weights[selected]}
          events={events[selected] ?? []}
          onAddEvent={(ev) => setEvents((p) => ({ ...p, [selected]: [...(p[selected] ?? []), ev] }))}
          onRemoveEvent={(id) => setEvents((p) => ({ ...p, [selected]: (p[selected] ?? []).filter((e) => e.id !== id) }))}
        />
      )}
    </div>
  );
}

function DayDetails({ date, sleep, water, nutTotal, nutList, routineIds, habits, weight, events, onAddEvent, onRemoveEvent }: {
  date: string;
  sleep?: { hours?: number; quality?: number; start?: string; end?: string };
  water?: number;
  nutTotal?: { kcal?: number; p?: number; c?: number; f?: number };
  nutList: NutItem[];
  routineIds: string[];
  habits: Habit[];
  weight?: { w?: number; muscle?: number; fat?: number };
  events: CalendarEvent[];
  onAddEvent: (e: CalendarEvent) => void;
  onRemoveEvent: (id: string) => void;
}) {
  const meals = ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"];
  const habitsDone = habits.filter((h) => routineIds.includes(h.id));
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");

  const addEvent = () => {
    const t = title.trim();
    if (!t) return;
    onAddEvent({ id: crypto.randomUUID(), title: t, time: time || undefined });
    setTitle("");
    setTime("");
  };

  return (
    <div className="mt-4 rounded-2xl glass-card p-5">
      <h2 className="font-display text-lg font-semibold mb-3">
        {new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      </h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
        <Cell label="Sommeil" v={sleep?.hours ? formatSleepDuration(sleep.hours) : "—"} />
        <Cell label="Eau" v={water ? `${(water / 1000).toFixed(2)} L` : "—"} />
        <Cell label="Calories" v={nutTotal?.kcal ? `${nutTotal.kcal} kcal` : "—"} />
        <Cell label="Habitudes" v={`${habitsDone.length}/${habits.length}`} />
      </div>

      <Accordion type="multiple" className="w-full" defaultValue={["events"]}>
        <AccordionItem value="events">
          <AccordionTrigger>
            <div className="flex items-center gap-2"><CalendarPlus className="size-4" /> Événements <span className="text-xs text-muted-foreground">({events.length})</span></div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="flex gap-2 mb-3">
              <Input
                placeholder="Ex : Rendez-vous dentiste"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addEvent(); }}
                className="flex-1"
              />
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-28" />
              <Button size="icon" onClick={addEvent} className="shrink-0 rounded-xl"><CalendarPlus className="size-4" /></Button>
            </div>
            {events.length === 0 ? (
              <div className="text-xs text-muted-foreground italic px-2">Aucun événement ce jour-là.</div>
            ) : (
              <ul className="space-y-1.5">
                {[...events].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99")).map((ev) => (
                  <li key={ev.id} className="flex items-center gap-2 text-sm rounded-lg bg-muted/40 px-3 py-2">
                    {ev.time && <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0"><Clock className="size-3" />{ev.time}</span>}
                    <span className="flex-1 truncate">{ev.title}</span>
                    <button onClick={() => onRemoveEvent(ev.id)} aria-label={`Supprimer ${ev.title}`} className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="size-3.5" /></button>
                  </li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="nut">
          <AccordionTrigger>
            <div className="flex items-center gap-2"><Apple className="size-4" /> Nutrition <span className="text-xs text-muted-foreground">({nutList.length} aliment{nutList.length === 1 ? "" : "s"})</span></div>
          </AccordionTrigger>
          <AccordionContent>
            {nutList.length === 0 ? (
              <div className="text-xs text-muted-foreground italic px-2">Rien enregistré.</div>
            ) : (
              <div className="space-y-3">
                {meals.map((m) => {
                  const sub = nutList.filter((x) => x.meal === m);
                  if (sub.length === 0) return null;
                  const sum = sub.reduce((a, x) => a + x.kcal, 0);
                  return (
                    <div key={m}>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{m} · {sum} kcal</div>
                      <ul className="space-y-1">
                        {sub.map((x) => (
                          <li key={x.id} className="flex justify-between text-sm">
                            <span className="truncate">{x.name}</span>
                            <span className="text-muted-foreground shrink-0 ml-2">{x.kcal} kcal · P{x.p} G{x.c} L{x.f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="sleep">
          <AccordionTrigger><div className="flex items-center gap-2"><Moon className="size-4" /> Sommeil</div></AccordionTrigger>
          <AccordionContent>
            {sleep?.hours ? (
              <div className="text-sm space-y-1">
                <div>Durée : <b>{formatSleepDuration(sleep.hours)}</b></div>
                {sleep.start && sleep.end && <div className="text-muted-foreground">De {sleep.start} à {sleep.end}</div>}
                {sleep.quality && <div className="text-muted-foreground">Qualité : {sleep.quality}/10</div>}
              </div>
            ) : <div className="text-xs text-muted-foreground italic px-2">Aucune nuit enregistrée.</div>}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="water">
          <AccordionTrigger><div className="flex items-center gap-2"><Droplets className="size-4" /> Hydratation</div></AccordionTrigger>
          <AccordionContent>
            {water ? (
              <div className="text-sm">{water} ml — <span className="text-muted-foreground">{(water / 1000).toFixed(2)} L</span></div>
            ) : <div className="text-xs text-muted-foreground italic px-2">Aucune entrée.</div>}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="routine">
          <AccordionTrigger><div className="flex items-center gap-2"><Repeat className="size-4" /> Routine ({habitsDone.length})</div></AccordionTrigger>
          <AccordionContent>
            {habitsDone.length === 0 ? (
              <div className="text-xs text-muted-foreground italic px-2">Aucune habitude validée.</div>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {habitsDone.map((h) => (
                  <li key={h.id} className="rounded-full bg-muted px-3 py-1 text-xs">{h.emoji} {h.name}</li>
                ))}
              </ul>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="weight">
          <AccordionTrigger><div className="flex items-center gap-2"><Scale className="size-4" /> Corps</div></AccordionTrigger>
          <AccordionContent>
            {weight && (weight.w || weight.muscle || weight.fat) ? (
              <div className="text-sm space-y-1">
                {weight.w && <div>Poids : <b>{weight.w} kg</b></div>}
                {weight.muscle && <div className="text-muted-foreground">Muscle : {weight.muscle} %</div>}
                {weight.fat && <div className="text-muted-foreground">Graisse : {weight.fat} %</div>}
              </div>
            ) : <div className="text-xs text-muted-foreground italic px-2">Aucune mesure.</div>}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

function Cell({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-xl bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-lg font-semibold mt-0.5">{v}</div>
    </div>
  );
}
