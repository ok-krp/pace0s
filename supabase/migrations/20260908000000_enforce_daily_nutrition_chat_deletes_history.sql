create or replace function public.enforce_daily_nutrition_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agent_type = 'coach' and new.title like 'Nutrition du jour — %' then
    new.is_ephemeral := true;
    new.is_archived := false;
    delete from public.ai_conversations
      where user_id = new.user_id
        and agent_type = 'coach'
        and title like 'Nutrition du jour — %'
        and id <> new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_daily_nutrition_chat() from public, anon, authenticated;

delete from public.ai_conversations
where agent_type = 'coach'
  and title like 'Nutrition du jour — %';
