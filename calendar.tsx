import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ChevronLeft, ChevronRight, Moon, Droplets, Apple, Repeat, Scale, CalendarPlus, Trash2, Clock, Pencil, Check, X } from "lucide-react";
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
type SleepValue = { hours?: number; quality?: number; start?: string; end?: string };
type NutritionTotal = { kcal?: number; p?: number; c?: number; f?: number };
type WeightValue = { w?: number; muscle?: number; fat?: number };

const toNumber = (value: string): number | undefined => {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClick(); }} aria-label={label} title={label} className="size-7 rounded-lg grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"><Pencil className="size-3.5" /></button>;
}
function EditorActions({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return <div className="flex gap-1.5"><Button type="button" size="icon" className="size-8 rounded-lg" onClick={onSave} aria-label="Enregistrer"><Check className="size-4" /></Button><Button type="button" size="icon" variant="ghost" className="size-8 rounded-lg" onClick={onCancel} aria-label="Annuler"><X className="size-4" /></Button></div>;
}

function CalendarPage() {
  const { d: dParam } = Route.useSearch();
  const [cursor, setCursor] = useState(() => dParam ? new Date(dParam) : new Date());
  const [selected, setSelected] = useState<string | null>(dParam ?? null);
  useEffect(() => { if (dParam) { setSelected(dParam); setCursor(new Date(dParam)); } }, [dParam]);

  const [sleep, setSleep] = useLocalState<Record<string, SleepValue>>("pace.sleep", {});
  const [water, setWater] = useLocalState<Record<string, number>>("pace.water", {});
  const [routines, setRoutines] = useLocalState<Record<string, string[]>>("pace.routine.done", {});
  const [habits] = useLocalState<Habit[]>("pace.routine.list", []);
  const [nutrition, setNutrition] = useLocalState<Record<string, NutritionTotal>>("pace.nutrition.totals", {});
  const [nutItems] = useLocalState<Record<string, NutItem[]>>("pace.nutrition.items", {});
  const [weights, setWeights] = useLocalState<Record<string, WeightValue>>("pace.weight", {});
  const [events, setEvents] = useLocalState<Record<string, CalendarEvent[]>>("pace.calendar.events", {});

  const year = cursor.getFullYear(); const month = cursor.getMonth();
  const first = new Date(year, month, 1); const startWeekday = (first.getDay() + 6) % 7; const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(year, month, i).toISOString().slice(0, 10));
  const monthName = cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const dayActivity = (d: string) => ((sleep[d]?.hours ?? 0) > 0 ? 1 : 0) + ((water[d] ?? 0) > 0 ? 1 : 0) + ((routines[d] ?? []).length > 0 ? 1 : 0) + ((nutrition[d]?.kcal ?? 0) > 0 ? 1 : 0);

  return <div>
    <PageHeader title="Calendrier" subtitle="Tout ce que vous avez vécu, jour par jour. Vous pouvez corriger ou compléter les jours précédents." />
    <div className="rounded-2xl glass-card p-5">
      <div className="flex items-center justify-between mb-4"><h2 className="font-display text-xl font-semibold capitalize">{monthName}</h2><div className="flex gap-1"><button onClick={() => setCursor(new Date(year, month - 1, 1))} className="size-9 rounded-lg hover:bg-muted grid place-items-center"><ChevronLeft className="size-4" /></button><button onClick={() => setCursor(new Date())} className="px-3 rounded-lg hover:bg-muted text-sm">Aujourd'hui</button><button onClick={() => setCursor(new Date(year, month + 1, 1))} className="size-9 rounded-lg hover:bg-muted grid place-items-center"><ChevronRight className="size-4" /></button></div></div>
      <div className="grid grid-cols-7 gap-1.5 text-[11px] text-muted-foreground mb-2">{["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => <div key={d} className="text-center">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1.5">{cells.map((d, i) => { if (!d) return <div key={i} />; const a = dayActivity(d); const today = d === new Date().toISOString().slice(0, 10); const num = parseInt(d.slice(8, 10)); return <button key={i} onClick={() => setSelected(d)} className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-all border ${selected === d ? "border-primary bg-primary/5" : today ? "border-primary/40" : "border-transparent hover:bg-muted"}`}><div className="text-sm font-medium">{num}</div>{(events[d]?.length ?? 0) > 0 && <div className="w-3 h-0.5 rounded-full bg-amber-500" />}{a > 0 && <div className="flex gap-0.5">{Array.from({ length: a }).map((_, j) => <div key={j} className="size-1 rounded-full bg-primary" />)}</div>}</button>; })}</div>
    </div>
    {selected && <DayDetails date={selected} sleep={sleep[selected]} water={water[selected]} nutTotal={nutrition[selected]} nutList={nutItems[selected] ?? []} routineIds={routines[selected] ?? []} habits={habits} weight={weights[selected]} events={events[selected] ?? []}
      onSaveSleep={(value) => setSleep((p) => ({ ...p, [selected]: value }))}
      onSaveWater={(value) => setWater((p) => ({ ...p, [selected]: value }))}
      onSaveNutrition={(value) => setNutrition((p) => ({ ...p, [selected]: value }))}
      onSaveWeight={(value) => setWeights((p) => ({ ...p, [selected]: value }))}
      onSaveRoutine={(ids) => setRoutines((p) => ({ ...p, [selected]: ids }))}
      onAddEvent={(ev) => setEvents((p) => ({ ...p, [selected]: [...(p[selected] ?? []), ev] }))}
      onUpdateEvent={(ev) => setEvents((p) => ({ ...p, [selected]: (p[selected] ?? []).map((e) => e.id === ev.id ? ev : e) }))}
      onRemoveEvent={(id) => setEvents((p) => ({ ...p, [selected]: (p[selected] ?? []).filter((e) => e.id !== id) }))}
    />}
  </div>;
}

function DayDetails({ date, sleep, water, nutTotal, nutList, routineIds, habits, weight, events, onSaveSleep, onSaveWater, onSaveNutrition, onSaveWeight, onSaveRoutine, onAddEvent, onUpdateEvent, onRemoveEvent }: {
  date: string; sleep?: SleepValue; water?: number; nutTotal?: NutritionTotal; nutList: NutItem[]; routineIds: string[]; habits: Habit[]; weight?: WeightValue; events: CalendarEvent[];
  onSaveSleep: (v: SleepValue) => void; onSaveWater: (v: number) => void; onSaveNutrition: (v: NutritionTotal) => void; onSaveWeight: (v: WeightValue) => void; onSaveRoutine: (ids: string[]) => void; onAddEvent: (e: CalendarEvent) => void; onUpdateEvent: (e: CalendarEvent) => void; onRemoveEvent: (id: string) => void;
}) {
  const meals = ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"];
  const habitsDone = habits.filter((h) => routineIds.includes(h.id));
  const [title, setTitle] = useState(""); const [time, setTime] = useState(""); const [editing, setEditing] = useState<string | null>(null); const [editingTitle, setEditingTitle] = useState(""); const [editingTime, setEditingTime] = useState(""); const [section, setSection] = useState<string | null>(null);
  const [sleepDraft, setSleepDraft] = useState<SleepValue>(sleep ?? {}); const [waterDraft, setWaterDraft] = useState(water ?? 0); const [nutritionDraft, setNutritionDraft] = useState<NutritionTotal>(nutTotal ?? {}); const [weightDraft, setWeightDraft] = useState<WeightValue>(weight ?? {}); const [routineDraft, setRoutineDraft] = useState<string[]>(routineIds);
  useEffect(() => { setSleepDraft(sleep ?? {}); }, [sleep]); useEffect(() => { setWaterDraft(water ?? 0); }, [water]); useEffect(() => { setNutritionDraft(nutTotal ?? {}); }, [nutTotal]); useEffect(() => { setWeightDraft(weight ?? {}); }, [weight]); useEffect(() => { setRoutineDraft(routineIds); }, [routineIds]);
  const addEvent = () => { const t = title.trim(); if (!t) return; onAddEvent({ id: crypto.randomUUID(), title: t, time: time || undefined }); setTitle(""); setTime(""); };
  const startEventEdit = (ev: CalendarEvent) => { setEditing(ev.id); setEditingTitle(ev.title); setEditingTime(ev.time ?? ""); };
  const saveEventEdit = (ev: CalendarEvent) => { const nextTitle = editingTitle.trim(); if (!nextTitle) return; onUpdateEvent({ ...ev, title: nextTitle, time: editingTime || undefined }); setEditing(null); };

  return <div className="mt-4 rounded-2xl glass-card p-5">
    <h2 className="font-display text-lg font-semibold mb-3">{new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4"><Cell label="Sommeil" v={sleep?.hours != null ? formatSleepDuration(sleep.hours) : "—"} /><Cell label="Eau" v={water != null && water > 0 ? `${(water / 1000).toFixed(2)} L` : "—"} /><Cell label="Calories" v={nutTotal?.kcal != null ? `${nutTotal.kcal} kcal` : "—"} /><Cell label="Habitudes" v={`${habitsDone.length}/${habits.length}`} /></div>
    <Accordion type="multiple" className="w-full" defaultValue={["events"]}>
      <AccordionItem value="events"><AccordionTrigger><div className="flex items-center gap-2"><CalendarPlus className="size-4" /> Événements <span className="text-xs text-muted-foreground">({events.length})</span></div></AccordionTrigger><AccordionContent>
        <div className="flex gap-2 mb-3"><Input placeholder="Ex : Rendez-vous dentiste" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addEvent(); }} className="flex-1" /><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-28" /><Button size="icon" onClick={addEvent} className="shrink-0 rounded-xl"><CalendarPlus className="size-4" /></Button></div>
        {events.length === 0 ? <div className="text-xs text-muted-foreground italic px-2">Aucun événement ce jour-là.</div> : <ul className="space-y-1.5">{[...events].sort((a, b) => (a.time ?? "99:99").localeCompare(b.time ?? "99:99")).map((ev) => <li key={ev.id} className="flex items-center gap-2 text-sm rounded-lg bg-muted/40 px-3 py-2">{editing === ev.id ? <><Input value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} className="flex-1 h-8" autoFocus /><Input type="time" value={editingTime} onChange={(e) => setEditingTime(e.target.value)} className="w-28 h-8" /><button onClick={() => saveEventEdit(ev)} aria-label="Enregistrer" className="size-7 grid place-items-center text-primary"><Check className="size-3.5" /></button><button onClick={() => setEditing(null)} aria-label="Annuler" className="size-7 grid place-items-center text-muted-foreground"><X className="size-3.5" /></button></> : <>{ev.time && <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0"><Clock className="size-3" />{ev.time}</span>}<span className="flex-1 truncate">{ev.title}</span><button onClick={() => startEventEdit(ev)} aria-label={`Modifier ${ev.title}`} title="Modifier" className="text-muted-foreground hover:text-foreground shrink-0"><Pencil className="size-3.5" /></button><button onClick={() => onRemoveEvent(ev.id)} aria-label={`Supprimer ${ev.title}`} className="text-muted-foreground hover:text-destructive shrink-0"><Trash2 className="size-3.5" /></button></>}</li>)}</ul>}
      </AccordionContent></AccordionItem>

      <AccordionItem value="nut"><AccordionTrigger><div className="flex items-center gap-2"><Apple className="size-4" /> Nutrition <span className="text-xs text-muted-foreground">({nutList.length} aliment{nutList.length === 1 ? "" : "s"})</span></div></AccordionTrigger><AccordionContent>
        {section === "nutrition" ? <div className="space-y-3"><div className="grid grid-cols-2 md:grid-cols-4 gap-2">{([["kcal", "kcal"], ["p", "Protéines (g)"], ["c", "Glucides (g)"], ["f", "Lipides (g)"]] as const).map(([key, label]) => <label key={key} className="text-xs text-muted-foreground">{label}<Input type="number" min="0" value={nutritionDraft[key] ?? ""} onChange={(e) => setNutritionDraft((p) => ({ ...p, [key]: toNumber(e.target.value) }))} /></label>)}</div><EditorActions onSave={() => { onSaveNutrition(nutritionDraft); setSection(null); }} onCancel={() => { setNutritionDraft(nutTotal ?? {}); setSection(null); }} /></div> : <><div className="flex justify-end mb-2"><EditButton onClick={() => setSection("nutrition")} label="Modifier la nutrition de cette journée" /></div>{nutList.length === 0 ? <div className="text-xs text-muted-foreground italic px-2">Rien enregistré.</div> : <div className="space-y-3">{meals.map((m) => { const sub = nutList.filter((x) => x.meal === m); if (!sub.length) return null; const sum = sub.reduce((a, x) => a + x.kcal, 0); return <div key={m}><div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{m} · {sum} kcal</div><ul className="space-y-1">{sub.map((x) => <li key={x.id} className="flex justify-between text-sm"><span className="truncate">{x.name}</span><span className="text-muted-foreground shrink-0 ml-2">{x.kcal} kcal · P{x.p} G{x.c} L{x.f}</span></li>)}</ul></div>; })}</div>}</>}
      </AccordionContent></AccordionItem>

      <AccordionItem value="sleep"><AccordionTrigger><div className="flex items-center gap-2"><Moon className="size-4" /> Sommeil</div></AccordionTrigger><AccordionContent>
        {section === "sleep" ? <div className="space-y-3"><div className="grid grid-cols-2 md:grid-cols-4 gap-2"><label className="text-xs text-muted-foreground">Durée (heures)<Input type="number" min="0" step="0.25" value={sleepDraft.hours ?? ""} onChange={(e) => setSleepDraft((p) => ({ ...p, hours: toNumber(e.target.value) }))} /></label><label className="text-xs text-muted-foreground">Qualité /10<Input type="number" min="1" max="10" value={sleepDraft.quality ?? ""} onChange={(e) => setSleepDraft((p) => ({ ...p, quality: toNumber(e.target.value) }))} /></label><label className="text-xs text-muted-foreground">Endormi à<Input type="time" value={sleepDraft.start ?? ""} onChange={(e) => setSleepDraft((p) => ({ ...p, start: e.target.value || undefined }))} /></label><label className="text-xs text-muted-foreground">Réveil à<Input type="time" value={sleepDraft.end ?? ""} onChange={(e) => setSleepDraft((p) => ({ ...p, end: e.target.value || undefined }))} /></label></div><EditorActions onSave={() => { onSaveSleep(sleepDraft); setSection(null); }} onCancel={() => { setSleepDraft(sleep ?? {}); setSection(null); }} /></div> : <><div className="flex justify-end mb-2"><EditButton onClick={() => setSection("sleep")} label="Modifier le sommeil de cette journée" /></div>{sleep?.hours != null ? <div className="text-sm space-y-1"><div>Durée : <b>{formatSleepDuration(sleep.hours)}</b></div>{sleep.start && sleep.end && <div className="text-muted-foreground">De {sleep.start} à {sleep.end}</div>}{sleep.quality != null && <div className="text-muted-foreground">Qualité : {sleep.quality}/10</div>}</div> : <div className="text-xs text-muted-foreground italic px-2">Aucune nuit enregistrée.</div>}</>}
      </AccordionContent></AccordionItem>

      <AccordionItem value="water"><AccordionTrigger><div className="flex items-center gap-2"><Droplets className="size-4" /> Hydratation</div></AccordionTrigger><AccordionContent>
        {section === "water" ? <div className="flex items-end gap-2"><label className="text-xs text-muted-foreground flex-1">Quantité (ml)<Input type="number" min="0" value={waterDraft || ""} onChange={(e) => setWaterDraft(toNumber(e.target.value) ?? 0)} /></label><EditorActions onSave={() => { onSaveWater(waterDraft); setSection(null); }} onCancel={() => { setWaterDraft(water ?? 0); setSection(null); }} /></div> : <><div className="flex justify-end mb-2"><EditButton onClick={() => setSection("water")} label="Modifier l'hydratation de cette journée" /></div>{water && water > 0 ? <div className="text-sm">{water} ml — <span className="text-muted-foreground">{(water / 1000).toFixed(2)} L</span></div> : <div className="text-xs text-muted-foreground italic px-2">Aucune entrée.</div>}</>}
      </AccordionContent></AccordionItem>

      <AccordionItem value="routine"><AccordionTrigger><div className="flex items-center gap-2"><Repeat className="size-4" /> Routine ({habitsDone.length})</div></AccordionTrigger><AccordionContent>
        {section === "routine" ? <div className="space-y-2"><div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{habits.map((h) => <label key={h.id} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"><input type="checkbox" checked={routineDraft.includes(h.id)} onChange={(e) => setRoutineDraft((p) => e.target.checked ? [...p, h.id] : p.filter((id) => id !== h.id))} />{h.emoji} {h.name}</label>)}</div><EditorActions onSave={() => { onSaveRoutine(routineDraft); setSection(null); }} onCancel={() => { setRoutineDraft(routineIds); setSection(null); }} /></div> : <><div className="flex justify-end mb-2"><EditButton onClick={() => setSection("routine")} label="Modifier les habitudes de cette journée" /></div>{habitsDone.length === 0 ? <div className="text-xs text-muted-foreground italic px-2">Aucune habitude validée.</div> : <ul className="flex flex-wrap gap-2">{habitsDone.map((h) => <li key={h.id} className="rounded-full bg-muted px-3 py-1 text-xs">{h.emoji} {h.name}</li>)}</ul>}</>}
      </AccordionContent></AccordionItem>

      <AccordionItem value="weight"><AccordionTrigger><div className="flex items-center gap-2"><Scale className="size-4" /> Corps</div></AccordionTrigger><AccordionContent>
        {section === "weight" ? <div className="space-y-3"><div className="grid grid-cols-3 gap-2">{([["w", "Poids (kg)"], ["muscle", "Muscle (%)"], ["fat", "Graisse (%)"]] as const).map(([key, label]) => <label key={key} className="text-xs text-muted-foreground">{label}<Input type="number" min="0" step="0.1" value={weightDraft[key] ?? ""} onChange={(e) => setWeightDraft((p) => ({ ...p, [key]: toNumber(e.target.value) }))} /></label>)}</div><EditorActions onSave={() => { onSaveWeight(weightDraft); setSection(null); }} onCancel={() => { setWeightDraft(weight ?? {}); setSection(null); }} /></div> : <><div className="flex justify-end mb-2"><EditButton onClick={() => setSection("weight")} label="Modifier les mesures corporelles de cette journée" /></div>{weight && (weight.w != null || weight.muscle != null || weight.fat != null) ? <div className="text-sm space-y-1">{weight.w != null && <div>Poids : <b>{weight.w} kg</b></div>}{weight.muscle != null && <div className="text-muted-foreground">Muscle : {weight.muscle} %</div>}{weight.fat != null && <div className="text-muted-foreground">Graisse : {weight.fat} %</div>}</div> : <div className="text-xs text-muted-foreground italic px-2">Aucune mesure enregistrée.</div>}</>}
      </AccordionContent></AccordionItem>
    </Accordion>
  </div>;
}

function Cell({ label, v }: { label: string; v: string }) {
  return <div className="rounded-xl bg-muted/30 p-3"><div className="text-[11px] text-muted-foreground mb-1">{label}</div><div className="font-medium">{v}</div></div>;
}
