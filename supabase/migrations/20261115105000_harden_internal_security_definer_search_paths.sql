-- Empty search_path for internal SECURITY DEFINER functions.
-- Their bodies already schema-qualify every application relation.
alter function public.delete_temporary_workout_after_finish() set search_path = '';
alter function public.delete_user_data(uuid) set search_path = '';
alter function public.handle_new_user() set search_path = '';
alter function public.prevent_audit_log_mutation() set search_path = '';
alter function public.set_deletion_request_updated_at() set search_path = '';
alter function public.sync_sport_user_state() set search_path = '';
alter function public.touch_ai_provider_secret_updated_at() set search_path = '';
