-- PaceOS cross-device sync metadata.
-- Adds the origin device marker used by the automatic sync engine.
ALTER TABLE public.user_state
  ADD COLUMN IF NOT EXISTS updated_by text;

CREATE INDEX IF NOT EXISTS user_state_user_updated_idx
  ON public.user_state(user_id, updated_at DESC);

COMMENT ON COLUMN public.user_state.updated_by IS
  'Opaque per-installation device/tab identifier used only to prevent sync echo loops.';
