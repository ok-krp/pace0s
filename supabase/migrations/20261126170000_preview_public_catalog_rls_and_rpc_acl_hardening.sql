-- Harden public nutrition reference catalogs and explicitly revoke anonymous execution
-- on user-scoped Health RPCs and the trigger-only workout cleanup function.

ALTER TABLE public.nutrition_data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_data_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_reference_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_reference_sources FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.nutrition_data_sources, public.nutrition_reference_sources FROM anon;
GRANT SELECT ON TABLE public.nutrition_data_sources, public.nutrition_reference_sources TO authenticated;
GRANT SELECT ON TABLE public.nutrition_data_sources, public.nutrition_reference_sources TO service_role;

DROP POLICY IF EXISTS nutrition_data_sources_read_authenticated ON public.nutrition_data_sources;
CREATE POLICY nutrition_data_sources_read_authenticated
  ON public.nutrition_data_sources FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS nutrition_reference_sources_read_authenticated ON public.nutrition_reference_sources;
CREATE POLICY nutrition_reference_sources_read_authenticated
  ON public.nutrition_reference_sources FOR SELECT TO authenticated USING (true);

REVOKE ALL ON FUNCTION public.delete_temporary_workout_after_finish() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.migrate_health_legacy_chunk(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.rotate_health_e2ee_key(integer, uuid) FROM anon;

ALTER FUNCTION public.nutrition_macro_kcal_consistent(numeric, numeric, numeric, numeric)
  SET search_path = pg_catalog;

NOTIFY pgrst, 'reload schema';
