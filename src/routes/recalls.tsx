import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { checkRecallByBarcode, type RecallInfo } from "@/lib/rappel-conso";
import { useLocalState } from "@/lib/storage";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/recalls")({
  head: () => ({ meta: [{ title: "Rappels conso — Pace" }, { name: "description", content: "Alertes officielles sur les aliments que vous avez scannés." }] }),
  component: RecallsPage,
});

type ScanLite = { barcode: string | null; product_name: string | null; brand: string | null; created_at: string };
type RecallRow = ScanLite & { recalls: RecallInfo[] };

function RecallsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RecallRow[]>([]);
  const [checked, setChecked] = useState(0);
  const [, setRecallCount] = useLocalState<number>("lt.recalls.count", 0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("food_scans")
        .select("barcode, product_name, brand, created_at")
        .not("barcode", "is", null)
        .order("created_at", { ascending: false })
        .limit(100);
      const unique = new Map<string, ScanLite>();
      (data ?? []).forEach((s) => { if (s.barcode && !unique.has(s.barcode)) unique.set(s.barcode, s as ScanLite); });
      const list = Array.from(unique.values());
      const out: RecallRow[] = [];
      for (const s of list) {
        if (cancelled) return;
        const recalls = await checkRecallByBarcode(s.barcode!);
        if (recalls.length > 0) out.push({ ...s, recalls });
        setChecked((c) => c + 1);
      }
      if (!cancelled) { setRows(out); setRecallCount(out.length); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [user, setRecallCount]);

  if (!user) {
    return <div className="text-center py-12 text-muted-foreground">Connectez-vous pour voir les rappels.</div>;
  }

  return (
    <div>
      <PageHeader title="Rappels conso" subtitle="Alertes officielles RappelConso sur les produits que tu as scannés." />

      {loading && (
        <div className="rounded-2xl glass-card p-6 text-sm text-muted-foreground">
          Analyse de tes produits scannés… ({checked} vérifiés)
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="rounded-2xl glass-card p-6 flex items-center gap-3">
          <ShieldCheck className="size-6 text-emerald-500" />
          <div>
            <div className="font-medium">Aucun rappel actif</div>
            <div className="text-xs text-muted-foreground">Tous tes produits scannés sont OK selon RappelConso.</div>
          </div>
        </div>
      )}

      <div className="space-y-3 mt-3">
        {rows.map((r) => (
          <div key={r.barcode!} className="rounded-2xl bg-card border border-rose-500/30 p-4">
            <div className="flex items-start gap-3">
              <div className="size-10 rounded-xl bg-rose-500/10 grid place-items-center text-rose-600 shrink-0"><AlertTriangle className="size-5" /></div>
              <div className="flex-1 min-w-0">
                <div className="font-display text-lg font-semibold">{r.product_name ?? "Produit"} {r.brand && <span className="text-xs text-muted-foreground">· {r.brand}</span>}</div>
                <div className="text-[11px] text-muted-foreground">Code-barres {r.barcode}</div>
                {r.recalls.map((rc, i) => (
                  <div key={i} className="mt-2 text-sm">
                    <div className="font-medium text-rose-700 dark:text-rose-300">{rc.reason}</div>
                    {rc.risk && <div className="text-xs text-muted-foreground">Risque : {rc.risk}</div>}
                    {rc.date && <div className="text-[11px] text-muted-foreground">Publié le {rc.date}</div>}
                    {rc.url && (
                      <Button variant="ghost" size="sm" asChild className="h-7 px-2 mt-1">
                        <a href={rc.url} target="_blank" rel="noreferrer"><ExternalLink className="size-3 mr-1" />Fiche officielle</a>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
