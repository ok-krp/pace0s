-- Keep Nutrition meal labels canonical so Coach mutations cannot create near-duplicate categories.
create or replace function public.canonicalize_nutrition_meal(p_meal text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v text := lower(trim(coalesce(p_meal, '')));
begin
  v := replace(v, '_', ' ');
  if v in ('petit déjeuner', 'petit dejeuner', 'petit-déjeuner', 'petit-dejeuner') then return 'Petit déjeuner'; end if;
  if v in ('déjeuner', 'dejeuner') then return 'Déjeuner'; end if;
  if v in ('goûter', 'gouter') then return 'Goûter'; end if;
  if v in ('dîner', 'diner') then return 'Dîner'; end if;
  if v in ('collation', 'snack') then return 'Collation'; end if;
  return trim(p_meal);
end;
$$;

create or replace function public.canonicalize_food_log_meal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.meal := public.canonicalize_nutrition_meal(new.meal);
  return new;
end;
$$;

drop trigger if exists canonicalize_food_log_meal on public.food_log;
create trigger canonicalize_food_log_meal
before insert or update of meal on public.food_log
for each row execute function public.canonicalize_food_log_meal();

update public.food_log
set meal = public.canonicalize_nutrition_meal(meal)
where meal is not null
  and meal <> public.canonicalize_nutrition_meal(meal);
