import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { applyRemoteWrite, useLocalState } from "@/lib/storage";
import { PROFILE_REMOTE_EVENT, type RemoteProfile } from "@/hooks/use-profile-realtime";
import { useAuth } from "@/hooks/use-auth";

export type UserGoals = {
  kcal: number;
  protein: number;
  waterMl: number;
  weightKg: number | null;
  weightGoalKg: number | null;
};

const DEFAULT: UserGoals = { kcal: 2300, protein: 140, waterMl: 2500, weightKg: null, weightGoalKg: null };

function goalsFromProfile(data: Partial<RemoteProfile>): UserGoals {
  return {
    kcal: Number(data.daily_calorie_goal ?? DEFAULT.kcal),
    protein: Number(data.daily_protein_goal ?? DEFAULT.protein),
    waterMl: Number(data.daily_water_ml_goal ?? DEFAULT.waterMl),
    weightKg: data.weight_kg == null ? null : Number(data.weight_kg),
    weightGoalKg: data.weight_goal_kg == null ? null : Number(data.weight_goal_kg),
  };
}

export function useUserGoals(): UserGoals {
  const { user } = useAuth();
  const [cached] = useLocalState<UserGoals>("pace.user.goals", DEFAULT);
  const [goals, setGoals] = useState<UserGoals>(cached);

  useEffect(() => {
    if (!user) return;

    const applyProfile = (data: Partial<RemoteProfile>) => {
      const next = goalsFromProfile(data);
      setGoals(next);
      applyRemoteWrite("pace.user.goals", next);
    };

    supabase
      .from("profiles")
      .select("daily_calorie_goal,daily_protein_goal,daily_water_ml_goal,weight_kg,weight_goal_kg")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) applyProfile(data as Partial<RemoteProfile>);
      });

    const onRemoteProfile = (event: Event) => {
      const row = (event as CustomEvent<RemoteProfile>).detail;
      if (!row || row.user_id !== user.id) return;
      applyProfile(row);
    };
    window.addEventListener(PROFILE_REMOTE_EVENT, onRemoteProfile);
    return () => window.removeEventListener(PROFILE_REMOTE_EVENT, onRemoteProfile);
  }, [user]);

  return goals;
}
