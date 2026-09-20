-- Preview repair: the remote migration history already contains
-- 20260903081045_guard_food_log_ai_burst_duplicates, but that migration had
-- been recorded without the trigger function being present in the Preview DB.
-- Reassert the function so Preview matches the source-controlled migration.

create or replace function public.guard_food_log_ai_burst_duplicates()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  fingerprint text;
  duplicate_exists boolean;
begin
  if coalesce(new.source, '') <> 'coach_ai' then
    return new;
  end if;

  fingerprint := concat_ws('|',
    new.user_id::text,
    new.log_date::text,
    coalesce(new.meal, ''),
    coalesce(new.name, ''),
    coalesce(new.kcal, 0)::text,
    coalesce(new.protein_g, 0)::text,
    coalesce(new.carbs_g, 0)::text,
    coalesce(new.fat_g, 0)::text,
    coalesce(new.fiber_g, 0)::text,
    coalesce(new.sugar_g, 0)::text,
    coalesce(new.sodium_mg, 0)::text
  );

  perform pg_advisory_xact_lock(hashtextextended(fingerprint, 0));

  select exists (
    select 1 from public.food_log f
    where f.user_id = new.user_id
      and f.log_date = new.log_date
      and f.meal = new.meal
      and f.name = new.name
      and f.kcal = new.kcal
      and f.protein_g = new.protein_g
      and f.carbs_g = new.carbs_g
      and f.fat_g = new.fat_g
      and coalesce(f.fiber_g, 0) = coalesce(new.fiber_g, 0)
      and coalesce(f.sugar_g, 0) = coalesce(new.sugar_g, 0)
      and coalesce(f.sodium_mg, 0) = coalesce(new.sodium_mg, 0)
      and f.source = 'coach_ai'
      and f.created_at >= now() - interval '1 hour'
  ) into duplicate_exists;

  if duplicate_exists then
    return null;
  end if;

  return new;
end;
$$;
