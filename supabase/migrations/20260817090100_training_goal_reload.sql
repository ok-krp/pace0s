-- Ensure PostgREST sees profiles.training_sessions_goal after deployment.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS training_sessions_goal integer NOT NULL DEFAULT 3;
NOTIFY pgrst, 'reload schema';
