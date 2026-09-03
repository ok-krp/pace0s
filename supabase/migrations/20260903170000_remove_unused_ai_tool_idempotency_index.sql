-- Remove an index confirmed unused by Supabase's performance advisor.
drop index if exists public.ai_tool_idempotency_user_created_idx;
