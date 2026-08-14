import { useEffect, useMemo, useState } from "react";
import { Activity, Apple, CheckCircle2, ExternalLink, HeartPulse, Smartphone } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { insertHealthSamples } from "@/lib/health.functions";
import { toast } from "sonner";

interface HealthConnectBridge { requestSync?: () => void }
interface AppleHealthBridge { _receive?: (payload: { ok?: boolean; status?: string; error?: string; samples?: Array<{ ts: string; type: string; value: number; source: string }> }) => void }

declare global {
  interface Window {
    PaceHealthConnect?: HealthConnectBridge;
    PaceAppleHealth?: AppleHealthBridge;
    webkit?: { messageHandlers?: { paceHealthKit?: { postMessage: (message: unknown) => void } } };
  }
}

function isAndroid() { return /Android/i.test(navigator.userAgent); }
function isIOS() { return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }

export function HealthSourcesSection() {
  const insert = useServerFn(insertHealthSamples);
  const [healthConnectAvailable, setHealthConnectAvailable] = useState(false);
  const [healthKitBridgeAvailable, setHealthKitBridgeAvailable] = useState(false);
  const [appleSyncing, setAppleSyncing] = useState(false);
  const platform = useMemo(() => (isAndroid() ? "android" : isIOS() ? "ios" : "web"), []);

  useEffect(() => {
    setHealthConnectAvailable(!!window.PaceHealthConnect);
    setHealthKitBridgeAvailable(!!window.webkit?.messageHandlers?.paceHealthKit);
    const previous = window.PaceAppleHealth?._receive;
    window.PaceAppleHealth = {
      _receive: async (payload) => {
        if (!payload?.ok) {
          setAppleSyncing(false);
          toast.error(payload?.error || "Impossible de synchroniser Apple Santé");
          return;
        }
        const samples = (payload.samples ?? []).filter((sample) => Number.isFinite(sample.value) && sample.ts && sample.type && sample.source === "apple_health");
        try {
          let inserted = 0;
          for (let i = 0; i < samples.length; i += 500) {
            const chunk = samples.slice(i, i + 500);
            const result = await insert({ data: { samples: chunk as never } });
            inserted += result.inserted;
          }
          toast.success(`${inserted} données Apple Santé synchronisées`);
        } catch {
          toast.error("Les données Apple Santé ont été lues mais n'ont pas pu être synchronisées vers Pace.");
        } finally {
          setAppleSyncing(false);
        }
      },
    };
    return () => { if (previous) window.PaceAppleHealth = { _receive: previous }; else delete window.PaceAppleHealth; };
  }, [insert]);

  const connectHealthConnect = () => {
    if (!healthConnectAvailable) {
      toast.info("Health Connect nécessite l'application Android Pace. La PWA ne peut pas y accéder directement.");
      return;
    }
    window.PaceHealthConnect?.requestSync?.();
  };

  const connectAppleHealth = () => {
    if (!healthKitBridgeAvailable) {
      toast.info("Apple Santé nécessite la version iOS native de Pace avec HealthKit. La PWA ne peut pas y accéder directement.");
      return;
    }
    setAppleSyncing(true);
    window.webkit?.messageHandlers?.paceHealthKit?.postMessage({ action: "requestAuthorizationAndSync" });
  };

  return (
    <details className="rounded-2xl glass-card px-4 py-3 group">
      <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-medium"><HeartPulse className="size-4 text-primary" /><span className="flex-1">Sources de santé</span><span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">⌄</span></summary>
      <div className="pt-3 space-y-3">
        <SourceCard icon={<Activity className="size-4" />} title="Health Connect" description="Android · Xiaomi / Mi Fitness → Health Connect → Pace" status={healthConnectAvailable ? "Disponible" : platform === "android" ? "Application Android requise" : "Indisponible dans la PWA"} action="Synchroniser" onClick={connectHealthConnect} />
        <SourceCard icon={<Apple className="size-4" />} title="Apple Santé" description="iPhone · Apple Santé / HealthKit → Pace" status={healthKitBridgeAvailable ? appleSyncing ? "Synchronisation…" : "Disponible" : platform === "ios" ? "Application iOS native requise" : "Indisponible dans la PWA"} action="Configurer" onClick={connectAppleHealth} />
        <SourceCard icon={<Smartphone className="size-4" />} title="Mi Fitness" description="Pas de connexion privée Xiaomi : les données passent par les APIs officielles du téléphone." status={platform === "android" ? "Via Health Connect" : platform === "ios" ? "Via Apple Santé" : "Via l'application mobile"} action="Voir le parcours" onClick={() => toast.info("Mi Fitness : active les données tierces puis synchronise vers Health Connect sur Android ou Apple Santé sur iPhone.")} />
        <div className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground leading-relaxed"><strong className="text-foreground">Aucune donnée simulée.</strong> Une source n'est indiquée comme connectée que lorsqu'une passerelle native réelle est disponible.</div>
      </div>
    </details>
  );
}

function SourceCard({ icon, title, description, status, onClick, action }: { icon: React.ReactNode; title: string; description: string; status: string; onClick: () => void; action: string }) {
  return <div className="rounded-xl border border-border p-3"><div className="flex items-start gap-3"><div className="size-9 rounded-lg bg-muted grid place-items-center shrink-0">{icon}</div><div className="flex-1 min-w-0"><div className="font-medium text-sm">{title}</div><div className="text-xs text-muted-foreground mt-0.5">{description}</div><div className="flex items-center gap-1.5 mt-2 text-[11px]"><CheckCircle2 className="size-3.5" /><span>{status}</span></div></div><Button size="sm" variant="secondary" className="rounded-xl shrink-0" onClick={onClick}>{action}<ExternalLink className="size-3.5 ml-1" /></Button></div></div>;
}
