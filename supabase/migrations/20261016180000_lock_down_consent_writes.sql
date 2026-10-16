-- Keep the legacy legal acceptance row server-controlled.
-- Native Flutter records granular choices directly, so preserve its authenticated INSERT
-- while forcing a server timestamp to prevent clients from pinning a grant in the future.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.legal_consent FROM authenticated;
GRANT SELECT ON TABLE public.legal_consent TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.legal_consent TO service_role;

DROP POLICY IF EXISTS "Users can create their own legal consent" ON public.legal_consent;
DROP POLICY IF EXISTS "Users can update their own legal consent" ON public.legal_consent;
DROP POLICY IF EXISTS "Users can delete their own legal consent" ON public.legal_consent;

-- Granular consent is still insertable by the authenticated native client, but never
-- mutable/deletable; created_at must be server-owned so an old grant cannot be made
-- permanently newer than a subsequent revocation.
REVOKE UPDATE, DELETE ON TABLE public.consent_records FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.consent_records TO authenticated;
GRANT INSERT ON TABLE public.consent_records TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_consent_timestamps()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'consent_records' THEN
    NEW.created_at := now();
  ELSIF TG_TABLE_NAME = 'legal_consent' THEN
    NEW.consented_at := now();
    IF TG_OP = 'INSERT' THEN
      NEW.created_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_consent_timestamps() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS consent_records_force_created_at ON public.consent_records;
CREATE TRIGGER consent_records_force_created_at
BEFORE INSERT ON public.consent_records
FOR EACH ROW EXECUTE FUNCTION public.enforce_consent_timestamps();

DROP TRIGGER IF EXISTS legal_consent_force_timestamps ON public.legal_consent;
CREATE TRIGGER legal_consent_force_timestamps
BEFORE INSERT OR UPDATE ON public.legal_consent
FOR EACH ROW EXECUTE FUNCTION public.enforce_consent_timestamps();
