import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ChevronLeft, ChevronRight, Moon, Droplets, Apple, Repeat, Scale, Pencil, X } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { useLocalState } from "@/lib/storage";
import { formatSleepDuration } from "@/lib/sleep-format";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const searchSchema = z.object({ d: z.string().optional() });
export const Route = createFileRoute("/calendar")({ validateSearch: searchSchema, head: () => ({ meta: [{ title: "Calendrier — Pace" }, { name: "description", content: "Vue calendaire de toute votre vie." }] }), component: CalendarPage });

type NutItem = { id: string; name: string; meal: string; kcal: number; p: number; c: number; f: number };
type Habit = { id: string; name: string; emoji: string };
type Sleep = { hours?: number; quality?: number; start?: string; end?: string };
type Weight = { w?: number; muscle?: number; fat?: number };

function CalendarPage() {
  const { d: dParam } = Route.useSearch();
  const [cursor, setCursor] = useState(() => dParam ? new Date(dParam) : new Date());
  const [selected, setSelected] = useState<string | null>(dParam ?? null);
  useEffect(() => { if (dParam) { setSelected(dParam); setCursor(new Date(dParam)); } }, [dParam]);
  const [sleep] = useLocalState<Record<string, Sleep>>("pace.sleep", {});
  const [water] = useLocalState<Record<string, number>>("pace.water", {});
  const [routines] = useLocalState<Record<string, string[]>>("pace.routine.done", {});
  const [habits] = useLocalState<Habit[]>("pace.routine.list", []);
  const [nutrition] = useLocalState<Record<string, { kcal?: number; p?: number; c?: number; f?: number }>>("pace.nutrition.totals", {});
  const [nutItems] = useLocalState<Record<string, NutItem[]>>("pace.nutrition.items", {});
  const [weights] = useLocalState<Record<string, Weight>>("pace.weight", {});

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const first = new Date(year, month, 1), startWeekday = (first.getDay() + 6) % 7, daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(new Date(year, month, i).toISOString().slice(0, 10));
  const monthName = cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const dayActivity = (d: string) => Number((sleep[d]?.hours ?? 0) > 0) + Number((water[d] ?? 0) > 0) + Number((routines[d] ?? []).length > 0) + Number((nutrition[d]?.kcal ?? 0) > 0);

  return <div>
    <PageHeader title="Calendrier" subtitle="Tout ce que vous avez vécu, jour par jour." />
    <div className="rounded-2xl glass-card p-5">
      <div className="flex items-center justify-between mb-4"><h2 className="font-display text-xl font-semibold capitalize">{monthName}</h2><div className="flex gap-1"><button onClick={() => setCursor(new Date(year, month - 1, 1))} className="size-9 rounded-lg hover:bg-muted grid place-items-center"><ChevronLeft className="size-4" /></button><button onClick={() => setCursor(new Date())} className="px-3 rounded-lg hover:bg-muted text-sm">Aujourd'hui</button><button onClick={() => setCursor(new Date(year, month + 1, 1))} className="size-9 rounded-lg hover:bg-muted grid place-items-center"><ChevronRight className="size-4" /></button></div></div>
      <div className="grid grid-cols-7 gap-1.5 text-[11px] text-muted-foreground mb-2">{["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map(d => <div key={d} className="text-center">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1.5">{cells.map((d, i) => { if (!d) return <div key={i}/>; const a = dayActivity(d), today = d === new Date().toISOString().slice(0, 10), num = parseInt(d.slice(8, 10)); return <button key={i} onClick={() => setSelected(d)} className={`aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-all border ${selected === d ? "border-primary bg-primary/5" : today ? "border-primary/40" : "border-transparent hover:bg-muted"}`}><div className="text-sm font-medium">{num}</div>{a > 0 && <div className="flex gap-0.5">{Array.from({ length: a }).map((_, j) => <div key={j} className="size-1 rounded-full bg-primary"/>)}</div>}</button>; })}</div>
    </div>
    {selected && <DayDetails date={selected} sleep={sleep[selected]} water={water[selected]} nutTotal={nutrition[selected]} nutList={nutItems[selected] ?? []} routineIds={routines[selected] ?? []} habits={habits} weight={weights[selected]} />}
  </div>;
}

function DayDetails({ date, sleep, water, nutTotal, nutList, routineIds, habits, weight }: { date: string; sleep?: Sleep; water?: number; nutTotal?: { kcal?: number; p?: number; c?: number; f?: number }; nutList: NutItem[]; routineIds: string[]; habits: Habit[]; weight?: Weight }) {
  const [edit, setEdit] = useState(false);
  const [sleepState, setSleep] = useState<Sleep>(sleep ?? {});
  const [waterState, setWater] = useState(water ?? 0);
  const [nutritionState, setNutrition] = useState(nutTotal ?? {});
  const [weightState, setWeight] = useState(weight ?? {});
  const [sleepData, setSleepData] = useLocalState<Record<string, Sleep>>("pace.sleep", {});
  const [waterData, setWaterData] = useLocalState<Record<string, number>>("pace.water", {});
  const [nutritionData, setNutritionData] = useLocalState<Record<string, { kcal?: number; p?: number; c?: number; f?: number }>>("pace.nutrition.totals", {});
  const [weightData, setWeightData] = useLocalState<Record<string, Weight>>("pace.weight", {});
  const meals = ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"];
  const habitsDone = habits.filter(h => routineIds.includes(h.id));
  const patchNumber = (value: string, key: string, setter: (v: any) => void, current: any, commit: (v: any) => void) => { const v = value === "" ? undefined : Number(value); const next = { ...current, [key]: v }; setter(next); commit(next); };
  const commitSleep = (next: Sleep) => setSleepData(p => ({ ...p, [date]: Object.fromEntries(Object.entries(next).filter(([,v]) => v !== undefined)) }));
  const commitWater = (v: number) => setWaterData(p => ({ ...p, [date]: v }));
  const commitNutrition = (next: typeof nutritionState) => setNutritionData(p => ({ ...p, [date]: Object.fromEntries(Object.entries(next).filter(([,v]) => v !== undefined)) }));
  const commitWeight = (next: Weight) => setWeightData(p => ({ ...p, [date]: Object.fromEntries(Object.entries(next).filter(([,v]) => v !== undefined)) }));

  return <div className="mt-4 rounded-2xl glass-card p-5">
    <div className="flex items-center justify-between mb-3"><h2 className="font-display text-lg font-semibold">{new Date(date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2><Button variant={edit ? "secondary" : "outline"} size="sm" onClick={() => setEdit(v => !v)} className="gap-2"><Pencil className="size-3.5"/>{edit ? "Terminer" : "Modifier"}</Button></div>
    {edit && <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">Mode modification : chaque changement est sauvegardé automatiquement pour le <b>{new Date(date).toLocaleDateString("fr-FR")}</b>. Aucun bouton Enregistrer n'est nécessaire.</div>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4"><EditableCell label="Sommeil" value={sleepState.hours} display={sleepState.hours ? formatSleepDuration(sleepState.hours) : "—"} edit={edit} input={<Input type="number" min="0" step="0.25" value={sleepState.hours ?? ""} onChange={e => patchNumber(e.target.value, "hours", setSleep, sleepState, commitSleep)} placeholder="7.5"/>}/><EditableCell label="Eau" value={waterState} display={waterState ? `${(waterState/1000).toFixed(2)} L` : "—"} edit={edit} input={<Input type="number" min="0" value={waterState || ""} onChange={e => { const v=e.target.value === "" ? 0 : Number(e.target.value); setWater(v); commitWater(v); }} placeholder="2000"/>}/><EditableCell label="Calories" value={nutritionState.kcal} display={nutritionState.kcal !== undefined ? `${nutritionState.kcal} kcal` : "—"} edit={edit} input={<Input type="number" min="0" value={nutritionState.kcal ?? ""} onChange={e => patchNumber(e.target.value,"kcal",setNutrition,nutritionState,commitNutrition)} placeholder="kcal"/>}/><div className="rounded-xl bg-muted/30 p-3"><div className="text-xs text-muted-foreground">Habitudes</div><div className="font-display text-lg font-semibold mt-0.5">{habitsDone.length}/{habits.length}</div></div></div>
    <Accordion type="multiple" className="w-full">
      <AccordionItem value="nut"><AccordionTrigger><div className="flex items-center gap-2"><Apple className="size-4"/> Nutrition <span className="text-xs text-muted-foreground">({nutList.length} aliment{nutList.length===1?"":"s"})</span></div></AccordionTrigger><AccordionContent>{nutList.length===0?<div className="text-xs text-muted-foreground italic px-2">Rien enregistré.</div>:<div className="space-y-3">{meals.map(m=>{const sub=nutList.filter(x=>x.meal===m);if(!sub.length)return null;return <div key={m}><div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{m} · {sub.reduce((a,x)=>a+x.kcal,0)} kcal</div><ul className="space-y-1">{sub.map(x=><li key={x.id} className="flex justify-between text-sm"><span className="truncate">{x.name}</span><span className="text-muted-foreground shrink-0 ml-2">{x.kcal} kcal · P{x.p} G{x.c} L{x.f}</span></li>)}</ul></div>})}</div>}</AccordionContent></AccordionItem>
      <AccordionItem value="sleep"><AccordionTrigger><div className="flex items-center gap-2"><Moon className="size-4"/> Sommeil</div></AccordionTrigger><AccordionContent>{edit ? <div className="grid sm:grid-cols-3 gap-2"><Input type="number" min="0" step="0.25" value={sleepState.hours ?? ""} placeholder="Durée en heures" onChange={e=>patchNumber(e.target.value,"hours",setSleep,sleepState,commitSleep)}/><Input type="time" value={sleepState.start ?? ""} onChange={e=>{const n={...sleepState,start:e.target.value||undefined};setSleep(n);commitSleep(n)}}/><Input type="time" value={sleepState.end ?? ""} onChange={e=>{const n={...sleepState,end:e.target.value||undefined};setSleep(n);commitSleep(n)}}/></div> : sleep?.hours ? <div className="text-sm space-y-1"><div>Durée : <b>{formatSleepDuration(sleep.hours)}</b></div>{sleep.start&&sleep.end&&<div className="text-muted-foreground">De {sleep.start} à {sleep.end}</div>}{sleep.quality&&<div className="text-muted-foreground">Qualité : {sleep.quality}/10</div>}</div>:<div className="text-xs text-muted-foreground italic px-2">Aucune nuit enregistrée.</div>}</AccordionContent></AccordionItem>
      <AccordionItem value="water"><AccordionTrigger><div className="flex items-center gap-2"><Droplets className="size-4"/> Hydratation</div></AccordionTrigger><AccordionContent>{edit?<Input type="number" min="0" value={waterState||""} onChange={e=>{const v=e.target.value===""?0:Number(e.target.value);setWater(v);commitWater(v)}} placeholder="ml"/>:water?<div className="text-sm">{water} ml — <span className="text-muted-foreground">{(water/1000).toFixed(2)} L</span></div>:<div className="text-xs text-muted-foreground italic px-2">Aucune entrée.</div>}</AccordionContent></AccordionItem>
      <AccordionItem value="routine"><AccordionTrigger><div className="flex items-center gap-2"><Repeat className="size-4"/> Routine ({habitsDone.length})</div></AccordionTrigger><AccordionContent>{habitsDone.length===0?<div className="text-xs text-muted-foreground italic px-2">Aucune habitude validée.</div>:<ul className="flex flex-wrap gap-2">{habitsDone.map(h=><li key={h.id} className="rounded-full bg-muted px-3 py-1 text-xs">{h.emoji} {h.name}</li>)}</ul>}</AccordionContent></AccordionItem>
      <AccordionItem value="weight"><AccordionTrigger><div className="flex items-center gap-2"><Scale className="size-4"/> Corps</div></AccordionTrigger><AccordionContent>{edit?<div className="grid sm:grid-cols-3 gap-2"><Input type="number" min="0" step="0.1" value={weightState.w??""} placeholder="Poids kg" onChange={e=>patchNumber(e.target.value,"w",setWeight,weightState,commitWeight)}/><Input type="number" min="0" step="0.1" value={weightState.muscle??""} placeholder="Muscle %" onChange={e=>patchNumber(e.target.value,"muscle",setWeight,weightState,commitWeight)}/><Input type="number" min="0" step="0.1" value={weightState.fat??""} placeholder="Graisse %" onChange={e=>patchNumber(e.target.value,"fat",setWeight,weightState,commitWeight)}/></div>:weight&&(weight.w!==undefined||weight.muscle!==undefined||weight.fat!==undefined)?<div className="text-sm space-y-1">{weight.w!==undefined&&<div>Poids : <b>{weight.w} kg</b></div>}{weight.muscle!==undefined&&<div className="text-muted-foreground">Muscle : {weight.muscle} %</div>}{weight.fat!==undefined&&<div className="text-muted-foreground">Graisse : {weight.fat} %</div>}</div>:<div className="text-xs text-muted-foreground italic px-2">Aucune mesure.</div>}</AccordionContent></AccordionItem>
    </Accordion>
    {edit && <div className="mt-4 flex justify-end"><Button variant="ghost" size="sm" onClick={()=>setEdit(false)} className="gap-2"><X className="size-3.5"/>Fermer</Button></div>}
  </div>;
}

function EditableCell({ label, display, edit, input }: { label:string; value?:number; display:string; edit:boolean; input:React.ReactNode }) { return <div className="rounded-xl bg-muted/30 p-3"><div className="text-xs text-muted-foreground">{label}</div>{edit?<div className="mt-1">{input}</div>:<div className="font-display text-lg font-semibold mt-0.5">{display}</div>}</div>; }
