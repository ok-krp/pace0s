
ALTER TABLE public.profiles           ADD CONSTRAINT profiles_user_id_fkey           FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.food_log           ADD CONSTRAINT food_log_user_id_fkey           FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.food_scans         ADD CONSTRAINT food_scans_user_id_fkey         FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.health_samples     ADD CONSTRAINT health_samples_user_id_fkey     FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.legal_consent      ADD CONSTRAINT legal_consent_user_id_fkey      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.notification_log   ADD CONSTRAINT notification_log_user_id_fkey   FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.reminder_settings  ADD CONSTRAINT reminder_settings_user_id_fkey  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.reminder_debug_log ADD CONSTRAINT reminder_debug_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.user_state         ADD CONSTRAINT user_state_user_id_fkey         FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
