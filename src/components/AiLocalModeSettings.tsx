import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Cpu } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { getAiLocalSources, saveAiLocalSource } from "@/lib/ai-local-preferences.functions";
import type { AgentType } from "@/lib/ai-history.types";
import { getLocalAiProfile, localAiSupported, setLocalAiEnabled } from "@/lib/local-ai";

export function AiLocalModeSettings() {
  const load = useServerFn(getAiLocalSources);
  const save = useServerFn(saveAiLocalSource);
  const [sources, setSources] = useState({ coach: false, build: false });
  const [busy, setBusy] = useState<AgentType | null>(null);

  useEffect(() => {
    void load().then((value) => {
      setSources(value);
      setLocalAiEnabled(value.coach);
    }).catch(() => toast.error("Impossible de charger le mode IA local"));
  }, [load]);

  const toggle = async (agentType: AgentType, enabled: boolean) => {
    if (enabled && !localAiSupported()) {
      toast.error("Ce navigateur ne peut pas exécuter l’IA locale. WebGPU est requis.");
      return;
    }
    setBusy(agentType);
    try {
      await save({ data: { agentType, enabled } });
      setSources((current) => ({ ...current, [agentType]: enabled }));
      if (agentType === "coach") setLocalAiEnabled(enabled);
      toast.success(enabled ? "IA locale activée" : "IA Cloud activée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de modifier le mode IA");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl glass-thin p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Cpu className="size-4 mt-0.5 text-primary" />
        <div>
          <div className="font-medium">IA locale</div>
          <div className="text-xs text-muted-foreground">Le modèle tourne dans votre navigateur avec WebGPU. Les requêtes prises en charge ne quittent pas l’appareil.</div>
        </div>
      </div>
      <div className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Profil matériel : {localAiSupported() ? getLocalAiProfile() : "WebGPU indisponible"}. Le mode local est réservé aux conversations sans action et sans image. Les modifications Nutrition/Sport et l’analyse d’image restent Cloud.</div>
      <div className="flex items-center justify-between gap-4 rounded-xl glass-thin px-3 py-2.5">
        <div><div className="text-sm font-medium">Coach IA</div><div className="text-xs text-muted-foreground">{sources.coach ? "Local" : "Cloud / fournisseur sélectionné"}</div></div>
        <Switch checked={sources.coach} onCheckedChange={(checked) => void toggle("coach", checked)} disabled={busy === "coach" || !localAiSupported()} />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl glass-thin px-3 py-2.5">
        <div><div className="text-sm font-medium">BUILD IA</div><div className="text-xs text-muted-foreground">{sources.build ? "Local" : "Cloud / fournisseur sélectionné"}</div></div>
        <Switch checked={sources.build} onCheckedChange={(checked) => void toggle("build", checked)} disabled={busy === "build" || !localAiSupported()} />
      </div>
    </div>
  );
}
