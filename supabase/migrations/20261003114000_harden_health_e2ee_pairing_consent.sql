-- Enforce health cloud-sync consent at the database boundary for pairing flows.
-- Pairing RPCs are SECURITY DEFINER and therefore bypass the table RLS that already
-- protects direct key-envelope writes. The trigger keeps that privileged path aligned
-- with the same consent contract.

create or replace function public.enforce_health_e2ee_pairing_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.has_current_health_e2ee_consent() then
    raise exception 'Health E2EE cloud-sync consent is required';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_health_e2ee_pairing_consent() from public;
grant execute on function public.enforce_health_e2ee_pairing_consent() to authenticated;

drop trigger if exists health_e2ee_pairing_consent_guard
  on public.health_e2ee_pairing_sessions;

create trigger health_e2ee_pairing_consent_guard
before insert or update on public.health_e2ee_pairing_sessions
for each row
execute function public.enforce_health_e2ee_pairing_consent();

drop trigger if exists health_e2ee_pairing_envelope_consent_guard
  on public.health_e2ee_key_envelopes;

create trigger health_e2ee_pairing_envelope_consent_guard
before insert on public.health_e2ee_key_envelopes
for each row
execute function public.enforce_health_e2ee_pairing_consent();
