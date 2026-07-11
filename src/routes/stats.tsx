import { createFileRoute } from "@tanstack/react-router";
import { Sparkles, TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader, StatCard } from "@/components/Stat";
import { useLocalState, lastNDays } from "@/lib/storage";

export const Route = createFileRoute("/stats")({
  head: () => ({ meta: [{ title: "Statistiques — Pace" }, { name: "description", content: "Analytics globales et insights intelligents." }] }),
  component: StatsPage,
});

function StatsPage() {
  const [sleep] = useLocalState<Record<string, { hours?: number }>>("lt.sleep", {});
  const [water] = useLocalState<Record<string, number>>("lt.water", {});
  const [nutrition] = useLocalState<Record<string, { kcal?: number }>>("lt.nutrition.totals", {});
  const [routines] = useLocalState<Record<string, string[]>>("lt.routine.done", {});
  const [work] = useLocalState<Record<string, number>>("lt.work.minutes", {});
  const [tx] = useLocalState<Array<{ date: string; amount: number }>>("lt.tx", []);

  const d30 = lastNDays(30);
  const avg = (arr: number[]) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;

  const sleepArr = d30.map((d) => sleep[d]?.hours ?? 0).filter((x) => x > 0);
  const waterArr = d30.map((d) => water[d] ?? 0).filter((x) => x > 0);
  const kcalArr = d30.map((d) => nutrition[d]?.kcal ?? 0).filter((x) => x > 0);
  const workArr = d30.map((d) => work[d] ?? 0).filter((x) => x > 0);

  // Insight: productivity vs sleep
  const goodSleepDays = d30.filter((d) => (sleep[d]?.hours ?? 0) >= 8);
  const badSleepDays = d30.filter((d) => (sleep[d]?.hours ?? 0) > 0 && (sleep[d]?.hours ?? 0) < 7);
  const prodGood = avg(goodSleepDays.map((d) => work[d] ?? 0));
  const prodBad = avg(badSleepDays.map((d) => work[d] ?? 0));
  const prodDelta = prodBad ? ((prodGood - prodBad) / prodBad) * 100 : 0;

  const totalSpend = tx.filter((x) => x.amount < 0).reduce((s, x) => s + -x.amount, 0);
  const totalIncome = tx.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);

  const insights = [
    prodGood && prodBad
      ? `Les jours où tu dors plus de 8h, ta productivité ${prodDelta >= 0 ? "augmente" : "diminue"} de ${Math.abs(prodDelta).toFixed(0)}%.`
      : "Continue d'enregistrer ton sommeil et tes sessions pour découvrir tes patterns.",
    avg(kcalArr) > 2300
      ? `Tu consommes ${(avg(kcalArr) - 2300).toFixed(0)} kcal de plus que la moyenne recommandée.`
      : avg(kcalArr) > 0
      ? `Ta moyenne calorique (${avg(kcalArr).toFixed(0)} kcal) reste en dessous du seuil de 2300.`
      : "Commence à tracker ta nutrition pour des insights précis.",
    totalSpend > totalIncome * 0.7 && totalIncome > 0
      ? `Tes dépenses représentent ${((totalSpend / totalIncome) * 100).toFixed(0)}% de tes revenus — surveille la pente.`
      : totalIncome > 0
      ? `Tu épargnes ${(((totalIncome - totalSpend) / totalIncome) * 100).toFixed(0)}% de tes revenus. Solide.`
      : "Ajoute tes transactions pour analyser ton cashflow.",
  ];

  return (
    <div>
      <PageHeader title="Statistiques" subtitle="Vos données, vos patterns, vos prochaines actions." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Sommeil moyen" value={avg(sleepArr).toFixed(1)} unit="h" />
        <StatCard label="Eau moyenne" value={(avg(waterArr) / 1000).toFixed(1)} unit="L" />
        <StatCard label="Calories moy." value={avg(kcalArr).toFixed(0)} unit="kcal" />
        <StatCard label="Focus moyen" value={Math.floor(avg(workArr) / 60)} unit="h/jour" />
      </div>

      <div className="space-y-3">
        {insights.map((t, i) => (
          <div key={i} className="rounded-2xl glass-card p-4 flex items-start gap-3">
            <div className="size-9 rounded-xl stat-grad grid place-items-center text-primary-foreground shrink-0">
              <Sparkles className="size-4" />
            </div>
            <div className="text-sm leading-relaxed">{t}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 mt-6">
        <div className="rounded-2xl glass-card p-5">
          <div className="flex items-center gap-2 text-[color:var(--success)] text-sm font-medium">
            <TrendingUp className="size-4" /> Records 30 jours
          </div>
          <ul className="mt-3 text-sm space-y-1.5 text-muted-foreground">
            <li>Meilleur sommeil : <span className="text-foreground font-medium">{Math.max(0, ...sleepArr).toFixed(1)} h</span></li>
            <li>Meilleur focus : <span className="text-foreground font-medium">{Math.floor(Math.max(0, ...workArr) / 60)}h{Math.max(0, ...workArr) % 60}</span></li>
            <li>Meilleur jour habitudes : <span className="text-foreground font-medium">{Math.max(0, ...d30.map((d) => (routines[d] ?? []).length))} cochées</span></li>
          </ul>
        </div>
        <div className="rounded-2xl glass-card p-5">
          <div className="flex items-center gap-2 text-destructive text-sm font-medium">
            <TrendingDown className="size-4" /> À surveiller
          </div>
          <ul className="mt-3 text-sm space-y-1.5 text-muted-foreground">
            <li>Jours sans tracking : <span className="text-foreground font-medium">{30 - sleepArr.length}</span></li>
            <li>Dette sommeil estimée : <span className="text-foreground font-medium">{Math.max(0, sleepArr.length * 8 - sleepArr.reduce((s, x) => s + x, 0)).toFixed(1)} h</span></li>
            <li>Dépenses 30j : <span className="text-foreground font-medium">{totalSpend.toFixed(0)} €</span></li>
          </ul>
        </div>
      </div>
    </div>
  );
}
