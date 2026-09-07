-- Allow users to choose browser-local AI independently from Cloud/Pace and BYOK.
ALTER TABLE public.ai_preferences DROP CONSTRAINT IF EXISTS ai_preferences_coach_ai_source_check;
ALTER TABLE public.ai_preferences DROP CONSTRAINT IF EXISTS ai_preferences_build_ai_source_check;
ALTER TABLE public.ai_preferences ADD CONSTRAINT ai_preferences_coach_ai_source_check CHECK (coach_ai_source IN ('pace','byok','local'));
ALTER TABLE public.ai_preferences ADD CONSTRAINT ai_preferences_build_ai_source_check CHECK (build_ai_source IN ('pace','byok','local'));
COMMENT ON COLUMN public.ai_preferences.coach_ai_source IS 'AI source for Coach: pace, byok, or local';
COMMENT ON COLUMN public.ai_preferences.build_ai_source IS 'AI source for BUILD: pace, byok, or local';
