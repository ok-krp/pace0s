-- Extend the existing health_samples table without touching or rewriting historical data.
-- Existing rows remain valid; the new values are additive.
ALTER TABLE public.health_samples
  DROP CONSTRAINT IF EXISTS health_samples_type_check;

ALTER TABLE public.health_samples
  ADD CONSTRAINT health_samples_type_check
  CHECK (type IN (
    'steps',
    'kcal_active',
    'heart_rate',
    'distance_m',
    'sleep_min',
    'oxygen_saturation',
    'temperature_c',
    'cadence_rpm',
    'power_w'
  ));

CREATE INDEX IF NOT EXISTS health_samples_watch_type_ts_idx
  ON public.health_samples(user_id, type, ts DESC);
