import { createFileRoute, Link } from "@tanstack/react-router";
import { liquidTooltipStyle } from "@/lib/chart-style";
import { useState } from "react";
import { z } from "zod";
import { Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell, Legend } from "recharts";
import { PageHeader, StatCard } from "@/components/Stat";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useLocalState, todayKey } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FinanceLock } from "@/components/FinanceLockScreen";

const searchSchema = z.object({ tab: z.enum(["accounts", "investments"]).optional() });

export const Route = createFileRoute("/finance")({
  head: () => ({ meta: [{ title: "Finance & Investissements — Pace" }, { name: "description", content: "Comptes, dépenses, revenus et portefeuille." }] }),
  validateSearch: searchSchema,
  component: () => <FinanceLock><FinanceCombined /></FinanceLock>,
});

function FinanceCombined() {
  const { tab } = Route.useSearch();
  const current = tab ?? "accounts";
  return (
    <div>
      <PageHeader title="Finance & Investissements" subtitle="Vue globale de ton argent." />
      <div className="flex justify-center mb-4">
        <Tabs value={current}>
          <TabsList className="rounded-full h-10">
            <TabsTrigger value="accounts" asChild className="rounded-full px-5"><Link to="/finance" search={{ tab: "accounts" }}>Comptes</Link></TabsTrigger>
            <TabsTrigger value="investments" asChild className="rounded-full px-5"><Link to="/finance" search={{ tab: "investments" }}>Investissements</Link></TabsTrigger>
          </TabsList>
          <TabsContent value="accounts" />
          <TabsContent value="investments" />
        </Tabs>
      </div>
      {current === "accounts" ? <FinancePage /> : <InvestPage />}
    </div>
  );
}

type Tx = { id: string; date: string; amount: number; cat: string; note?: string; method?: string; shipping?: number };
const CATS = ["Vêtements", "Alimentation", "Transport", "Loisirs", "Santé", "Logement", "Salaire", "Investissement", "Autre"];

function FinancePage() {
  const [tx, setTx] = useLocalState<Tx[]>("lt.tx", []);
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState("Alimentation");
  const [note, setNote] = useState("");
  const [shipping, setShipping] = useState("");
  const [type, setType] = useState<"out" | "in">("out");

  const add = () => {
    if (!amount) return;
    const a = parseFloat(amount) * (type === "out" ? -1 : 1);
    setTx((p) => [{ id: crypto.randomUUID(), date: todayKey(), amount: a, cat, note, shipping: shipping ? parseFloat(shipping) : undefined }, ...p]);
    setAmount(""); setNote(""); setShipping("");
  };
  const remove = (id: string) => setTx((p) => p.filter((x) => x.id !== id));

  const income = tx.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const spend = tx.filter((x) => x.amount < 0).reduce((s, x) => s + -x.amount, 0);
  const net = income - spend;
  const byCat = CATS.map((c) => ({ name: c, value: tx.filter((x) => x.cat === c && x.amount < 0).reduce((s, x) => s + -x.amount, 0) })).filter((x) => x.value > 0);
  const last30 = (() => {
    const map: Record<string, number> = {};
    tx.forEach((x) => { map[x.date] = (map[x.date] ?? 0) + x.amount; });
    return Object.entries(map).slice(-30).map(([d, v]) => ({ d: d.slice(5), net: v }));
  })();
  const colors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#a78bfa", "#fb923c", "#34d399", "#94a3b8"];

  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard label="Revenus" value={`+${income.toFixed(0)}`} unit="€" icon={<TrendingUp className="size-4" />} />
        <StatCard label="Dépenses" value={`-${spend.toFixed(0)}`} unit="€" icon={<TrendingDown className="size-4" />} />
        <StatCard label="Net" value={`${net >= 0 ? "+" : ""}${net.toFixed(0)}`} unit="€" />
      </div>

      <div className="rounded-2xl glass-card p-5 mb-4">
        <div className="flex flex-wrap gap-2">
          <div className="flex rounded-xl bg-muted p-1">
            <button onClick={() => setType("out")} className={`px-4 py-1.5 rounded-lg text-sm transition ${type === "out" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Dépense</button>
            <button onClick={() => setType("in")} className={`px-4 py-1.5 rounded-lg text-sm transition ${type === "in" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Revenu</button>
          </div>
          <Input type="number" step="0.01" placeholder="Montant" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
          <Select value={cat} onValueChange={setCat}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} className="flex-1 min-w-40" />
          <Input type="number" placeholder="Livraison (€)" value={shipping} onChange={(e) => setShipping(e.target.value)} className="w-32" />
          <Button onClick={add} className="rounded-xl"><Plus className="size-4 mr-1" />Ajouter</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="rounded-2xl glass-card p-5">
          <div className="font-display text-lg font-semibold mb-3">Cashflow</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={last30}>
              <XAxis dataKey="d" fontSize={10} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
              <YAxis fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} />
              <Tooltip contentStyle={liquidTooltipStyle} />
              <Bar dataKey="net" radius={[6, 6, 0, 0]}>
                {last30.map((x, i) => <Cell key={i} fill={x.net >= 0 ? "var(--success)" : "var(--destructive)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rounded-2xl glass-card p-5">
          <div className="font-display text-lg font-semibold mb-3">Par catégorie</div>
          {byCat.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={byCat} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {byCat.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                </Pie>
                <Tooltip contentStyle={liquidTooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="h-56 grid place-items-center text-muted-foreground text-sm">Aucune dépense</div>}
        </div>
      </div>

      <div className="rounded-2xl glass-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 font-display text-sm font-semibold">Historique</div>
        <ul className="divide-y divide-border max-h-96 overflow-y-auto">
          {tx.map((x) => (
            <li key={x.id} className="px-5 py-3 flex items-center gap-3 group hover:bg-muted/20">
              <div className={`size-9 rounded-xl grid place-items-center text-sm ${x.amount > 0 ? "bg-[color:var(--success)]/15 text-[color:var(--success)]" : "bg-destructive/10 text-destructive"}`}>{x.amount > 0 ? "+" : "−"}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{x.note || x.cat}</div>
                <div className="text-xs text-muted-foreground">{x.date} · {x.cat}{x.shipping ? ` · livraison ${x.shipping}€` : ""}</div>
              </div>
              <div className={`text-sm font-semibold ${x.amount > 0 ? "text-[color:var(--success)]" : ""}`}>{x.amount > 0 ? "+" : ""}{x.amount.toFixed(2)}€</div>
              <button onClick={() => remove(x.id)} className="text-muted-foreground opacity-60 group-hover:opacity-100 hover:text-destructive"><Trash2 className="size-4" /></button>
            </li>
          ))}
          {tx.length === 0 && <li className="px-5 py-12 text-center text-muted-foreground text-sm">Aucune transaction</li>}
        </ul>
      </div>
    </div>
  );
}

const TYPES = ["Crypto", "Action", "ETF", "Immobilier", "Business", "Épargne"];
type Asset = { id: string; type: string; name: string; invested: number; current: number };

function InvestPage() {
  const [assets, setAssets] = useLocalState<Asset[]>("lt.assets", []);
  const [type, setType] = useState("Crypto");
  const [name, setName] = useState("");
  const [invested, setInvested] = useState("");
  const [current, setCurrent] = useState("");

  const add = () => {
    if (!name || !invested || !current) return;
    setAssets((p) => [...p, { id: crypto.randomUUID(), type, name, invested: +invested, current: +current }]);
    setName(""); setInvested(""); setCurrent("");
  };
  const remove = (id: string) => setAssets((p) => p.filter((x) => x.id !== id));
  const update = (id: string, val: number) => setAssets((p) => p.map((a) => a.id === id ? { ...a, current: val } : a));
  const totalInv = assets.reduce((s, a) => s + a.invested, 0);
  const totalCur = assets.reduce((s, a) => s + a.current, 0);
  const pl = totalCur - totalInv;
  const roi = totalInv ? (pl / totalInv) * 100 : 0;

  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard label="Investi" value={totalInv.toFixed(0)} unit="€" />
        <StatCard label="Valeur" value={totalCur.toFixed(0)} unit="€" icon={<TrendingUp className="size-4" />} />
        <StatCard label="ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}`} unit="%" delta={roi} />
      </div>

      <div className="rounded-2xl glass-card p-5 mb-4">
        <div className="grid md:grid-cols-5 gap-2">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="Nom (BTC...)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="number" placeholder="Investi €" value={invested} onChange={(e) => setInvested(e.target.value)} />
          <Input type="number" placeholder="Valeur actuelle €" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Button onClick={add} className="rounded-xl"><Plus className="size-4 mr-1" />Ajouter</Button>
        </div>
      </div>

      <div className="space-y-2">
        {assets.map((a) => {
          const p = a.current - a.invested;
          const r = a.invested ? (p / a.invested) * 100 : 0;
          return (
            <div key={a.id} className="group rounded-2xl glass-card p-4 flex items-center gap-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground w-20">{a.type}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">Investi {a.invested.toFixed(0)}€</div>
              </div>
              <Input type="number" value={a.current} onChange={(e) => update(a.id, +e.target.value)} className="w-28" />
              <div className={`text-right w-24 ${p >= 0 ? "text-[color:var(--success)]" : "text-destructive"}`}>
                <div className="font-semibold">{p >= 0 ? "+" : ""}{p.toFixed(0)}€</div>
                <div className="text-xs">{r >= 0 ? "+" : ""}{r.toFixed(1)}%</div>
              </div>
              <button onClick={() => remove(a.id)} className="text-muted-foreground opacity-60 group-hover:opacity-100 hover:text-destructive"><Trash2 className="size-4" /></button>
            </div>
          );
        })}
        {assets.length === 0 && <div className="text-center py-12 text-muted-foreground text-sm">Ajoute ton premier actif pour suivre ton portefeuille.</div>}
      </div>
    </div>
  );
}
