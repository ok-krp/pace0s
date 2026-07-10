import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut, Save, User as UserIcon } from "lucide-react";
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
};

function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [p, setP] = useState<Profile>({
    display_name: "", age: null, sex: null, height_cm: null,
    weight_kg: null, weight_goal_kg: null,
    daily_calorie_goal: 2300, daily_protein_goal: 140, daily_water_ml_goal: 2500,
    training_goal: "hypertrophy",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) { navigate({ to: "/login" }); return; }
    supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle().then(({ data }) => {
      if (data) setP({ ...p, ...data } as Profile);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({ ...p, user_id: user.id, email: user.email }, { onConflict: "user_id" });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profil sauvegardé");
  };

  const num = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setP((s) => ({ ...s, [k]: e.target.value === "" ? null : Number(e.target.value) }));

  return (
    <div>
      <PageHeader title="Mon profil" subtitle="Vos infos guident l'IA et vos objectifs." />

      <div className="rounded-2xl bg-card border border-border p-6 shadow-[var(--shadow-soft)] mb-4">
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
        </div>
      </div>

      <div className="rounded-2xl bg-card border border-border p-6 shadow-[var(--shadow-soft)] mb-4">
        <div className="font-display text-lg font-semibold mb-4">Objectifs quotidiens</div>
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

      <div className="flex gap-2">
        <Button onClick={save} disabled={saving} className="rounded-xl"><Save className="size-4 mr-1" />{saving ? "…" : "Sauvegarder"}</Button>
        <Button variant="outline" onClick={async () => { await signOut(); navigate({ to: "/login" }); }} className="rounded-xl">
          <LogOut className="size-4 mr-1" />Se déconnecter
        </Button>
      </div>
    </div>
  );
}
