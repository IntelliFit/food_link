with
  historical_items as (
    select
      trim(item ->> 'name') as raw_name,
      lower(
        regexp_replace(
          regexp_replace(
            trim(coalesce(item ->> 'name', '')),
            '[\s\r\n\t]+',
            '',
            'g'
          ),
          '[()（）【】\[\]{}·,，。.!！:：;；''"`~\-_\/\\|]+',
          '',
          'g'
        )
      ) as normalized_name
    from
      public.user_food_records r
      cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) as item
    where
      r.record_time >= now() - interval '30 days'
      and coalesce(trim(item ->> 'name'), '') <> ''
  ),
  library_names as (
    select
      normalized_name
    from
      public.food_nutrition_library
    where
      is_active = true
    union
    select
      normalized_alias as normalized_name
    from
      public.food_nutrition_aliases
  ),
  missed as (
    select
      h.normalized_name,
      min(h.raw_name) as sample_raw_name,
      count(*) as hit_count
    from
      historical_items h
      left join library_names l on l.normalized_name = h.normalized_name
    where
      l.normalized_name is null
    group by
      h.normalized_name
  )
select
  *
from
  missed
order by
  hit_count desc,
  normalized_name asc
limit
  1000;