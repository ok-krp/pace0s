-- Pace OS BYOK preferences schema
-- Additive and safe for existing installations.

ALTER TABLE public.ai_preferences
  ADD COLUMN IF NOT EXISTS coach_ai_source text NOT NULL DEFAULT 'pace',
  ADD COLUMN IF NOT EXISTS coach_ai_provider text NOT NULL DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS coach_ai_model text NOT NULL DEFAULT 'gemini-3.7-flash',
  ADD COLUMN IF NOT EXISTS coach_ai_base_url text,
  ADD COLUMN IF NOT EXISTS build_ai_source text NOT NULL DEFAULT 'pace',
  ADD COLUMN IF NOT EXISTS build_ai_provider text NOT NULL DEFAULT 'gemini',
  ADD COLUMN IF NOT EXISTS build_ai_model text NOT NULL DEFAULT 'gemini-3.7-flash',
  ADD COLUMN IF NOT EXISTS build_ai_base_url text;

COMMENT ON COLUMN public.ai_preferences.coach_ai_source IS 'AI source for Coach: pace or byok';
COMMENT ON COLUMN public.ai_preferences.coach_ai_provider IS 'BYOK provider selected for Coach';
COMMENT ON COLUMN public.ai_preferences.coach_ai_model IS 'Model selected for Coach';
COMMENT ON COLUMN public.ai_preferences.coach_ai_base_url IS 'Custom OpenAI-compatible base URL for Coach';
COMMENT ON COLUMN public.ai_preferences.build_ai_source IS 'AI source for BUILD: pace or byok';
COMMENT ON COLUMN public.ai_preferences.build_ai_provider IS 'BYOK provider selected for BUILD';
COMMENT ON COLUMN public.ai_preferences.build_ai_model IS 'Model selected for BUILD';
COMMENT ON COLUMN public.ai_preferences.build_ai_base_url IS 'Custom OpenAI-compatible base URL for BUILD';
