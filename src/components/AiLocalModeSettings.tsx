import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Cpu } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { getAiLocalSources, saveAiLocalSource } from "@/lib/ai-local-preferences.functions";
import { getLocalAiProfile, localAiSupported, setLocalAiEnabled } from "@/lib/local-ai";

export function AiLocalModeSettings() {
  const load = useServerFn(getAiLocalSources);
  const save = useServerFn(saveAiLocalSource);
  const [coachLocal, setCoachLocal] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load().then((value) => {
      setCoachLocal(value.coach);
      setLocalAiEnabled(value.coach);
    }).catch(() => toast.error("Impossible de charger le mode IA local"));
  }, [load]);

  const toggleCoach = async (enabled: boolean) => {
    if (enabled && !localAiSupported()) {
      toast.error("Ce navigateur ne peut pas exécuter l’IA locale. WebGPU est requis.");
      return;
    }
    setBusy(true);
    try {
      await save({ data: { agentType: "coach", enabled } });
      setCoachLocal(enabled);
      setLocalAiEnabled(enabled);
      toast.success(enabled ? "IA locale activée" : "IA Cloud activée");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible de modifier le mode IA");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl glass-thin p-4 space-y-4">
      <div className="flex items-start gap-3">
        <Cpu className="size-4 mt-0.5 text-primary" />
        <div>
          <div className="font-medium">IA locale</div>
          <div className="text-xs text-muted-foreground">Le modèle tourne dans votre navigateur avec WebGPU. Les requêtes locales prises en charge ne quittent pas l’appareil.</div>
        </div>
      </div>
      <div className="rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Profil matériel : {localAiSupported() ? getLocalAiProfile() : "WebGPU indisponible"}. Le mode local actuel est volontairement limité aux conversations Coach sans action ni image. Les lectures et modifications personnelles, Nutrition/Sport, ainsi que l’analyse d’image restent Cloud.</div>
      <div className="flex items-center justify-between gap-4 rounded-xl glass-thin px-3 py-2.5">
        <div><div className="text-sm font-medium">Coach IA</div><div className="text-xs text-muted-foreground">{coachLocal ? "Local" : "Cloud / fournisseur sélectionné"}</div></div>
        <Switch checked={coachLocal} onCheckedChange={(checked) => void toggleCoach(checked)} disabled={busy || !localAiSupported()} />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl glass-thin px-3 py-2.5">
        <div><div className="text-sm font-medium">BUILD IA</div><div className="text-xs text-muted-foreground">Cloud uniquement — le runtime local BUILD n’est pas activé.</div></div>
        <Switch checked={false} disabled aria-label="BUILD IA locale indisponible" />
      </div>
    </div>
  );
}
