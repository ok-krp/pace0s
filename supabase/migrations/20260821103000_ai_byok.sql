-- PACE AI — BYOK provider configuration
-- API secrets are encrypted by the application server before storage.
-- IMPORTANT: encrypted_api_key is intentionally NOT readable by authenticated clients.

ALTER TABLE public.ai_preferences
  ADD COLUMN IF NOT EXISTS coach_ai_source text NOT NULL DEFAULT 'pace'
    CHECK (coach_ai_source IN ('pace', 'byok')),
  ADD COLUMN IF NOT EXISTS coach_ai_provider text NOT NULL DEFAULT 'gemini'
    CHECK (coach_ai_provider IN ('openai', 'anthropic', 'gemini', 'openrouter', 'custom')),
  ADD COLUMN IF NOT EXISTS coach_ai_model text NOT NULL DEFAULT 'gemini-2.5-flash',
  ADD COLUMN IF NOT EXISTS coach_ai_base_url text,
  ADD COLUMN IF NOT EXISTS build_ai_source text NOT NULL DEFAULT 'pace'
    CHECK (build_ai_source IN ('pace', 'byok')),
  ADD COLUMN IF NOT EXISTS build_ai_provider text NOT NULL DEFAULT 'gemini'
    CHECK (build_ai_provider IN ('openai', 'anthropic', 'gemini', 'openrouter', 'custom')),
  ADD COLUMN IF NOT EXISTS build_ai_model text NOT NULL DEFAULT 'gemini-2.5-flash',
  ADD COLUMN IF NOT EXISTS build_ai_base_url text;

CREATE TABLE IF NOT EXISTS public.ai_provider_secrets (
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('openai', 'anthropic', 'gemini', 'openrouter', 'custom')),
  encrypted_api_key text NOT NULL,
  key_last4 text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.ai_provider_secrets ENABLE ROW LEVEL SECURITY;

-- The server uses the Supabase service-role client after authenticating the user.
-- Never grant table access to the browser/authenticated role: otherwise the
-- ciphertext itself could be exfiltrated and attacked offline.
REVOKE ALL ON TABLE public.ai_provider_secrets FROM anon, authenticated;
GRANT ALL ON TABLE public.ai_provider_secrets TO service_role;

DROP POLICY IF EXISTS "Users manage own AI provider secrets" ON public.ai_provider_secrets;

CREATE OR REPLACE FUNCTION public.touch_ai_provider_secret_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_provider_secrets_touch ON public.ai_provider_secrets;
CREATE TRIGGER ai_provider_secrets_touch
  BEFORE UPDATE ON public.ai_provider_secrets
  FOR EACH ROW EXECUTE FUNCTION public.touch_ai_provider_secret_updated_at();

COMMENT ON TABLE public.ai_provider_secrets IS 'Encrypted BYOK API keys. Application server encryption key is required to decrypt; plaintext API keys are never stored.';
COMMENT ON COLUMN public.ai_provider_secrets.encrypted_api_key IS 'AES-256-GCM ciphertext produced server-side; never plaintext and never browser-readable.';
