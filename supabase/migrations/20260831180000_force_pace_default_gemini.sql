-- Pace OS: Gemini is the built-in/default AI provider.
-- Only normalize Pace-managed preferences; BYOK selections remain untouched.

UPDATE public.ai_preferences
SET
  coach_ai_source = 'pace',
  coach_ai_provider = 'gemini',
  coach_ai_model = 'gemini-3.7-flash',
  coach_ai_base_url = NULL
WHERE COALESCE(coach_ai_source, 'pace') = 'pace'
  AND (
    coach_ai_provider IS DISTINCT FROM 'gemini'
    OR coach_ai_model IS DISTINCT FROM 'gemini-3.7-flash'
    OR coach_ai_base_url IS NOT NULL
  );

UPDATE public.ai_preferences
SET
  build_ai_source = 'pace',
  build_ai_provider = 'gemini',
  build_ai_model = 'gemini-3.7-flash',
  build_ai_base_url = NULL
WHERE COALESCE(build_ai_source, 'pace') = 'pace'
  AND (
    build_ai_provider IS DISTINCT FROM 'gemini'
    OR build_ai_model IS DISTINCT FROM 'gemini-3.7-flash'
    OR build_ai_base_url IS NOT NULL
  );

COMMENT ON COLUMN public.ai_preferences.coach_ai_provider IS 'Provider BYOK sélectionné pour Coach; la source Pace utilise toujours Google Gemini.';
COMMENT ON COLUMN public.ai_preferences.build_ai_provider IS 'Provider BYOK sélectionné pour BUILD; la source Pace utilise toujours Google Gemini.';
