-- Save the legal document acceptance and all granular decisions atomically.
-- A failed insert must never leave a stale AI/health grant authoritative.
create or replace function public.save_legal_consent_atomic(
  p_user_id uuid,
  p_region text,
  p_eula_version text,
  p_privacy_version text,
  p_ip_country text,
  p_opts jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Authenticated account mismatch';
  end if;
  if jsonb_typeof(p_opts) <> 'object' then
    raise exception 'Invalid consent options';
  end if;

  insert into public.legal_consent (
    user_id, region, eula_version, privacy_version, ip_country, consented_at, opts
  )
  values (
    p_user_id, p_region, p_eula_version, p_privacy_version, p_ip_country, now(), p_opts
  )
  on conflict (user_id, eula_version, privacy_version) do update
    set region = excluded.region,
        ip_country = excluded.ip_country,
        consented_at = now(),
        opts = excluded.opts;

  insert into public.consent_records (
    user_id, consent_type, granted, legal_version, policy_version
  )
  select
    p_user_id,
    decisions.consent_type,
    coalesce((p_opts ->> decisions.consent_type)::boolean, false),
    p_eula_version,
    p_privacy_version
  from (values
    ('health_data'),
    ('health_cloud_sync'),
    ('financial_data'),
    ('ai_processing'),
    ('marketing')
  ) as decisions(consent_type);

  return true;
end;
$$;

revoke all on function public.save_legal_consent_atomic(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.save_legal_consent_atomic(uuid, text, text, text, text, jsonb) to authenticated;
