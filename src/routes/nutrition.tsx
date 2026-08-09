import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { z } from "zod";
import { Apple, Plus, Trash2, ScanBarcode, Camera, Loader2, X, AlertTriangle, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader, StatCard } from "@/components/Stat";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLocalState, todayKey } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUserGoals } from "@/hooks/use-user-goals";
import { useNutritionCols, NUT_COLS, type NutCol } from "@/hooks/use-nutrition-cols";
import { addNutritionItem, type NutritionItem } from "@/lib/nutrition-log";
import { WaterView } from "@/components/WaterView";
import { RecipesView } from "@/components/RecipesView";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { fetchProductByBarcode, type OFFProduct } from "@/lib/openfoodfacts";
import { analyzeFoodPhoto } from "@/lib/nutrition-ai.functions";
import { sumItems, type FoodAnalysis, type FoodItem } from "@/lib/nutrition-ai.shared";
import { FoodAnalysisEditor } from "@/components/FoodAnalysisEditor";
import { toast } from "sonner";
import { isLegalCategoryAllowed } from "@/lib/legal";

const searchSchema = z.object({ tab: z.enum(["nutrition", "recipes", "water"]).optional() });

export const Route = createFileRoute("/nutrition")({
  head: () => ({ meta: [{ title: "Nutrition — Pace" }, { name: "description", content: "Nutrition, recettes et hydratation." }] }),
  validateSearch: searchSchema,
  component: NutritionPage,
});

type Item = NutritionItem;

const COL_FIELD: Record<NutCol, keyof Item> = {
  kcal: "kcal", protein: "p", carbs: "c", fat: "f",
  sat_fat: "sat", sugar: "sugar", fiber: "fiber",
  salt: "salt", sodium: "sodium", iron: "iron", calcium: "calcium", vit_c: "vitC",
};

const MEALS = ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner", "Collation"];

function NutritionPage() {
  const { tab } = Route.useSearch();
  const currentTab = tab ?? "nutrition";
  const [scanOpen, setScanOpen] = useState(false);
  const [recallCount] = useLocalState<number>("pace.recalls.count", 0);
  const [pending, setPending] = useState<
    | { kind: "barcode"; product: OFFProduct; grams: number; meal: string }
    | { kind: "photo"; photo: string; result: FoodAnalysis; items: FoodItem[]; grams: number; meal: string }
    | null
  >(null);
  const [busy, setBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const analyzePhoto = useServerFn(analyzeFoodPhoto);

  const handleBarcode = async (code: string) => {
    setScanOpen(false);
    setBusy(true);
    try {
      const p = await fetchProductByBarcode(code);
      if (!p) { toast.error("Produit introuvable"); return; }
      setPending({ kind: "barcode", product: p, grams: 100, meal: "Déjeuner" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur scan");
    } finally { setBusy(false); }
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isLegalCategoryAllowed("ai")) { toast.error("Consentement Analyse IA requis."); return; }
    if (file.size > 6 * 1024 * 1024) { toast.error("Image trop lourde (max 6 Mo)"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result as string;
      setBusy(true);
      try {
        const res = await analyzePhoto({ data: { imageBase64: b64 } });
        if (res.error || !res.result) { toast.error(res.error ?? "Analyse échouée"); return; }
        const r = res.result as FoodAnalysis;
        setPending({ kind: "photo", photo: b64, result: r, items: r.items, grams: sumItems(r.items).grams, meal: "Déjeuner" });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erreur IA");
      } finally { setBusy(false); }
    };
    reader.readAsDataURL(file);
  };

  const confirmAdd = () => {
    if (!pending) return;
    if (pending.kind === "barcode") {
      const f = pending.grams / 100;
      addNutritionItem({
        name: `${pending.product.name}${pending.product.brand ? ` · ${pending.product.brand}` : ""} (${pending.grams}g)`,
        meal: pending.meal,
        kcal: Math.round(pending.product.kcal * f),
        p: +(pending.product.protein_g * f).toFixed(1),
        c: +(pending.product.carbs_g * f).toFixed(1),
        f: +(pending.product.fat_g * f).toFixed(1),
        fiber: +(pending.product.fiber_g * f).toFixed(1),
        sugar: +(pending.product.sugar_g * f).toFixed(1),
        sodium: +(pending.product.sodium_mg * f).toFixed(1),
      });
    } else {
      const t = sumItems(pending.items);
      addNutritionItem({
        name: `${pending.result.dish_name} (${Math.round(t.grams)}g)`,
        meal: pending.meal,
        kcal: t.kcal,
        p: t.protein_g,
        c: t.carbs_g,
        f: t.fat_g,
        fiber: t.fiber_g,
        sugar: t.sugar_g,
        sodium: t.sodium_mg,
      });
    }
    toast.success(`Ajouté à ${pending.meal}`);
    setPending(null);
  };

  return (
    <div>
      <PageHeader title="Nutrition" subtitle="Repas, recettes et hydratation." />
      <div className="flex justify-center mb-4">
        <Tabs value={currentTab} className="w-auto">
          <TabsList className="rounded-full h-10">
            <TabsTrigger value="nutrition" asChild className="rounded-full px-5"><Link to="/nutrition" search={{ tab: "nutrition" }}>Nutrition</Link></TabsTrigger>
            <TabsTrigger value="recipes" asChild className="rounded-full px-5"><Link to="/nutrition" search={{ tab: "recipes" }}>Recettes</Link></TabsTrigger>
            <TabsTrigger value="water" asChild className="rounded-full px-5"><Link to="/nutrition" search={{ tab: "water" }}>Eau</Link></TabsTrigger>
          </TabsList>
          <TabsContent value="nutrition" />
          <TabsContent value="recipes" />
          <TabsContent value="water" />
        </Tabs>
      </div>

      {/* Nutrition + Rappels conso fusionnés en une seule carte. */}
      <Link
        to="/recalls"
        className="mb-4 flex items-center gap-3 rounded-2xl glass-card p-4 hover:opacity-95 transition"
      >
        <span className="glass-icon size-11 shrink-0 relative text-emerald-500">
          {recallCount > 0 ? <AlertTriangle className="size-5 text-rose-500" /> : <ShieldCheck className="size-5" />}
          {recallCount > 0 && (
            <span className="absolute -top-1 -right-1 size-4.5 rounded-full grid place-items-center bg-rose-500 text-white ring-1 ring-white/40 shadow-[0_2px_6px_-1px_rgba(0,0,0,0.4)]">
              <AlertTriangle className="size-2.5" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">Rappels conso</div>
          <div className="text-xs text-muted-foreground">
            {recallCount > 0
              ? `${recallCount} produit${recallCount > 1 ? "s" : ""} scanné${recallCount > 1 ? "s" : ""} concerné${recallCount > 1 ? "s" : ""} par un rappel`
              : "Aucun rappel actif sur tes produits scannés"}
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 shrink-0">Ouvrir →</span>
      </Link>

      {currentTab === "nutrition" && <NutritionLogView />}
      {currentTab === "recipes" && <RecipesView />}
      {currentTab === "water" && <WaterView />}

      {(currentTab === "nutrition" || currentTab === "recipes") && (
        <div className="fixed z-40 right-4 flex flex-col gap-3 bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))] md:bottom-6">
          <button
            onClick={() => photoInputRef.current?.click()}
            aria-label="Analyser un repas par photo"
            className="glass-icon size-14 text-white bg-gradient-to-br from-fuchsia-500/70 to-purple-600/70 shadow-[var(--shadow-glow)] hover:scale-105 active:scale-95 transition"
          >{busy ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}</button>
          <button
            onClick={() => setScanOpen(true)}
            aria-label="Scanner un code-barres"
            className="glass-icon size-14 text-white bg-gradient-to-br from-emerald-500/70 to-teal-600/70 shadow-[var(--shadow-glow)] hover:scale-105 active:scale-95 transition"
          ><ScanBarcode className="size-6" /></button>
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
        </div>
      )}

      {scanOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 grid place-items-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-card overflow-hidden">
            <BarcodeScanner onDetected={handleBarcode} onClose={() => setScanOpen(false)} />
          </div>
        </div>
      )}

      <Dialog open={!!pending} onOpenChange={(v) => !v && setPending(null)}>
        {pending && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {pending.kind === "barcode" ? <ScanBarcode className="size-4" /> : <Camera className="size-4" />}
                {pending.kind === "barcode" ? pending.product.name : pending.result.dish_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {pending.kind === "photo" && <img src={pending.photo} alt="Photo du repas à analyser" className="w-full aspect-video object-cover rounded-xl" />}
              {pending.kind === "barcode" && pending.product.image_url && (
                <img src={pending.product.image_url} alt={pending.product.name} className="size-24 rounded-xl object-cover mx-auto" />
              )}
              {pending.kind === "barcode" ? (
                <>
                  <div className="text-xs text-muted-foreground text-center">
                    {`Ref 100g : ${pending.product.kcal} kcal · P ${pending.product.protein_g} · G ${pending.product.carbs_g} · L ${pending.product.fat_g}`}
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Quantité (g)</label>
                    <Input
                      type="number" inputMode="numeric" min={1} value={pending.grams}
                      onChange={(e) => setPending({ ...pending, grams: Math.max(0, +e.target.value || 0) })}
                    />
                  </div>
                </>
              ) : (
                <FoodAnalysisEditor
                  items={pending.items}
                  onChange={(items) => setPending({ ...pending, items, grams: sumItems(items).grams })}
                  confidence={pending.result.confidence}
                  confidenceNote={pending.result.confidence_note || pending.result.notes}
                />
              )}
              <div>
                <label className="text-[11px] text-muted-foreground">Repas</label>
                <Select value={pending.meal} onValueChange={(v) => setPending({ ...pending, meal: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{MEALS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setPending(null)}><X className="size-4 mr-1" />Annuler</Button>
                <Button onClick={confirmAdd} disabled={pending.kind === "barcode" ? !pending.grams : pending.items.length === 0}><Plus className="size-4 mr-1" />Ajouter</Button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}


function NutritionLogView() {
  const [items, setItems] = useLocalState<Record<string, Item[]>>("pace.nutrition.items", {});
  const [totals, setTotals] = useLocalState<Record<string, { kcal: number; p: number; c: number; f: number }>>("pace.nutrition.totals", {});
  const [cols] = useNutritionCols();
  const goals = useUserGoals();
  const goal = goals.kcal;
  const today = todayKey();
  const list = items[today] ?? [];

  useEffect(() => {
    const handler = () => {
      try {
        const raw = localStorage.getItem("pace.nutrition.items");
        if (raw) setItems(JSON.parse(raw));
        const tRaw = localStorage.getItem("pace.nutrition.totals");
        if (tRaw) setTotals(JSON.parse(tRaw));
      } catch {}
    };
    window.addEventListener("pace.nutrition.changed", handler);
    return () => window.removeEventListener("pace.nutrition.changed", handler);
  }, [setItems, setTotals]);

  const [meal, setMeal] = useState("Petit déjeuner");
  const [name, setName] = useState("");
  const [fields, setFields] = useState<Record<NutCol, string>>(
    Object.fromEntries(NUT_COLS.map((c) => [c.key, ""])) as Record<NutCol, string>
  );
  const setField = (k: NutCol, v: string) => setFields((p) => ({ ...p, [k]: v }));

  const recompute = (arr: Item[]) =>
    arr.reduce((a, x) => ({ kcal: a.kcal + x.kcal, p: a.p + x.p, c: a.c + x.c, f: a.f + x.f }), { kcal: 0, p: 0, c: 0, f: 0 });

  const add = () => {
    if (!name || !fields.kcal) return;
    const it: Item = {
      id: crypto.randomUUID(), name, meal, qty: 1,
      kcal: +fields.kcal || 0, p: +fields.protein || 0, c: +fields.carbs || 0, f: +fields.fat || 0,
      sat: +fields.sat_fat || undefined, sugar: +fields.sugar || undefined, fiber: +fields.fiber || undefined,
      salt: +fields.salt || undefined, sodium: +fields.sodium || undefined,
      iron: +fields.iron || undefined, calcium: +fields.calcium || undefined, vitC: +fields.vit_c || undefined,
    };
    setItems((prev) => {
      const next = { ...prev, [today]: [...(prev[today] ?? []), it] };
      setTotals((t) => ({ ...t, [today]: recompute(next[today]) }));
      return next;
    });
    setName("");
    setFields(Object.fromEntries(NUT_COLS.map((c) => [c.key, ""])) as Record<NutCol, string>);
  };

  const remove = (id: string) => {
    setItems((prev) => {
      const next = { ...prev, [today]: (prev[today] ?? []).filter((x) => x.id !== id) };
      setTotals((t) => ({ ...t, [today]: recompute(next[today]) }));
      return next;
    });
  };

  const t = totals[today] ?? { kcal: 0, p: 0, c: 0, f: 0 };
  const meals = ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"];
  const activeCols: NutCol[] = cols.includes("kcal") ? cols : ["kcal", ...cols];
  const sumCol = (arr: Item[], k: NutCol) => arr.reduce((s, x) => s + (Number(x[COL_FIELD[k]] as number | undefined) || 0), 0);

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Calories" value={t.kcal} unit={`/ ${goal}`} icon={<Apple className="size-4" />} delta={((t.kcal - goal) / goal) * 100} />
        <StatCard label="Protéines" value={t.p.toFixed(0)} unit="g" />
        <StatCard label="Glucides" value={t.c.toFixed(0)} unit="g" />
        <StatCard label="Lipides" value={t.f.toFixed(0)} unit="g" />
      </div>

      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl glass-card p-5 mb-4">
        <div className="grid md:grid-cols-3 gap-2 mb-2">
          <Input placeholder="Aliment" value={name} onChange={(e) => setName(e.target.value)} className="md:col-span-2" />
          <Select value={meal} onValueChange={setMeal}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{meals.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {activeCols.map((k) => {
            const meta = NUT_COLS.find((c) => c.key === k)!;
            return (
              <Input key={k} placeholder={`${meta.label} (${meta.unit})`} type="number" value={fields[k]} onChange={(e) => setField(k, e.target.value)} />
            );
          })}
        </div>
        <div className="flex justify-between items-center mt-3 flex-wrap gap-2">
          <div className="text-xs text-muted-foreground">
            Objectif : {goal} kcal <span className="opacity-60">(profil)</span> · {activeCols.length} colonnes
          </div>
          <Button onClick={add} className="rounded-xl"><Plus className="size-4 mr-1" />Ajouter</Button>
        </div>
      </motion.div>

      <div className="space-y-4 pb-24 md:pb-4">
        {meals.map((m) => {
          const sub = list.filter((x) => x.meal === m);
          if (sub.length === 0) return null;
          return (
            <div key={m} className="rounded-2xl glass-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border flex justify-between items-center bg-muted/30 flex-wrap gap-2">
                <div className="font-medium">{m}</div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                  {activeCols.map((k) => {
                    const meta = NUT_COLS.find((c) => c.key === k)!;
                    return <span key={k}>{Math.round(sumCol(sub, k))} {meta.unit}</span>;
                  })}
                </div>
              </div>
              <ul className="divide-y divide-border">
                {sub.map((x) => (
                  <li key={x.id} className="px-5 py-3 flex justify-between items-center group gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{x.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {activeCols.filter((k) => k !== "kcal").map((k) => {
                          const meta = NUT_COLS.find((c) => c.key === k)!;
                          const v = Number(x[COL_FIELD[k]] as number | undefined) || 0;
                          return `${meta.label.split(" ")[0]} ${v.toFixed(1)}${meta.unit}`;
                        }).join(" · ")}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-medium">{x.kcal} kcal</span>
                      <button onClick={() => remove(x.id)} aria-label={`Supprimer ${x.name}`} className="text-muted-foreground hover:text-destructive opacity-60 group-hover:opacity-100 transition">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {list.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Aucun aliment aujourd'hui. Ajoute un repas ou scanne un code-barres via les boutons en bas.
          </div>
        )}
      </div>
    </div>
  );
}
