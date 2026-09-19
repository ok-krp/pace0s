alter table public.billing_events
  add column if not exists status text not null default 'processed'
    check (status in ('processing','processed','failed'));

alter table public.billing_events
  add column if not exists last_error text;
