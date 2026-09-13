-- Keep Supabase Preview self-contained: this table exists in the live
-- database but was historically created outside the repository migration set.
-- Create the canonical shape before any preview diff attempts to alter it.
create table if not exists public.nutrition_dish_references (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  aliases text[] not null default '{}',
  portion_g numeric not null check (portion_g > 0),
  kcal numeric not null check (kcal >= 0),
  protein_g numeric not null default 0 check (protein_g >= 0),
  carbs_g numeric not null default 0 check (carbs_g >= 0),
  fat_g numeric not null default 0 check (fat_g >= 0),
  fiber_g numeric not null default 0 check (fiber_g >= 0),
  sugar_g numeric not null default 0 check (sugar_g >= 0),
  sodium_mg numeric not null default 0 check (sodium_mg >= 0),
  source text not null,
  source_record_id text,
  confidence numeric not null default 0.9 check (confidence between 0 and 1),
  version text not null default '1',
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  source_key text,
  source_verified boolean not null default false
);

create index if not exists nutrition_dish_references_aliases_idx
  on public.nutrition_dish_references using gin (aliases);

alter table public.nutrition_dish_references enable row level security;
drop policy if exists nutrition_dish_references_read on public.nutrition_dish_references;
create policy nutrition_dish_references_read
  on public.nutrition_dish_references
  for select to authenticated using (true);
