-- Align the migrated target with the canonical source schema.
-- These columns existed only on the target and were absent from the source schema
-- and generated application database types.
alter table public.nutrition_reference_foods
  drop column if exists created_at;

alter table public.nutrition_reference_foods
  drop column if exists updated_at;

alter table public.profiles
  drop column if exists created_at;
