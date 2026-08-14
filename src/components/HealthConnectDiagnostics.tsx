import { useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isNativeHealthConnectAvailable, requestHealthConnectSync } from "@/lib/health-connect-bridge";

const DATA = [
  ["steps", "Pas"], ["kcal_active", "Calories actives"], ["kcal_total", "Calories totales"],
  ["distance_m", "Distance"], ["heart_rate", "Fréquence cardiaque"], ["resting_heart_rate", "FC repos"],
  ["sleep_min", "Sommeil"], ["exercise_duration_min", "Entraînements"], ["weight_kg", "Poids"],
] as const;

export function HealthConnectDiagnostics() {
  const [native, setNative] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("En attente");

  useEffect(() => {
    setNative(isNativeHealthConnectAvailable());
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { source?: string; inserted?: number; deduped?: number } | undefined;
      if (detail?.source === "health_connect") {
        setLastSync(new Date().toISOString());
        setStatus(`${detail.inserted ?? 0} nouvelles données synchronisées`);
      }
    };
    window.addEventListener("pace.health.changed", handler);
    return () => window.removeEventListener("pace.health.changed", handler);
  }, []);

  const sync = () => {
    if (!native) { setStatus("Health Connect nécessite la version Android native de PaceOS."); return; }
    setStatus("Synchronisation…"); requestHealthConnectSync();
  };

  return <Card className="glass-card"><CardHeader><CardTitle className="flex items-center justify-between gap-3"><span>Diagnostic Xiaomi / Health Connect</span><span className="text-xs font-normal text-muted-foreground">{native ? "Android natif" : "Web/PWA"}</span></CardTitle></CardHeader><CardContent className="space-y-4">
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Health Connect</div><div className="mt-1 flex items-center gap-2 text-sm">{native ? <CheckCircle2 className="size-4 text-emerald-600"/> : <CircleAlert className="size-4 text-amber-600"/>}{native ? "Disponible" : "Non accessible depuis une PWA"}</div></div>
      <div className="rounded-xl border p-3"><div className="text-xs text-muted-foreground">Dernière synchronisation</div><div className="mt-1 text-sm">{lastSync ? new Date(lastSync).toLocaleString("fr-FR") : "Aucune"}</div></div>
    </div>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{DATA.map(([key, label]) => <div key={key} className="rounded-xl border px-3 py-2"><div className="text-xs text-muted-foreground">{label}</div><div className="text-xs mt-1">{native ? "Accessible si autorisé" : "Natif Android requis"}</div></div>)}</div>
    <div className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground leading-relaxed">Pour une montre Xiaomi/HyperOS, Mi Fitness doit d'abord synchroniser ses données vers une source tierce prise en charge. Xiaomi documente notamment la synchronisation cloud et les données tierces ; selon le modèle/région, les options peuvent varier. Pace ne fabrique aucune valeur si la source ne fournit pas la donnée.</div>
    <div className="flex flex-wrap gap-2"><Button size="sm" onClick={sync} className="gap-2"><RefreshCw className="size-3.5"/> Synchroniser maintenant</Button><Button size="sm" variant="outline" asChild><a href="https://www.mi.com/fr/support/faq/details/KA-317219/" target="_blank" rel="noreferrer" className="gap-2">Guide Mi Fitness <ExternalLink className="size-3.5"/></a></Button></div>
    <div className="text-[11px] text-muted-foreground">État : {status}</div>
  </CardContent></Card>;
}
