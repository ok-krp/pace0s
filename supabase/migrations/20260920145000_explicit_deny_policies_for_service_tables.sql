drop policy if exists ai_provider_secrets_deny_client on public.ai_provider_secrets;
create policy ai_provider_secrets_deny_client on public.ai_provider_secrets for all to anon, authenticated using (false) with check (false);

drop policy if exists ai_tool_idempotency_deny_client on public.ai_tool_idempotency;
create policy ai_tool_idempotency_deny_client on public.ai_tool_idempotency for all to anon, authenticated using (false) with check (false);

drop policy if exists audit_log_deny_client on public.audit_log;
create policy audit_log_deny_client on public.audit_log for all to anon, authenticated using (false) with check (false);

drop policy if exists billing_events_deny_client on public.billing_events;
create policy billing_events_deny_client on public.billing_events for all to anon, authenticated using (false) with check (false);
