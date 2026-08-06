-- Sync Cloud automatique et temps réel : identifiant de l'appareil ayant écrit
-- la ligne (pour ignorer l'écho de nos propres écritures côté client), et
-- activation de Supabase Realtime sur user_state pour la sync multi-appareils.

ALTER TABLE public.user_state ADD COLUMN IF NOT EXISTS updated_by text;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.user_state;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

ALTER TABLE public.user_state REPLICA IDENTITY FULL;
