import { useMemo, useRef, useState } from "react";
import { Heart, Clock, Flame, Plus, Trash2, Pencil, Check, X, ChefHat, Search, Image as ImageIcon, ArrowLeft, ArrowRight, BookOpen } from "lucide-react";
import { useLocalState } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { addNutritionItem } from "@/lib/nutrition-log";
import { toast } from "sonner";

type Recipe = {
  id: string; name: string; cat: string; emoji: string; photo?: string;
  kcal: number; p: number; c: number; f: number;
  minutes: number; ingredients: string[];
  steps?: string;
  custom?: boolean;
};

const SEED: Recipe[] = [
  { id: "s1", name: "Bowl protéiné avoine", cat: "Petit déjeuner", emoji: "🥣", kcal: 420, p: 28, c: 52, f: 10, minutes: 5, ingredients: ["80g flocons d'avoine", "30g whey", "200ml lait", "fruits rouges"] },
  { id: "s2", name: "Poulet riz brocolis", cat: "Déjeuner", emoji: "🍗", kcal: 580, p: 45, c: 60, f: 14, minutes: 25, ingredients: ["180g poulet", "100g riz", "200g brocolis", "huile olive"] },
  { id: "s3", name: "Skyr fruits noix", cat: "Goûter", emoji: "🥛", kcal: 250, p: 22, c: 18, f: 9, minutes: 2, ingredients: ["200g skyr", "1 banane", "20g noix"] },
  { id: "s4", name: "Saumon patate douce", cat: "Dîner", emoji: "🐟", kcal: 620, p: 38, c: 50, f: 22, minutes: 30, ingredients: ["180g saumon", "200g patate douce", "salade", "citron"] },
  { id: "s5", name: "Smoothie vert", cat: "Petit déjeuner", emoji: "🥬", kcal: 280, p: 18, c: 38, f: 6, minutes: 4, ingredients: ["épinards", "banane", "whey", "lait amande"] },
  { id: "s6", name: "Pâtes thon avocat", cat: "Déjeuner", emoji: "🍝", kcal: 540, p: 32, c: 65, f: 16, minutes: 15, ingredients: ["100g pâtes", "1 boîte thon", "1/2 avocat", "tomates"] },
];

const DEFAULT_CATS = ["Petit déjeuner", "Déjeuner", "Goûter", "Dîner"];

async function cropTo1x1(file: File, size = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const sx = (img.width - s) / 2;
      const sy = (img.height - s) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

const emptyRecipe = (): Recipe => ({
  id: crypto.randomUUID(), name: "", cat: DEFAULT_CATS[0], emoji: "🍽️",
  kcal: 0, p: 0, c: 0, f: 0, minutes: 10, ingredients: [], steps: "", custom: true,
});

export function RecipesView() {
  const [favs, setFavs] = useLocalState<string[]>("lt.recipes.favs", []);
  const [custom, setCustom] = useLocalState<Recipe[]>("lt.recipes.custom", []);
  const [extraCats, setExtraCats] = useLocalState<string[]>("lt.recipes.cats", []);
  const [hiddenSeeds, setHiddenSeeds] = useLocalState<string[]>("lt.recipes.hidden", []);
  const [editing, setEditing] = useState<Recipe | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [viewing, setViewing] = useState<Recipe | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [query, setQuery] = useState("");

  const cats = [...DEFAULT_CATS, ...extraCats];
  const all = [
    ...SEED.filter((r) => !hiddenSeeds.includes(r.id)).map((r) => {
      // if a customized version exists, prefer it
      const c = custom.find((x) => x.id === r.id);
      return c ? { ...c, custom: true } : r;
    }),
    ...custom.filter((c) => !SEED.some((s) => s.id === c.id)).map((c) => ({ ...c, custom: true })),
  ];
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => q ? all.filter((r) => (r.name + " " + r.ingredients.join(" ")).toLowerCase().includes(q)) : all,
    [all, q]
  );

  const openNew = () => { setEditing(emptyRecipe()); setEditOpen(true); };
  const openEdit = (r: Recipe) => { setEditing({ ...r, custom: true }); setEditOpen(true); };

  const upsert = (r: Recipe) => {
    if (!r.name.trim()) { toast.error("Le nom est obligatoire"); return; }
    setCustom((p) => {
      const idx = p.findIndex((x) => x.id === r.id);
      if (idx >= 0) { const next = [...p]; next[idx] = r; return next; }
      return [...p, r];
    });
    toast.success("Recette enregistrée");
    setEditOpen(false); setEditing(null);
  };

  const remove = (id: string) => {
    if (SEED.some((s) => s.id === id)) setHiddenSeeds((p) => (p.includes(id) ? p : [...p, id]));
    setCustom((p) => p.filter((x) => x.id !== id));
  };

  const addToLog = (r: Recipe, meal: string) => {
    addNutritionItem({ name: `${r.emoji} ${r.name}`, meal, kcal: r.kcal, p: r.p, c: r.c, f: r.f });
    toast.success(`${r.name} ajouté à ${meal}`);
  };

  const addCat = () => {
    const v = newCat.trim();
    if (!v || cats.includes(v)) return;
    setExtraCats((p) => [...p, v]);
    setNewCat("");
  };
  const renameCat = (oldName: string) => {
    const v = prompt("Nouveau nom :", oldName)?.trim();
    if (!v || v === oldName) return;
    if (cats.includes(v)) { toast.error("Catégorie déjà existante"); return; }
    setExtraCats((p) => p.map((x) => x === oldName ? v : x));
    setCustom((p) => p.map((r) => r.cat === oldName ? { ...r, cat: v } : r));
  };
  const deleteCat = (name: string) => {
    if (!confirm(`Supprimer la catégorie "${name}" ?`)) return;
    setExtraCats((p) => p.filter((x) => x !== name));
    setCustom((p) => p.map((r) => r.cat === name ? { ...r, cat: "Déjeuner" } : r));
  };
  const moveCat = (idx: number, dir: -1 | 1) => {
    setExtraCats((p) => {
      const next = [...p]; const t = idx + dir;
      if (t < 0 || t >= next.length) return p;
      [next[idx], next[t]] = [next[t], next[idx]];
      return next;
    });
  };

  const favList = filtered.filter((r) => favs.includes(r.id));

  return (
    <div>
      <div className="rounded-2xl glass-card p-3 mb-4 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher (nom, ingrédient…)" className="pl-9" />
        </div>
        <Button onClick={openNew} className="rounded-xl"><Plus className="size-4 mr-1" />Nouvelle</Button>
        <Button variant="secondary" onClick={() => setQuickOpen(true)} className="rounded-xl">
          <Plus className="size-4 mr-1" />Ajout rapide repas
        </Button>
      </div>

      <div className="rounded-2xl glass-card p-3 mb-4">
        <div className="text-xs text-muted-foreground mb-2">Catégories</div>
        <div className="flex flex-wrap gap-2 items-center">
          {DEFAULT_CATS.map((c) => <span key={c} className="text-xs rounded-full bg-muted px-3 py-1">{c}</span>)}
          {extraCats.map((c, idx) => (
            <span key={c} className="text-xs rounded-full bg-muted px-2 py-1 flex items-center gap-1">
              <button onClick={() => moveCat(idx, -1)} disabled={idx === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Déplacer à gauche"><ArrowLeft className="size-3" /></button>
              <button onClick={() => moveCat(idx, 1)} disabled={idx === extraCats.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label="Déplacer à droite"><ArrowRight className="size-3" /></button>
              <span className="px-1">{c}</span>
              <button onClick={() => renameCat(c)} className="text-muted-foreground hover:text-foreground"><Pencil className="size-3" /></button>
              <button onClick={() => deleteCat(c)} aria-label={`Supprimer la catégorie ${c}`} className="text-muted-foreground hover:text-destructive"><X className="size-3" /></button>
            </span>
          ))}
          <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nouvelle catégorie" className="h-7 w-44 text-xs" />
          <Button variant="ghost" size="sm" onClick={addCat} className="h-7 rounded-lg">Ajouter</Button>
        </div>
      </div>

      {favList.length > 0 && !q && (
        <div className="mb-6">
          <div className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
            <Heart className="size-4 text-destructive fill-current" /> Favoris
          </div>
          <RecipeGrid list={favList} favs={favs} setFavs={setFavs} onEdit={openEdit} onView={setViewing} onRemove={remove} onAddToLog={addToLog} defaultMeals={DEFAULT_CATS} />
        </div>
      )}

      {cats.map((c) => {
        const list = filtered.filter((r) => r.cat === c);
        if (q && list.length === 0) return null;
        return (
          <div key={c} className="mb-6">
            <div className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
              <ChefHat className="size-4 text-muted-foreground" /> {c}
              <span className="text-xs text-muted-foreground font-normal">({list.length})</span>
            </div>
            {list.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">Aucune recette.</div>
            ) : (
              <RecipeGrid list={list} favs={favs} setFavs={setFavs} onEdit={openEdit} onView={setViewing} onRemove={remove} onAddToLog={addToLog} defaultMeals={DEFAULT_CATS} />
            )}
          </div>
        );
      })}

      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditing(null); }}>
        {editing && <RecipeForm key={editing.id} recipe={editing} cats={cats} onSave={upsert} onCancel={() => { setEditOpen(false); setEditing(null); }} />}
      </Dialog>

      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <QuickAddDialog onClose={() => setQuickOpen(false)} />
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
        {viewing && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><span className="text-2xl">{viewing.emoji}</span>{viewing.name}</DialogTitle>
              <DialogDescription>{viewing.cat} · {viewing.minutes} min · {viewing.kcal} kcal · P {viewing.p}g · G {viewing.c}g · L {viewing.f}g</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 -mt-2">
              <Button size="sm" variant="secondary" onClick={() => { const r = viewing; setViewing(null); openEdit(r); }} className="rounded-lg">
                <Pencil className="size-3.5 mr-1" />Modifier
              </Button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto space-y-4">
              {viewing.photo && <img src={viewing.photo} alt={viewing.name} className="w-full aspect-square object-cover rounded-xl" />}
              {viewing.ingredients.length > 0 && (
                <div>
                  <div className="font-medium text-sm mb-1.5">Ingrédients</div>
                  <ul className="text-sm space-y-1 list-disc list-inside text-muted-foreground">
                    {viewing.ingredients.map((i, k) => <li key={k}>{i}</li>)}
                  </ul>
                </div>
              )}
              {viewing.steps && (
                <div>
                  <div className="font-medium text-sm mb-1.5">Instructions</div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">{viewing.steps}</div>
                </div>
              )}
              {!viewing.steps && viewing.ingredients.length === 0 && (
                <div className="text-sm text-muted-foreground italic">Aucun détail. Modifie la recette pour ajouter les instructions.</div>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function RecipeGrid({ list, favs, setFavs, onEdit, onView, onRemove, onAddToLog, defaultMeals }: {
  list: Recipe[];
  favs: string[];
  setFavs: (v: string[] | ((p: string[]) => string[])) => void;
  onEdit: (r: Recipe) => void;
  onView: (r: Recipe) => void;
  onRemove: (id: string) => void;
  onAddToLog: (r: Recipe, meal: string) => void;
  defaultMeals: string[];
}) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {list.map((r) => (
        <div key={r.id} className="rounded-2xl glass-card p-4 hover:shadow-[var(--shadow-card)] transition flex flex-col">
          <div className="flex items-start justify-between gap-2">
            {r.photo ? (
              <img src={r.photo} alt={r.name} className="size-16 rounded-xl object-cover aspect-square" />
            ) : (
              <div className="text-4xl">{r.emoji}</div>
            )}
            <div className="flex gap-1">
              <button
                onClick={() => setFavs((p) => p.includes(r.id) ? p.filter((x) => x !== r.id) : [...p, r.id])}
                className={favs.includes(r.id) ? "text-destructive" : "text-muted-foreground hover:text-destructive"}
                aria-label="Favori"
              >
                <Heart className={`size-4 ${favs.includes(r.id) ? "fill-current" : ""}`} />
              </button>
              <button onClick={() => onEdit(r)} className="text-muted-foreground hover:text-foreground" aria-label="Modifier"><Pencil className="size-4" /></button>
              <button
                onClick={() => { if (confirm(`Supprimer "${r.name}" ?`)) onRemove(r.id); }}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Supprimer"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
          <div className="font-medium mt-2">{r.name}</div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            <span><Flame className="inline size-3" /> {r.kcal} kcal</span>
            <span><Clock className="inline size-3" /> {r.minutes}m</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">P {r.p}g · G {r.c}g · L {r.f}g</div>
          {r.ingredients.length > 0 && (
            <div className="text-[11px] text-muted-foreground mt-2 line-clamp-2">{r.ingredients.join(" · ")}</div>
          )}
          <div className="mt-auto pt-3 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => onView(r)} className="h-8 rounded-lg px-2" aria-label="Voir la recette">
              <BookOpen className="size-3.5" />
            </Button>
            <Select onValueChange={(v) => onAddToLog(r, v)}>
              <SelectTrigger className="h-8 text-xs rounded-lg flex-1"><SelectValue placeholder="Ajouter à…" /></SelectTrigger>
              <SelectContent>{defaultMeals.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickAddDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [p, setP] = useState(""); const [c, setC] = useState(""); const [f, setF] = useState("");
  const [meal, setMeal] = useState("Déjeuner");
  const submit = () => {
    if (!name || !kcal) { toast.error("Nom et calories obligatoires"); return; }
    addNutritionItem({ name, meal, kcal: +kcal || 0, p: +p || 0, c: +c || 0, f: +f || 0 });
    toast.success(`Ajouté à ${meal}`);
    onClose();
  };
  return (
    <DialogContent className="max-w-sm">
      <DialogHeader><DialogTitle>Ajout rapide</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <Input placeholder="Nom de l'aliment" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={meal} onValueChange={setMeal}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{["Petit déjeuner", "Déjeuner", "Goûter", "Dîner", "Collation"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-4 gap-2">
          <Input type="number" placeholder="kcal" value={kcal} onChange={(e) => setKcal(e.target.value)} />
          <Input type="number" placeholder="P" value={p} onChange={(e) => setP(e.target.value)} />
          <Input type="number" placeholder="G" value={c} onChange={(e) => setC(e.target.value)} />
          <Input type="number" placeholder="L" value={f} onChange={(e) => setF(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={submit}>Ajouter</Button>
        </div>
      </div>
    </DialogContent>
  );
}

function RecipeForm({ recipe, cats, onSave, onCancel }: { recipe: Recipe; cats: string[]; onSave: (r: Recipe) => void; onCancel: () => void }) {
  const [r, setR] = useState<Recipe>(recipe);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = <K extends keyof Recipe>(k: K, v: Recipe[K]) => setR({ ...r, [k]: v });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try { update("photo", await cropTo1x1(f)); } catch { toast.error("Image illisible"); }
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>{recipe.name ? "Modifier la recette" : "Nouvelle recette"}</DialogTitle></DialogHeader>
      <div className="space-y-3 max-h-[75vh] overflow-y-auto">
        <div className="flex gap-3 items-center">
          {r.photo ? (
            <div className="relative">
              <img src={r.photo} alt={`Photo de la recette ${r.name}`} className="size-20 rounded-xl object-cover aspect-square" />
              <button onClick={() => update("photo", undefined)} aria-label="Retirer la photo" className="absolute -top-1 -right-1 size-5 rounded-full bg-destructive text-destructive-foreground grid place-items-center"><X className="size-3" /></button>
            </div>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="size-20 rounded-xl border-2 border-dashed border-border grid place-items-center text-muted-foreground hover:bg-muted">
              <ImageIcon className="size-5" />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          <div className="flex-1 space-y-2">
            <Input value={r.emoji} onChange={(e) => update("emoji", e.target.value)} maxLength={2} placeholder="Emoji" className="text-center" />
            <Input placeholder="Nom" value={r.name} onChange={(e) => update("name", e.target.value)} />
          </div>
        </div>
        {!r.photo && (
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} className="w-full"><ImageIcon className="size-3 mr-1" />Ajouter une photo</Button>
        )}
        <Select value={r.cat} onValueChange={(v) => update("cat", v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <div className="grid grid-cols-4 gap-2">
          <Input type="number" placeholder="kcal" value={r.kcal || ""} onChange={(e) => update("kcal", +e.target.value || 0)} />
          <Input type="number" placeholder="P" value={r.p || ""} onChange={(e) => update("p", +e.target.value || 0)} />
          <Input type="number" placeholder="G" value={r.c || ""} onChange={(e) => update("c", +e.target.value || 0)} />
          <Input type="number" placeholder="L" value={r.f || ""} onChange={(e) => update("f", +e.target.value || 0)} />
        </div>
        <Input type="number" placeholder="Temps (min)" value={r.minutes || ""} onChange={(e) => update("minutes", +e.target.value || 0)} />
        <div>
          <label className="text-xs text-muted-foreground">Ingrédients (un par ligne)</label>
          <Textarea placeholder="Ex: 100g riz&#10;180g poulet" value={r.ingredients.join("\n")}
            onChange={(e) => update("ingredients", e.target.value.split("\n").filter(Boolean))} rows={4} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Recette complète (étapes)</label>
          <Textarea placeholder="Écris ici la recette étape par étape…" value={r.steps ?? ""}
            onChange={(e) => update("steps", e.target.value)} rows={6} />
        </div>
        <div className="flex gap-2 justify-end sticky bottom-0 bg-background pt-2">
          <Button variant="ghost" onClick={onCancel}><X className="size-4 mr-1" />Annuler</Button>
          <Button onClick={() => onSave(r)}><Check className="size-4 mr-1" />Enregistrer</Button>
        </div>
      </div>
    </DialogContent>
  );
}
