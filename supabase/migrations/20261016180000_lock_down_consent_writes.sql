-- Consent records are audit evidence, not client-editable preferences.
-- Only authenticated server handlers may write after verifying the session and binding user_id.
-- This migration is additive and must be applied separately; no production migration is run by CI.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.consent_records FROM authenticated;
GRANT SELECT ON TABLE public.consent_records TO authenticated;
GRANT INSERT ON TABLE public.consent_records TO service_role;

DROP POLICY IF EXISTS consent_records_insert_own ON public.consent_records;

-- Keep consent acceptance/version records server-controlled as well.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.legal_consent FROM authenticated;
GRANT SELECT ON TABLE public.legal_consent TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.legal_consent TO service_role;

DROP POLICY IF EXISTS "Users can create their own legal consent" ON public.legal_consent;
DROP POLICY IF EXISTS "Users can update their own legal consent" ON public.legal_consent;
DROP POLICY IF EXISTS "Users can delete their own legal consent" ON public.legal_consent;
