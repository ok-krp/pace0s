-- PACE — Profile synchronization hardening
-- Profiles are a separate persisted surface from user_state, so they must
-- follow the same source/version rules instead of relying on a page-local save.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_by text;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.profiles REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.upsert_profile_if_newer(
  p_user_id uuid,
  p_profile jsonb,
  p_updated_at timestamptz,
  p_updated_by text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accepted boolean := false;
  effective_updated_at timestamptz := COALESCE(p_updated_at, now());
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.profiles (
    user_id,
    display_name,
    email,
    age,
    sex,
    height_cm,
    weight_kg,
    weight_goal_kg,
    body_fat_goal_pct,
    muscle_mass_goal_pct,
    daily_calorie_goal,
    daily_protein_goal,
    daily_water_ml_goal,
    training_goal,
    activity_level,
    training_sessions_goal,
    updated_at,
    updated_by
  )
  VALUES (
    p_user_id,
    p_profile->>'display_name',
    p_profile->>'email',
    NULLIF(p_profile->>'age', '')::integer,
    p_profile->>'sex',
    NULLIF(p_profile->>'height_cm', '')::numeric,
    NULLIF(p_profile->>'weight_kg', '')::numeric,
    NULLIF(p_profile->>'weight_goal_kg', '')::numeric,
    NULLIF(p_profile->>'body_fat_goal_pct', '')::numeric,
    NULLIF(p_profile->>'muscle_mass_goal_pct', '')::numeric,
    NULLIF(p_profile->>'daily_calorie_goal', '')::integer,
    NULLIF(p_profile->>'daily_protein_goal', '')::integer,
    NULLIF(p_profile->>'daily_water_ml_goal', '')::integer,
    p_profile->>'training_goal',
    p_profile->>'activity_level',
    COALESCE(NULLIF(p_profile->>'training_sessions_goal', '')::integer, 3),
    effective_updated_at,
    p_updated_by
  )
  ON CONFLICT (user_id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        email = EXCLUDED.email,
        age = EXCLUDED.age,
        sex = EXCLUDED.sex,
        height_cm = EXCLUDED.height_cm,
        weight_kg = EXCLUDED.weight_kg,
        weight_goal_kg = EXCLUDED.weight_goal_kg,
        body_fat_goal_pct = EXCLUDED.body_fat_goal_pct,
        muscle_mass_goal_pct = EXCLUDED.muscle_mass_goal_pct,
        daily_calorie_goal = EXCLUDED.daily_calorie_goal,
        daily_protein_goal = EXCLUDED.daily_protein_goal,
        daily_water_ml_goal = EXCLUDED.daily_water_ml_goal,
        training_goal = EXCLUDED.training_goal,
        activity_level = EXCLUDED.activity_level,
        training_sessions_goal = EXCLUDED.training_sessions_goal,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by
    WHERE public.profiles.updated_at IS NULL
       OR EXCLUDED.updated_at > public.profiles.updated_at
  RETURNING true INTO accepted;

  RETURN COALESCE(accepted, false);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_profile_if_newer(uuid, jsonb, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_profile_if_newer(uuid, jsonb, timestamptz, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
