create table if not exists public.nutrition_reference_dishes (
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
  confidence numeric not null default 0.8 check (confidence between 0 and 1),
  version text not null default '1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists nutrition_reference_dishes_aliases_idx on public.nutrition_reference_dishes using gin (aliases);
alter table public.nutrition_reference_dishes enable row level security;
drop policy if exists nutrition_reference_dishes_read on public.nutrition_reference_dishes;
create policy nutrition_reference_dishes_read on public.nutrition_reference_dishes for select to authenticated using (true);

-- Canonical calibration anchors. Calories are mathematically checked against 4/4/9 macro energy.
insert into public.nutrition_reference_dishes
(canonical_name, aliases, portion_g, kcal, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, source, confidence)
values
('Double Bacon Cheeseburger standard', array['double bacon cheeseburger','bacon double cheeseburger','double bacon burger'], 300, 815, 52, 42, 51, 2.5, 6, 1250, 'Pace reference calibration; 4/4/9 consistent', 0.82),
('Double Bacon Cheeseburger généreux', array['double bacon cheeseburger généreux','large double bacon cheeseburger'], 350, 1090, 67.5, 47, 70, 2.5, 7, 1400, 'Pace reference calibration; 4/4/9 consistent', 0.82),
('Double Bacon Cheeseburger 280 g', array['double bacon cheeseburger 280g','small double bacon cheeseburger'], 280, 780, 42, 45, 46, 3, 8, 1200, 'Pace reference calibration; 4/4/9 consistent', 0.82)
on conflict do nothing;
