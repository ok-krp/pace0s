create table if not exists public.nutrition_reference_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  publisher text not null,
  dataset_name text not null,
  dataset_version text not null,
  official_url text not null,
  license text,
  allowed_for_production boolean not null default false,
  last_verified_at timestamptz not null default now()
);
insert into public.nutrition_reference_sources (source_key,publisher,dataset_name,dataset_version,official_url,license,allowed_for_production) values
('usda_fdc_foundation','USDA ARS','FoodData Central Foundation Foods','2026-04','https://fdc.nal.usda.gov/','CC0 1.0',true),
('usda_fdc_fndds','USDA ARS','FoodData Central FNDDS 2021-2023','2024-10','https://fdc.nal.usda.gov/download-datasets/','CC0 1.0',true),
('usda_fdc_branded','USDA ARS','Global Branded Food Products Database','2026-08','https://fdc.nal.usda.gov/','CC0 1.0',true),
('anses_ciqual','ANSES','Ciqual 2025','2025','https://ciqual.anses.fr/','Official ANSES database',true)
on conflict (source_key) do update set dataset_version=excluded.dataset_version, official_url=excluded.official_url, allowed_for_production=excluded.allowed_for_production, last_verified_at=now();
alter table public.nutrition_dish_references add column if not exists source_key text;
alter table public.nutrition_dish_references add column if not exists source_verified boolean not null default false;
create index if not exists nutrition_dish_references_source_idx on public.nutrition_dish_references(source_key,source_verified);
update public.nutrition_dish_references set source_verified=false where source_key is null;
delete from public.nutrition_dish_references where source = 'USDA/FNDDS composite reference';
