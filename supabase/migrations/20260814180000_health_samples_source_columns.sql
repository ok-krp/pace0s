-- Additive migration for watch / Health Connect provenance and deduplication.
-- Safe for existing data: no rows are deleted or rewritten.

ALTER TABLE public.health_samples
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS health_samples_user_external_id_idx
  ON public.health_samples(user_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS health_samples_user_source_idx
  ON public.health_samples(user_id, source, source_id)
  WHERE source_id IS NOT NULL;

-- Keep the existing table permissive for all health types already used by Pace
-- and the additive Health Connect / watch metrics.
ALTER TABLE public.health_samples
  DROP CONSTRAINT IF EXISTS health_samples_type_check;

ALTER TABLE public.health_samples
  ADD CONSTRAINT health_samples_type_check
  CHECK (type IN (
    'steps',
    'kcal_active',
    'kcal_total',
    'heart_rate',
    'resting_heart_rate',
    'distance_m',
    'sleep_min',
    'exercise_duration_min',
    'weight_kg',
    'oxygen_saturation',
    'temperature_c',
    'cadence_rpm',
    'power_w'
  ));
