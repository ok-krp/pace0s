revoke all on public.audit_log from anon, authenticated;
alter table public.audit_log enable row level security;

create unique index if not exists data_deletion_requests_one_pending
on public.data_deletion_requests (user_id)
where status in ('pending','processing');

comment on table public.audit_log is
'Server-side append-only compliance audit events. Client roles have no access; service-side code records events.';

comment on table public.consent_records is
'Immutable consent history. Revocation is represented by a later granted=false record.';
