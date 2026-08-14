import { useEffect, useMemo, useState } from "react";
import { Activity, Apple, CheckCircle2, ExternalLink, HeartPulse, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface HealthConnectBridge { requestSync?: () => void }

declare global {
  interface Window {
    PaceHealthConnect?: HealthConnectBridge;
    webkit?: { messageHandlers?: { paceHealthKit?: { postMessage: (message: unknown) => void } } };
  }
}

function isAndroid() { return /Android/i.test(navigator.userAgent); }
function isIOS() { return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }

export function HealthSourcesSection() {
  const [healthConnectAvailable, setHealthConnectAvailable] = useState(false);
  const [healthKitBridgeAvailable, setHealthKitBridgeAvailable] = useState(false);
  const platform = useMemo(() => (isAndroid() ? "android" : isIOS() ? "ios" : "web"), []);

  useEffect(() => {
    setHealthConnectAvailable(!!window.PaceHealthConnect);
    setHealthKitBridgeAvailable(!!window.webkit?.messageHandlers?.paceHealthKit);
  }, []);

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
    window.webkit?.messageHandlers?.paceHealthKit?.postMessage({ action: "requestAuthorizationAndSync" });
  };

  return (
    <details className="rounded-2xl glass-card px-4 py-3 group">
      <summary className="cursor-pointer list-none flex items-center gap-2 text-sm font-medium">
        <HeartPulse className="size-4 text-primary" />
        <span className="flex-1">Sources de santé</span>
        <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="pt-3 space-y-3">
        <SourceCard icon={<Activity className="size-4" />} title="Health Connect" description="Android · Xiaomi / Mi Fitness → Health Connect → Pace" status={healthConnectAvailable ? "Disponible" : platform === "android" ? "Application Android requise" : "Indisponible dans la PWA"} action="Synchroniser" onClick={connectHealthConnect} />
        <SourceCard icon={<Apple className="size-4" />} title="Apple Santé" description="iPhone · Apple Santé / HealthKit → Pace" status={healthKitBridgeAvailable ? "Disponible" : platform === "ios" ? "Application iOS native requise" : "Indisponible dans la PWA"} action="Configurer" onClick={connectAppleHealth} />
        <SourceCard icon={<Smartphone className="size-4" />} title="Mi Fitness" description="Pas de connexion privée Xiaomi : les données passent par les APIs officielles du téléphone." status={platform === "android" ? "Via Health Connect" : platform === "ios" ? "Via Apple Santé" : "Via l'application mobile"} action="Voir le parcours" onClick={() => toast.info("Mi Fitness : active les données tierces puis synchronise vers Health Connect sur Android ou Apple Santé sur iPhone.")} />
        <div className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground leading-relaxed"><strong className="text-foreground">Aucune donnée simulée.</strong> Une source n'est indiquée comme connectée que lorsqu'une passerelle native réelle est disponible.</div>
      </div>
    </details>
  );
}

function SourceCard({ icon, title, description, status, onClick, action }: { icon: React.ReactNode; title: string; description: string; status: string; onClick: () => void; action: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-start gap-3">
        <div className="size-9 rounded-lg bg-muted grid place-items-center shrink-0">{icon}</div>
        <div className="flex-1 min-w-0"><div className="font-medium text-sm">{title}</div><div className="text-xs text-muted-foreground mt-0.5">{description}</div><div className="flex items-center gap-1.5 mt-2 text-[11px]"><CheckCircle2 className="size-3.5" /><span>{status}</span></div></div>
        <Button size="sm" variant="secondary" className="rounded-xl shrink-0" onClick={onClick}>{action}<ExternalLink className="size-3.5 ml-1" /></Button>
      </div>
    </div>
  );
}
