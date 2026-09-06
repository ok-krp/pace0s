-- Repair only the derived Nutrition state. food_log remains the canonical source.
-- Existing date keys are preserved; only missing dates are backfilled.
-- Legacy metadata keys produced by an older state serializer are removed.

DO $$
DECLARE
  u record;
  d record;
  current_items jsonb;
  current_totals jsonb;
  day_items jsonb;
  day_total jsonb;
  state_id uuid;
BEGIN
  FOR u IN
    SELECT DISTINCT user_id
    FROM public.food_log
  LOOP
    SELECT id, COALESCE(value, '{}'::jsonb)
      INTO state_id, current_items
    FROM public.user_state
    WHERE user_id = u.user_id
      AND key = 'pace.nutrition.items'
    LIMIT 1;

    IF jsonb_typeof(current_items) <> 'object' THEN
      current_items := '{}'::jsonb;
    END IF;

    current_items := current_items
      - 'value'
      - 'version'
      - 'updatedAt'
      - 'mutationId';

    FOR d IN
      SELECT log_date::text AS day
      FROM public.food_log
      WHERE user_id = u.user_id
      GROUP BY log_date
      ORDER BY log_date
    LOOP
      IF NOT (current_items ? d.day) THEN
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'id', id,
              'name', name,
              'meal', meal,
              'kcal', COALESCE(kcal, 0),
              'p', COALESCE(protein_g, 0),
              'c', COALESCE(carbs_g, 0),
              'f', COALESCE(fat_g, 0),
              'fiber', COALESCE(fiber_g, 0),
              'sugar', COALESCE(sugar_g, 0),
              'sodium', COALESCE(sodium_mg, 0),
              'qty', 1
            ) ORDER BY created_at, id
          ),
          '[]'::jsonb
        )
        INTO day_items
        FROM public.food_log
        WHERE user_id = u.user_id
          AND log_date = d.day::date;

        current_items := jsonb_set(
          current_items,
          ARRAY[d.day],
          day_items,
          true
        );
      END IF;
    END LOOP;

    IF state_id IS NULL THEN
      INSERT INTO public.user_state (
        user_id, key, value, updated_at, updated_by
      ) VALUES (
        u.user_id,
        'pace.nutrition.items',
        current_items,
        now(),
        'data_repair'
      );
    ELSE
      UPDATE public.user_state
      SET value = current_items,
          updated_at = now(),
          updated_by = 'data_repair'
      WHERE id = state_id;
    END IF;

    SELECT COALESCE(value, '{}'::jsonb)
      INTO current_totals
    FROM public.user_state
    WHERE user_id = u.user_id
      AND key = 'pace.nutrition.totals'
    LIMIT 1;

    IF jsonb_typeof(current_totals) <> 'object' THEN
      current_totals := '{}'::jsonb;
    END IF;

    current_totals := current_totals
      - 'value'
      - 'version'
      - 'updatedAt'
      - 'mutationId';

    FOR d IN
      SELECT log_date::text AS day
      FROM public.food_log
      WHERE user_id = u.user_id
      GROUP BY log_date
      ORDER BY log_date
    LOOP
      IF NOT (current_totals ? d.day) THEN
        SELECT jsonb_build_object(
          'kcal', COALESCE(SUM(kcal), 0),
          'p', COALESCE(SUM(protein_g), 0),
          'c', COALESCE(SUM(carbs_g), 0),
          'f', COALESCE(SUM(fat_g), 0)
        )
        INTO day_total
        FROM public.food_log
        WHERE user_id = u.user_id
          AND log_date = d.day::date;

        current_totals := jsonb_set(
          current_totals,
          ARRAY[d.day],
          day_total,
          true
        );
      END IF;
    END LOOP;

    INSERT INTO public.user_state (
      user_id, key, value, updated_at, updated_by
    ) VALUES (
      u.user_id,
      'pace.nutrition.totals',
      current_totals,
      now(),
      'data_repair'
    )
    ON CONFLICT (user_id, key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by;
  END LOOP;
END $$;
