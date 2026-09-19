import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Check, ChevronDown, CirclePlus, Copy, ListChecks, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDomainState } from "@/lib/domain-store";

export const Route = createFileRoute("/courses")({
  head: () => ({ meta: [{ title: "Courses — Pace" }, { name: "description", content: "Organisez les courses de la semaine, les quantités et les achats à faire." }] }),
  component: CoursesPage,
});

type GroceryCategory = "Fruits & légumes" | "Protéines" | "Féculents" | "Produits laitiers" | "Épicerie" | "Boissons" | "Maison" | "Autre";
type GroceryItem = { id: string; name: string; quantity: string; category: GroceryCategory; checked: boolean; note?: string };
const CATEGORIES: GroceryCategory[] = ["Fruits & légumes", "Protéines", "Féculents", "Produits laitiers", "Épicerie", "Boissons", "Maison", "Autre"];
const STARTER: GroceryItem[] = [];

function normalizeItems(value: unknown): GroceryItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is GroceryItem =>
    !!item &&
    typeof item === "object" &&
    typeof (item as GroceryItem).id === "string" &&
    typeof (item as GroceryItem).name === "string" &&
    typeof (item as GroceryItem).category === "string" &&
    typeof (item as GroceryItem).checked === "boolean"
  );
}

function CoursesPage() {
  const [items, setItems] = useDomainState<GroceryItem[]>("courses.items", STARTER);
  const safeItems = normalizeItems(items);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [category, setCategory] = useState<GroceryCategory>("Autre");
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");

  const visible = useMemo(() => safeItems.filter((item) => filter === "all" || (filter === "done" ? item.checked : !item.checked)), [safeItems, filter]);
  const remaining = safeItems.filter((item) => !item.checked).length;
  const done = safeItems.length - remaining;
  const grouped = CATEGORIES.map((cat) => ({ cat, items: visible.filter((item) => item.category === cat) })).filter((group) => group.items.length);

  const add = () => {
    const clean = name.trim();
    if (!clean) return;
    setItems((prev) => [{ id: crypto.randomUUID(), name: clean, quantity: quantity.trim(), category, checked: false }, ...normalizeItems(prev)]);
    setName("");
    setQuantity("");
  };
  const toggle = (id: string) => setItems((prev) => normalizeItems(prev).map((item) => item.id === id ? { ...item, checked: !item.checked } : item));
  const remove = (id: string) => setItems((prev) => normalizeItems(prev).filter((item) => item.id !== id));
  const clearDone = () => setItems((prev) => normalizeItems(prev).filter((item) => !item.checked));
  const addCommon = (value: string, cat: GroceryCategory) => setItems((prev) => [{ id: crypto.randomUUID(), name: value, quantity: "", category: cat, checked: false }, ...normalizeItems(prev)]);

  return (
    <div>
      <PageHeader title="Courses" subtitle="La liste de la semaine, simple à remplir et impossible à oublier." />

      <section className="glass-card p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="flex-1 min-w-[220px] relative">
              <ShoppingCart className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} placeholder="Ajouter un article…" className="pl-9" />
            </div>
            <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Quantité" className="w-28" />
            <select value={category} onChange={(e) => setCategory(e.target.value as GroceryCategory)} className="h-10 rounded-xl border bg-transparent px-3 text-sm outline-none">
              {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <Button onClick={add} className="rounded-xl"><Plus className="size-4 mr-1.5" />Ajouter</Button>
          </div>

          <div className="flex items-center justify-between gap-3 border-b pb-3 mb-3">
            <div className="flex gap-1.5">
              {([['all', `Tous · ${safeItems.length}`], ['open', `À acheter · ${remaining}`], ['done', `Faits · ${done}`]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${filter === key ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}>{label}</button>
              ))}
            </div>
            {done > 0 && <button onClick={clearDone} className="text-xs text-muted-foreground hover:text-foreground">Effacer les achats faits</button>}
          </div>

          {grouped.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              <ListChecks className="size-8 mx-auto mb-3 opacity-50" />
              <p>Ta liste est vide.</p>
              <p className="text-xs mt-1">Ajoute les produits à acheter cette semaine.</p>
            </div>
          ) : grouped.map(({ cat, items: group }) => (
            <div key={cat} className="border-b last:border-0 py-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{cat}</div>
              <div className="divide-y divide-border/50">
                {group.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 py-2.5 group">
                    <button onClick={() => toggle(item.id)} aria-label={item.checked ? `Marquer ${item.name} comme à acheter` : `Marquer ${item.name} comme acheté`} className={`size-5 rounded-full border grid place-items-center shrink-0 ${item.checked ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"}`}>{item.checked && <Check className="size-3" />}</button>
                    <div className={`flex-1 min-w-0 text-sm ${item.checked ? "line-through text-muted-foreground" : ""}`}>{item.name}</div>
                    {item.quantity && <div className="text-xs text-muted-foreground shrink-0">{item.quantity}</div>}
                    <button onClick={() => remove(item.id)} aria-label={`Supprimer ${item.name}`} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1"><Trash2 className="size-3.5" /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </section>
    </div>
  );
}
