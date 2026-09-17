-- Keep production schemas compatible with the profile reconciliation backfill.
-- These columns are legacy compatibility fields used by older/preview schemas.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_by text;
