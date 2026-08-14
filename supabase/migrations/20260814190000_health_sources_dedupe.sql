-- Additive health-source metadata and broader Health Connect sample types.
-- No historical rows are deleted or rewritten.
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

ALTER TABLE public.health_samples
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS health_samples_user_type_ts_idx
  ON public.health_samples(user_id, type, ts DESC);

CREATE INDEX IF NOT EXISTS health_samples_source_external_idx
  ON public.health_samples(user_id, source, external_id)
  WHERE external_id IS NOT NULL;

-- Do not create a unique constraint on legacy rows: older imports do not have external IDs.
