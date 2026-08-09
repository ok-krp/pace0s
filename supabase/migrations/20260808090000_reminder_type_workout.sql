-- Ajoute le type de rappel "workout" (entraînement), demandé mais absent de la
-- liste initiale (hydration, sleep, protein, daily_summary, inactivity).
ALTER TABLE public.reminder_settings DROP CONSTRAINT IF EXISTS reminder_settings_type_check;
ALTER TABLE public.reminder_settings ADD CONSTRAINT reminder_settings_type_check
  CHECK (type IN ('hydration','sleep','protein','daily_summary','inactivity','workout'));
