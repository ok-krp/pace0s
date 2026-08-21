import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { applyRemoteWrite, useLocalState } from "@/lib/storage";
import { useAuth } from "@/hooks/use-auth";

export type UserGoals = {
  kcal: number;
  protein: number;
  waterMl: number;
  weightKg: number | null;
  weightGoalKg: number | null;
};

const DEFAULT: UserGoals = { kcal: 2300, protein: 140, waterMl: 2500, weightKg: null, weightGoalKg: null };

export function useUserGoals(): UserGoals {
  const { user } = useAuth();
  const [cached] = useLocalState<UserGoals>("pace.user.goals", DEFAULT);
  const [goals, setGoals] = useState<UserGoals>(cached);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("daily_calorie_goal,daily_protein_goal,daily_water_ml_goal,weight_kg,weight_goal_kg")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const next: UserGoals = {
          kcal: data.daily_calorie_goal ?? DEFAULT.kcal,
          protein: data.daily_protein_goal ?? DEFAULT.protein,
          waterMl: data.daily_water_ml_goal ?? DEFAULT.waterMl,
          weightKg: data.weight_kg ?? null,
          weightGoalKg: data.weight_goal_kg ?? null,
        };
        setGoals(next);
        // This is a server hydration of a derived cache, not a user mutation.
        applyRemoteWrite("pace.user.goals", next);
      });
  }, [user]);

  return goals;
}
