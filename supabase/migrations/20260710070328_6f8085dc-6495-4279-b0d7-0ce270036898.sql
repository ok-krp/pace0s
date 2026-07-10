CREATE TABLE public.legal_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  region text NOT NULL CHECK (region IN ('EU', 'CA-US', 'BR', 'UK', 'CH', 'OTHER')),
  eula_version text NOT NULL,
  privacy_version text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip_country text,
  opts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, eula_version, privacy_version)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_consent TO authenticated;
GRANT ALL ON public.legal_consent TO service_role;

ALTER TABLE public.legal_consent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own legal consent"
ON public.legal_consent
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own legal consent"
ON public.legal_consent
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own legal consent"
ON public.legal_consent
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own legal consent"
ON public.legal_consent
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_legal_consent_updated_at
BEFORE UPDATE ON public.legal_consent
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();