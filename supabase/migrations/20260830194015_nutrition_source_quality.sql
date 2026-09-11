create table if not exists public.nutrition_data_sources (
  id text primary key,
  name text not null,
  authority text not null,
  dataset_version text not null,
  source_url text not null,
  license_note text,
  priority integer not null default 100,
  allowed_for_production boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.nutrition_data_sources (id,name,authority,dataset_version,source_url,license_note,priority)
values
 ('anses-ciqual-2025','Table Ciqual 2025','ANSES','2025','https://ciqual.anses.fr/','Licence Ouverte; source/version must be retained',10),
 ('usda-fdc-foundation-2026-04','FoodData Central Foundation Foods','USDA Agricultural Research Service','April 2026','https://fdc.nal.usda.gov/','USDA FoodData Central download/API data',20),
 ('usda-fndds-2021-2023','FoodData Central FNDDS 2021-2023','USDA Agricultural Research Service','2021-2023','https://fdc.nal.usda.gov/','USDA survey food and portion data',30)
on conflict (id) do update set dataset_version=excluded.dataset_version, source_url=excluded.source_url, license_note=excluded.license_note, priority=excluded.priority;

alter table public.nutrition_reference_foods add column if not exists source_id text references public.nutrition_data_sources(id);
alter table public.nutrition_reference_foods add column if not exists source_record_id text;
alter table public.nutrition_reference_foods add column if not exists verified_at timestamptz;
alter table public.nutrition_reference_foods add column if not exists aliases text[] not null default '{}';

create table if not exists public.nutrition_canonical_dishes (
 id uuid primary key default gen_random_uuid(),
 canonical_name text not null,
 aliases text[] not null default '{}',
 cuisine text,
 serving_grams numeric check (serving_grams > 0),
 kcal numeric not null check (kcal >= 0),
 protein_g numeric not null default 0 check (protein_g >= 0),
 carbs_g numeric not null default 0 check (carbs_g >= 0),
 fat_g numeric not null default 0 check (fat_g >= 0),
 fiber_g numeric not null default 0 check (fiber_g >= 0),
 sugar_g numeric not null default 0 check (sugar_g >= 0),
 sodium_mg numeric not null default 0 check (sodium_mg >= 0),
 source_id text not null references public.nutrition_data_sources(id),
 source_record_id text,
 confidence numeric not null default 0.9 check (confidence between 0 and 1),
 version text not null,
 verified_at timestamptz not null default now(),
 unique(canonical_name, serving_grams, source_id, version)
);

create index if not exists nutrition_canonical_dishes_name_idx on public.nutrition_canonical_dishes using gin (to_tsvector('simple', canonical_name));

alter table public.nutrition_canonical_dishes enable row level security;
drop policy if exists nutrition_canonical_dishes_read on public.nutrition_canonical_dishes;
create policy nutrition_canonical_dishes_read on public.nutrition_canonical_dishes for select to authenticated using (true);

-- Production quality gate: reject a canonical result whose energy is materially inconsistent with its macros.
create or replace function public.nutrition_macro_kcal_consistent(p_kcal numeric,p_protein numeric,p_carbs numeric,p_fat numeric)
returns boolean language sql immutable as $$
 select case when p_kcal <= 0 then true else abs((4*p_protein + 4*p_carbs + 9*p_fat)-p_kcal)/p_kcal <= 0.10 end;
$$;

alter table public.nutrition_canonical_dishes drop constraint if exists nutrition_canonical_dishes_macro_energy_check;
alter table public.nutrition_canonical_dishes add constraint nutrition_canonical_dishes_macro_energy_check check (public.nutrition_macro_kcal_consistent(kcal,protein_g,carbs_g,fat_g));
