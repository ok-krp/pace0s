create table if not exists public.nutrition_reference_foods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  brand text,
  kcal_per_100g numeric not null check (kcal_per_100g >= 0),
  protein_g_per_100g numeric not null default 0 check (protein_g_per_100g >= 0),
  carbs_g_per_100g numeric not null default 0 check (carbs_g_per_100g >= 0),
  fat_g_per_100g numeric not null default 0 check (fat_g_per_100g >= 0),
  fiber_g_per_100g numeric not null default 0 check (fiber_g_per_100g >= 0),
  sugar_g_per_100g numeric not null default 0 check (sugar_g_per_100g >= 0),
  sodium_mg_per_100g numeric not null default 0 check (sodium_mg_per_100g >= 0),
  source text not null default 'reference',
  confidence numeric not null default 0.8 check (confidence between 0 and 1),
  version text not null default '1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nutrition_reference_foods_name_idx on public.nutrition_reference_foods using gin (to_tsvector('simple', name));
alter table public.nutrition_reference_foods enable row level security;
drop policy if exists nutrition_reference_foods_read on public.nutrition_reference_foods;
create policy nutrition_reference_foods_read on public.nutrition_reference_foods for select to authenticated using (true);

create table if not exists public.nutrition_calibration_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dish_name text not null,
  input_items jsonb not null,
  original_result jsonb not null,
  corrected_result jsonb not null,
  status text not null default 'pending' check (status in ('pending','validated','rejected')),
  source text not null default 'user',
  created_at timestamptz not null default now(),
  validated_at timestamptz
);
alter table public.nutrition_calibration_feedback enable row level security;
drop policy if exists nutrition_calibration_feedback_own on public.nutrition_calibration_feedback;
create policy nutrition_calibration_feedback_own on public.nutrition_calibration_feedback for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
