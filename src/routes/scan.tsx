import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Camera, ScanLine, Sparkles, Loader2, Check, Plus, AlertTriangle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/Stat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { fetchProductByBarcode, computeHealthScore, computeScore100, type OFFProduct } from "@/lib/openfoodfacts";
import { checkRecallByBarcode, type RecallInfo } from "@/lib/rappel-conso";
import { analyzeFoodPhoto } from "@/lib/nutrition-ai.functions";
import { sumItems, type FoodAnalysis, type FoodItem } from "@/lib/nutrition-ai.shared";
import { FoodAnalysisEditor } from "@/components/FoodAnalysisEditor";
import { useAuth } from "@/hooks/use-auth";
import { useNutritionCols, NUT_COLS, type NutCol } from "@/hooks/use-nutrition-cols";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isLegalCategoryAllowed } from "@/lib/legal";

const SHORT: Record<NutCol, string> = {
  kcal: "kcal", protein: "P", carbs: "G", fat: "L", sat_fat: "Sat", sugar: "Suc",
  fiber: "Fib", salt: "Sel", sodium: "Na", iron: "Fe", calcium: "Ca", vit_c: "VitC",
};

function offValue(p: OFFProduct, c: NutCol): number {
  switch (c) {
    case "kcal": return p.kcal;
    case "protein": return p.protein_g;
    case "carbs": return p.carbs_g;
    case "fat": return p.fat_g;
    case "sat_fat": return p.sat_fat_g;
    case "sugar": return p.sugar_g;
    case "fiber": return p.fiber_g;
    case "salt": return p.salt_g;
    case "sodium": return p.sodium_mg;
    case "iron": return p.iron_mg;
    case "calcium": return p.calcium_mg;
    case "vit_c": return p.vit_c_mg;
  }
}


function NutGrid({ cols, factor, getter }: { cols: NutCol[]; factor: number; getter: (c: NutCol) => number }) {
  const visible = cols.length ? cols : (["kcal", "protein", "carbs", "fat"] as NutCol[]);
  const gridCols = visible.length === 1 ? "grid-cols-1" : visible.length === 2 ? "grid-cols-2" : visible.length === 3 ? "grid-cols-3" : "grid-cols-4";
  return (
    <div className={`grid ${gridCols} gap-px bg-border`}>
      {visible.map((c) => {
        const meta = NUT_COLS.find((x) => x.key === c)!;
        const v = getter(c) * factor;
        const display = c === "kcal" ? Math.round(v).toString() : v.toFixed(1) + meta.unit;
        return (
          <div key={c} className="bg-card px-3 py-2.5 text-center">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{SHORT[c]}</div>
            <div className="text-sm font-semibold">{display}</div>
          </div>
        );
      })}
    </div>
  );
}


export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "IA Nutrition — Pace" }, { name: "description", content: "Scan code-barres et analyse photo IA de vos repas." }] }),
  validateSearch: (s: Record<string, unknown>): { open?: "barcode" | "photo" } => {
    const v = s.open;
    return v === "barcode" || v === "photo" ? { open: v } : {};
  },
  component: ScanPage,
});

type AnalysisResult = FoodAnalysis;


const scoreColors = {
  green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  orange: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  red: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
};

function ScanPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const analyzePhoto = useServerFn(analyzeFoodPhoto);
  const [nutCols] = useNutritionCols();


  const [scanning, setScanning] = useState(false);
  const [meal, setMeal] = useState("Déjeuner");
  const [product, setProduct] = useState<OFFProduct | null>(null);
  const [scoreInfo, setScoreInfo] = useState<{ score: "green" | "orange" | "red"; warnings: string[] } | null>(null);
  const [score100, setScore100] = useState<number | null>(null);
  const [recalls, setRecalls] = useState<RecallInfo[]>([]);
  const [productGrams, setProductGrams] = useState<number>(100);
  const [photo, setPhoto] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AnalysisResult | null>(null);
  const [aiItems, setAiItems] = useState<FoodItem[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    if (search.open === "barcode") {
      setScanning(true);
      navigate({ to: "/scan", search: {}, replace: true });
    } else if (search.open === "photo") {
      fileRef.current?.click();
      navigate({ to: "/scan", search: {}, replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.open, user]);

  if (!user) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-4">Connectez-vous pour scanner et analyser vos repas.</p>
        <Button onClick={() => navigate({ to: "/login", search: { next: "/" } })}>Se connecter</Button>
      </div>
    );
  }

  const handleBarcode = async (code: string) => {
    setScanning(false);
    setBusy(true);
    try {
      const p = await fetchProductByBarcode(code);
      if (!p) { toast.error("Produit introuvable dans OpenFoodFacts"); return; }
      const info = computeHealthScore(p);
      const s100 = computeScore100(p);
      setProduct(p);
      setScoreInfo(info);
      setScore100(s100);
      setProductGrams(100);
      setAiResult(null);
      setPhoto(null);
      checkRecallByBarcode(code).then(setRecalls).catch(() => setRecalls([]));
      await supabase.from("food_scans").insert({
        user_id: user.id,
        kind: "barcode",
        barcode: code,
        product_name: p.name,
        brand: p.brand,
        kcal: p.kcal, protein_g: p.protein_g, carbs_g: p.carbs_g, fat_g: p.fat_g,
        fiber_g: p.fiber_g, sugar_g: p.sugar_g, salt_g: p.salt_g, sodium_mg: p.sodium_mg,
        nutri_score: p.nutri_score, nova_group: p.nova_group,
        health_score: info.score, warnings: info.warnings,
        ingredients: p.ingredients, image_url: p.image_url,
        raw: JSON.parse(JSON.stringify(p)),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur scan");
    } finally {
      setBusy(false);
    }
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isLegalCategoryAllowed("ai")) { toast.error("Consentement Analyse IA requis."); return; }
    if (file.size > 6 * 1024 * 1024) { toast.error("Image trop lourde (max 6 Mo)"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result as string;
      setPhoto(b64);
      setProduct(null);
      setBusy(true);
      try {
        const res = await analyzePhoto({ data: { imageBase64: b64 } });
        if (res.error || !res.result) { toast.error(res.error ?? "Analyse échouée"); return; }
        const r = res.result as AnalysisResult;
        setAiResult(r);
        setAiItems(r.items);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erreur IA");
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const addProductToLog = async () => {
    if (!product || !scoreInfo) return;
    const f = (productGrams || 0) / 100;
    const { error } = await supabase.from("food_log").insert({
      user_id: user.id,
      meal,
      name: `${product.name}${product.brand ? ` · ${product.brand}` : ""} (${productGrams}g)`,
      kcal: +(product.kcal * f).toFixed(1),
      protein_g: +(product.protein_g * f).toFixed(1),
      carbs_g: +(product.carbs_g * f).toFixed(1),
      fat_g: +(product.fat_g * f).toFixed(1),
      fiber_g: +(product.fiber_g * f).toFixed(1),
      sugar_g: +(product.sugar_g * f).toFixed(1),
      sodium_mg: +(product.sodium_mg * f).toFixed(1),
      source: "barcode", health_score: scoreInfo.score,
      meta: { grams: productGrams },
    });
    if (error) toast.error(error.message);
    else { toast.success("Ajouté au journal"); setProduct(null); setScoreInfo(null); }
  };

  const addAiToLog = async () => {
    if (!aiResult || aiItems.length === 0) return;
    const t = sumItems(aiItems);
    const { error } = await supabase.from("food_log").insert({
      user_id: user.id,
      meal,
      name: `${aiResult.dish_name} (${Math.round(t.grams)}g)`,
      kcal: +t.kcal.toFixed(1),
      protein_g: +t.protein_g.toFixed(1),
      carbs_g: +t.carbs_g.toFixed(1),
      fat_g: +t.fat_g.toFixed(1),
      fiber_g: +t.fiber_g.toFixed(1),
      sugar_g: +t.sugar_g.toFixed(1),
      sodium_mg: +t.sodium_mg.toFixed(1),
      source: "photo", health_score: aiResult.health_score,
      meta: { quality: aiResult.quality, confidence: aiResult.confidence, items: aiItems, grams: Math.round(t.grams) },
    });
    if (error) toast.error(error.message);
    else { toast.success("Repas ajouté au journal"); setAiResult(null); setAiItems([]); setPhoto(null); }
  };


  return (
    <div>
      <PageHeader title="IA Nutrition" subtitle="Scan code-barres + analyse photo intelligente." />

      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <motion.button
          whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
          onClick={() => setScanning(true)}
          className="rounded-2xl glass-card p-5 text-left hover:shadow-[var(--shadow-card)] transition group"
        >
          <div className="size-11 rounded-xl stat-grad grid place-items-center text-primary-foreground mb-3 shadow-[var(--shadow-glow)]">
            <ScanLine className="size-5" />
          </div>
          <div className="font-display text-lg font-semibold">Scanner code-barres</div>
          <div className="text-xs text-muted-foreground mt-1">Base OpenFoodFacts · 3M+ produits</div>
        </motion.button>

        <motion.button
          whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
          onClick={() => fileRef.current?.click()}
          className="rounded-2xl glass-card p-5 text-left hover:shadow-[var(--shadow-card)] transition"
        >
          <div className="size-11 rounded-xl bg-gradient-to-br from-fuchsia-500 to-purple-600 grid place-items-center text-white mb-3 shadow-[var(--shadow-glow)]">
            <Camera className="size-5" />
          </div>
          <div className="font-display text-lg font-semibold">Photo IA</div>
          <div className="text-xs text-muted-foreground mt-1">Analyse vision · macros estimées</div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
        </motion.button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <span className="text-sm text-muted-foreground">Ajouter au repas :</span>
        <Select value={meal} onValueChange={setMeal}>
          <SelectTrigger className="w-44 h-9 rounded-xl"><SelectValue /></SelectTrigger>
          <SelectContent>
            {["Petit déjeuner", "Déjeuner", "Goûter", "Dîner", "Collation"].map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {busy && (
        <div className="rounded-2xl glass-card p-8 text-center mb-4">
          <Loader2 className="size-6 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground mt-3">Analyse en cours…</p>
        </div>
      )}

      {product && scoreInfo && !busy && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl glass-card overflow-hidden mb-4">
          <div className="flex gap-4 p-5">
            {product.image_url && <img src={product.image_url} alt={product.name} className="size-20 rounded-xl object-cover" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-display text-lg font-semibold truncate">{product.name}</div>
                  <div className="text-xs text-muted-foreground">{product.brand || "—"}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${scoreColors[scoreInfo.score]}`}>
                    {scoreInfo.score === "green" ? "Sain" : scoreInfo.score === "orange" ? "Moyen" : "À éviter"}
                  </div>
                  {score100 !== null && (
                    <div className={`text-xs font-display font-semibold ${score100 >= 70 ? "text-emerald-600" : score100 >= 40 ? "text-amber-600" : "text-rose-600"}`}>
                      {score100}<span className="text-muted-foreground font-normal">/100</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {product.nutri_score && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted">Nutri-Score {product.nutri_score}</span>}
                {product.nova_group && <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted">NOVA {product.nova_group}</span>}
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted">{product.additives.length} additif{product.additives.length === 1 ? "" : "s"}</span>
              </div>
              {product.additives.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1.5 line-clamp-2">
                  {product.additives.slice(0, 8).map((a) => a.toUpperCase()).join(" · ")}
                </div>
              )}
            </div>
          </div>
          <NutGrid cols={nutCols} factor={(productGrams || 0) / 100} getter={(c) => offValue(product, c)} />

          <div className="px-5 py-3 border-t border-border flex items-center gap-3">
            <label className="text-xs text-muted-foreground shrink-0">Quantité consommée</label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={productGrams}
              onChange={(e) => setProductGrams(Math.max(0, Number(e.target.value) || 0))}
              className="h-9 w-24 rounded-xl"
            />
            <span className="text-xs text-muted-foreground">g</span>
          </div>
          {recalls.length > 0 && (
            <div className="px-5 py-3 bg-rose-500/10 border-t border-rose-500/30 flex gap-2 items-start">
              <AlertTriangle className="size-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="text-xs">
                <div className="font-semibold text-rose-700 dark:text-rose-300">Rappel produit en cours</div>
                <div className="text-muted-foreground">{recalls[0].reason}{recalls[0].risk ? ` — ${recalls[0].risk}` : ""}</div>
                {recalls[0].url && <a href={recalls[0].url} target="_blank" rel="noreferrer" className="underline text-rose-600">Fiche officielle</a>}
              </div>
            </div>
          )}
          {scoreInfo.warnings.length > 0 && (
            <div className="px-5 py-3 bg-amber-500/5 border-t border-border flex gap-2 items-start">
              <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">{scoreInfo.warnings.join(" · ")}</div>
            </div>
          )}
          <div className="p-4 border-t border-border flex gap-2">
            <Button onClick={addProductToLog} disabled={!productGrams} className="flex-1 rounded-xl"><Plus className="size-4 mr-1" />Ajouter à {meal}</Button>
            <Button variant="ghost" onClick={() => { setProduct(null); setScoreInfo(null); setScore100(null); setRecalls([]); }}>Annuler</Button>
          </div>
          <div className="px-5 py-2 text-[10px] text-muted-foreground border-t border-border">Macros recalculées pour {productGrams}g (référence 100g)</div>
        </motion.div>
      )}

      {aiResult && photo && !busy && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl glass-card overflow-hidden mb-4">
          <div className="flex gap-4 p-5">
            <img src={photo} alt="repas" className="size-20 rounded-xl object-cover" />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="size-3.5 text-primary" />
                    <span className="text-[10px] uppercase tracking-wider text-primary font-medium">Analyse IA</span>
                  </div>
                  <div className="font-display text-lg font-semibold truncate">{aiResult.dish_name}</div>
                  <div className="text-xs text-muted-foreground">~{Math.round(sumItems(aiItems).grams)}g · {aiItems.slice(0,3).map((i) => i.name).join(", ")}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${scoreColors[aiResult.health_score]}`}>
                    {aiResult.quality}
                  </div>
                  {(() => {
                    const s = aiResult.health_score === "green" ? 80 : aiResult.health_score === "orange" ? 55 : 25;
                    return (
                      <div className={`text-xs font-display font-semibold ${s >= 70 ? "text-emerald-600" : s >= 40 ? "text-amber-600" : "text-rose-600"}`}>
                        ~{s}<span className="text-muted-foreground font-normal">/100</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
          <div className="px-5 pb-4">
            <FoodAnalysisEditor
              items={aiItems}
              onChange={setAiItems}
              confidence={aiResult.confidence}
              confidenceNote={aiResult.confidence_note || aiResult.notes}
            />
          </div>
          {aiResult.notes && (
            <div className="px-5 py-3 bg-muted/30 border-t border-border text-xs text-muted-foreground">
              {aiResult.notes}
            </div>
          )}
          <div className="p-4 border-t border-border flex gap-2 items-center">
            <Button onClick={addAiToLog} disabled={aiItems.length === 0} className="flex-1 rounded-xl"><Check className="size-4 mr-1" />Ajouter au journal</Button>
            <span className="text-[10px] text-muted-foreground">confiance {Math.round(aiResult.confidence * 100)}%</span>
          </div>
        </motion.div>
      )}

      {scanning && <BarcodeScanner onDetected={handleBarcode} onClose={() => setScanning(false)} />}
    </div>
  );
}
