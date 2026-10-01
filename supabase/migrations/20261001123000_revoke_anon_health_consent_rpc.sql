-- The health E2EE consent check is only meaningful for an authenticated user.
-- Keep it out of the anonymous RPC surface; auth.uid() is NULL for anon.
REVOKE EXECUTE ON FUNCTION public.has_current_health_e2ee_consent() FROM anon;
GRANT EXECUTE ON FUNCTION public.has_current_health_e2ee_consent() TO authenticated;
