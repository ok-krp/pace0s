import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LogOut, User as UserIcon } from "lucide-react";
import { PageHeader } from "@/components/Stat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/profile")({
  head: () => ({ meta: [{ title: "Profil — Pace" }] }),
  component: ProfilePage,
});

type Profile = {
  display_name: string | null;
  age: number | null;
  sex: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  weight_goal_kg: number | null;
  daily_calorie_goal: number | null;
  daily_protein_goal: number | null;
  daily_water_ml_goal: number | null;
  training_goal: string | null;
  training_sessions_goal: number;
};

function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [p, setP] = useState<Profile>({
    display_name: "", age: null, sex: null, height_cm: null,
    weight_kg: null, weight_goal_kg: null,
    daily_calorie_goal: 2300, daily_protein_goal: 140, daily_water_ml_goal: 2500,
    training_goal: "hypertrophy", training_sessions_goal: 3,
  });
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const skipNextSave = useRef(true);

  useEffect(() => {
    if (!user) { navigate({ to: "/login", search: { next: "/" } }); return; }
    skipNextSave.current = true;
    supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      if (data) {
        const row = data as unknown as Partial<Profile>;
        setP((current) => ({ ...current, ...row, training_sessions_goal: Math.min(7, Math.max(1, Number(row.training_sessions_goal ?? current.training_sessions_goal))) }));
      }
      setHydrated(true);
    });
  }, [user, navigate]);

  useEffect(() => {
    if (!user || !hydrated) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }

    const timer = window.setTimeout(async () => {
      setSaving(true);
      const { training_sessions_goal, ...profileData } = p;
      const { error } = await supabase.from("profiles").upsert({
        ...profileData,
        training_sessions_goal: Math.min(7, Math.max(1, Number(training_sessions_goal || 3))),
        user_id: user.id,
        email: user.email,
      } as never, { onConflict: "user_id" });
      setSaving(false);
      if (error) toast.error(error.message);
    }, 600);

    return () => window.clearTimeout(timer);
  }, [p, user, hydrated]);

  const num = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setP((s) => ({ ...s, [k]: e.target.value === "" ? null : Number(e.target.value) }));

  return (
    <div>
      <PageHeader title="Mon profil" subtitle="Vos infos guident l'IA et vos objectifs." />

      <div className="rounded-2xl glass-card p-6 mb-4">
        <div className="flex items-center gap-3 mb-5">
          <div className="size-12 rounded-full stat-grad grid place-items-center text-primary-foreground">
            <UserIcon className="size-5" />
          </div>
          <div>
            <div className="font-medium">{user?.email}</div>
            <div className="text-xs text-muted-foreground">Compte synchronisé</div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Nom affiché</Label>
            <Input value={p.display_name ?? ""} onChange={(e) => setP({ ...p, display_name: e.target.value })} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Sexe</Label>
            <Select value={p.sex ?? ""} onValueChange={(v) => setP({ ...p, sex: v })}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Homme</SelectItem>
                <SelectItem value="female">Femme</SelectItem>
                <SelectItem value="other">Autre</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Âge</Label>
            <Input type="number" value={p.age ?? ""} onChange={num("age")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Taille (cm)</Label>
            <Input type="number" value={p.height_cm ?? ""} onChange={num("height_cm")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Poids actuel (kg)</Label>
            <Input type="number" step="0.1" value={p.weight_kg ?? ""} onChange={num("weight_kg")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Poids cible (kg)</Label>
            <Input type="number" step="0.1" value={p.weight_goal_kg ?? ""} onChange={num("weight_goal_kg")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Objectif d'entraînement</Label>
            <Select value={p.training_goal ?? ""} onValueChange={(v) => setP({ ...p, training_goal: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hypertrophy">Hypertrophie</SelectItem>
                <SelectItem value="strength">Force</SelectItem>
                <SelectItem value="fitness">Remise en forme</SelectItem>
                <SelectItem value="cut">Sèche</SelectItem>
                <SelectItem value="none">Aucun</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Entraînements par semaine</Label>
            <Input
              type="number"
              min={1}
              max={7}
              step={1}
              value={p.training_sessions_goal}
              onChange={(e) => setP((s) => ({ ...s, training_sessions_goal: Math.min(7, Math.max(1, Number(e.target.value) || 1)) }))}
              className="mt-1"
            />
            <div className="text-[11px] text-muted-foreground mt-1">Objectif hebdomadaire : 1 à 7 séances</div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl glass-card p-6 mb-4">
        <h2 className="font-display text-lg font-semibold mb-4">Objectifs quotidiens</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <Label className="text-xs">Calories (kcal)</Label>
            <Input type="number" value={p.daily_calorie_goal ?? ""} onChange={num("daily_calorie_goal")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Protéines (g)</Label>
            <Input type="number" value={p.daily_protein_goal ?? ""} onChange={num("daily_protein_goal")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Eau (ml)</Label>
            <Input type="number" value={p.daily_water_ml_goal ?? ""} onChange={num("daily_water_ml_goal")} className="mt-1" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {hydrated && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {saving ? "Sauvegarde…" : "Enregistré automatiquement"}
          </span>
        )}
        <Button variant="outline" onClick={async () => { await signOut(); navigate({ to: "/login", search: { next: "/" } }); }} className="rounded-xl">
          <LogOut className="size-4 mr-1" />Se déconnecter
        </Button>
      </div>
    </div>
  );
}
