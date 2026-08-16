-- Add the weekly workout target used by the profile and sport dashboard.
-- Safe to run on existing databases: the column is added only when missing.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS training_sessions_goal integer NOT NULL DEFAULT 3;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_training_sessions_goal_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_training_sessions_goal_check
  CHECK (training_sessions_goal BETWEEN 1 AND 7);

NOTIFY pgrst, 'reload schema';
