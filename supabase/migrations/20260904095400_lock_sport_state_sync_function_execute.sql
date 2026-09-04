revoke execute on function public.sync_sport_user_state() from public, anon, authenticated;
comment on function public.sync_sport_user_state() is 'Internal trigger-only compatibility sync from legacy Sport user_state to normalized Sport tables.';
