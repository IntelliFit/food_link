with historical_items as (
  select
    r.id as record_id,
    r.record_time,
    trim(item->>'name') as raw_name,
    lower(
      regexp_replace(
        regexp_replace(trim(coalesce(item->>'name', '')), '[\s\r\n\t]+', '', 'g'),
        '[()（）【】\[\]{}·,，。.!！:：;；''"`~\-_\/\\|]+',
        '',
        'g'
      )
    ) as normalized_name
  from public.user_food_records r
  cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) as item
  where r.record_time >= now() - interval '30 days'
    and coalesce(trim(item->>'name'), '') <> ''
),
library_names as (
  select normalized_name, canonical_name as matched_name, 'canonical' as match_source
  from public.food_nutrition_library
  where is_active = true

  union all

  select a.normalized_alias as normalized_name, f.canonical_name as matched_name, 'alias' as match_source
  from public.food_nutrition_aliases a
  join public.food_nutrition_library f on f.id = a.food_id
  where f.is_active = true
),
matched_items as (
  select
    h.*,
    case when exists (
      select 1
      from library_names l
      where l.normalized_name = h.normalized_name
    ) then 1 else 0 end as is_hit
  from historical_items h
),
distinct_names as (
  select
    normalized_name,
    min(raw_name) as sample_raw_name,
    max(is_hit) as is_hit
  from matched_items
  group by normalized_name
)
select
  count(*) as total_item_occurrences,
  sum(is_hit) as hit_item_occurrences,
  count(*) - sum(is_hit) as miss_item_occurrences,
  round(100.0 * sum(is_hit) / nullif(count(*), 0), 2) as occurrence_hit_rate_pct,
  (select count(*) from distinct_names) as total_distinct_names,
  (select count(*) from distinct_names where is_hit = 1) as hit_distinct_names,
  (select count(*) from distinct_names where is_hit = 0) as miss_distinct_names,
  round(
    100.0 * (select count(*) from distinct_names where is_hit = 1)
    / nullif((select count(*) from distinct_names), 0),
    2
  ) as distinct_name_hit_rate_pct
from matched_items;
