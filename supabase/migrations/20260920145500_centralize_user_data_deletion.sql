create or replace function public.delete_user_data(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.ai_messages where user_id = p_user_id;
  delete from public.development_tasks where user_id = p_user_id;
  delete from public.ai_action_log where user_id = p_user_id;
  delete from public.ai_conversations where user_id = p_user_id;
  delete from public.ai_preferences where user_id = p_user_id;
  delete from public.ai_provider_secrets where user_id = p_user_id;
  delete from public.ai_tool_idempotency where user_id = p_user_id;

  delete from public.sport_workout_sets
  where workout_exercise_id in (
    select we.id
    from public.sport_workout_exercises we
    join public.sport_workout_sessions s on s.id = we.session_id
    where s.user_id = p_user_id
  );

  delete from public.sport_workout_exercises
  where session_id in (
    select id from public.sport_workout_sessions where user_id = p_user_id
  );

  delete from public.sport_progression_targets where user_id = p_user_id;
  delete from public.sport_workout_sessions where user_id = p_user_id;

  delete from public.sport_program_items
  where program_id in (
    select id from public.sport_programs where user_id = p_user_id
  );

  delete from public.sport_programs where user_id = p_user_id;
  delete from public.sport_exercises where user_id = p_user_id;

  delete from public.food_log where user_id = p_user_id;
  delete from public.food_scans where user_id = p_user_id;
  delete from public.health_samples where user_id = p_user_id;
  delete from public.notification_log where user_id = p_user_id;
  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.reminder_debug_log where user_id = p_user_id;
  delete from public.reminder_settings where user_id = p_user_id;
  delete from public.user_state where user_id = p_user_id;

  delete from public.billing_subscriptions where user_id = p_user_id;
  delete from public.billing_trials where user_id = p_user_id;
  delete from public.billing_customers where user_id = p_user_id;

  delete from public.legal_consent where user_id = p_user_id;
  delete from public.consent_records where user_id = p_user_id;
  delete from public.profiles where user_id = p_user_id or id = p_user_id;
end;
$$;

revoke all on function public.delete_user_data(uuid) from public, anon, authenticated;
