-- Keep the production hardening in source control so Supabase migration history
-- and the repository remain aligned.
alter function public.guard_food_log_ai_burst_duplicates() set search_path = public;

alter policy ai_tool_idempotency_service_only
  on public.ai_tool_idempotency
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop index if exists public.ai_tool_idempotency_user_idx;
