import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Brain, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getAiPreferences, saveAiPreferences } from "@/lib/ai-history.functions";
import { DEFAULT_AI_PERMISSIONS, type AiPreferences, type MemoryLevel } from "@/lib/ai-history.types";

const PERMISSION_LABELS = {
  profile: "Profil & objectifs",
  nutrition: "Nutrition",
  sport: "Sport",
  sleep: "Sommeil",
  water: "Hydratation",
  habits: "Habitudes",
  calendar: "Calendrier",
  work: "Travail",
  finance: "Finance",
} as const;

export function AiSettings() {
  const load = useServerFn(getAiPreferences);
  const save = useServerFn(saveAiPreferences);
  const [value, setValue] = useState<AiPreferences>({ memory_level: "limited", permissions: DEFAULT_AI_PERMISSIONS, confirm_actions: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => { void load().then(setValue).catch(() => toast.error("Impossible de charger les préférences IA")); }, [load]);

  const submit = async () => {
    setSaving(true);
    try { await save({ data: value }); toast.success("Préférences IA enregistrées"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Erreur"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex items-center gap-2 font-medium"><Brain className="size-4 text-primary" />Mémoire</div>
        <Select value={value.memory_level} onValueChange={(memory_level) => setValue((current) => ({ ...current, memory_level: memory_level as MemoryLevel }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Aucune mémoire</SelectItem>
            <SelectItem value="limited">Mémoire limitée</SelectItem>
            <SelectItem value="complete">Mémoire complète</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">La mémoire ne change jamais vos permissions d’accès.</p>
      </section>
      <section className="space-y-3">
        <div className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-primary" />Permissions du Coach IA</div>
        {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center justify-between gap-4 rounded-xl glass-thin px-3 py-2.5">
            <span className="text-sm">{label}</span>
            <Switch checked={value.permissions[key as keyof typeof value.permissions]} onCheckedChange={(checked) => setValue((current) => ({ ...current, permissions: { ...current.permissions, [key]: checked } }))} />
          </div>
        ))}
      </section>
      <div className="flex items-center justify-between gap-4 rounded-xl glass-thin px-3 py-3">
        <div><div className="text-sm font-medium">Confirmation avant action</div><div className="text-xs text-muted-foreground">Valider chaque modification proposée</div></div>
        <Switch checked={value.confirm_actions} onCheckedChange={(confirm_actions) => setValue((current) => ({ ...current, confirm_actions }))} />
      </div>
      <Button onClick={submit} disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</Button>
    </div>
  );
}