-- ============================================================
-- 从历史饮食记录回填食物营养库
--
-- 数据来源：
--   public.user_food_records.items
-- 每条 item 通常包含：
--   - name
--   - weight
--   - nutrients.calories / protein / carbs / fat
--
-- 回填逻辑：
--   1. 从历史记录中展开所有食物项
--   2. 过滤当前食物库和别名表都未命中的食物名
--   3. 按 calories / weight * 100 计算每 100g 热量
--   4. 同一食物多条记录取平均值
--   5. 插入 food_nutrition_library
--
-- 使用建议：
--   - 先运行“预览查询”，看候选是否合理
--   - 再运行“插入查询”
--   - 若想更保守，可把 settings.min_samples 改为 2 或 3
-- ============================================================


-- ============================================================
-- 1) 预览：最近 N 天内，历史记录中未命中食物库的候选
-- ============================================================
with settings as (
  select
    3650::int as lookback_days,   -- 回看天数；如只看最近 30 天改成 30
    1::int as min_samples         -- 最少样本数；建议 2 或 3 更稳妥
),
historical_items as (
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
    ) as normalized_name,
    nullif((item->>'weight')::numeric, 0) as weight_g,
    nullif((item->'nutrients'->>'calories')::numeric, 0) as calories,
    nullif((item->'nutrients'->>'protein')::numeric, 0) as protein,
    nullif((item->'nutrients'->>'carbs')::numeric, 0) as carbs,
    nullif((item->'nutrients'->>'fat')::numeric, 0) as fat
  from public.user_food_records r
  cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) as item
  cross join settings s
  where r.record_time >= now() - make_interval(days => s.lookback_days)
    and coalesce(trim(item->>'name'), '') <> ''
),
valid_items as (
  select *
  from historical_items
  where normalized_name <> ''
    and weight_g is not null
    and weight_g > 0
    and calories is not null
    and calories > 0
),
library_names as (
  select l.normalized_name
  from public.food_nutrition_library l
  where l.is_active = true

  union

  select a.normalized_alias as normalized_name
  from public.food_nutrition_aliases a
),
unmatched_items as (
  select v.*
  from valid_items v
  left join library_names ln
    on ln.normalized_name = v.normalized_name
  where ln.normalized_name is null
),
name_candidates as (
  select
    normalized_name,
    raw_name,
    count(*) as raw_name_count,
    row_number() over (
      partition by normalized_name
      order by count(*) desc, length(raw_name) asc, raw_name asc
    ) as rn
  from unmatched_items
  group by normalized_name, raw_name
),
aggregated as (
  select
    u.normalized_name,
    count(*) as sample_count,
    round(avg(u.calories * 100.0 / u.weight_g), 2) as kcal_per_100g,
    round(avg(coalesce(u.protein, 0) * 100.0 / u.weight_g), 2) as protein_per_100g,
    round(avg(coalesce(u.carbs, 0) * 100.0 / u.weight_g), 2) as carbs_per_100g,
    round(avg(coalesce(u.fat, 0) * 100.0 / u.weight_g), 2) as fat_per_100g,
    round(avg(u.weight_g), 2) as avg_weight_g,
    round(avg(u.calories), 2) as avg_item_calories
  from unmatched_items u
  group by u.normalized_name
),
preview as (
  select
    a.normalized_name,
    nc.raw_name as canonical_name_candidate,
    a.sample_count,
    a.kcal_per_100g,
    a.protein_per_100g,
    a.carbs_per_100g,
    a.fat_per_100g,
    a.avg_weight_g,
    a.avg_item_calories
  from aggregated a
  join name_candidates nc
    on nc.normalized_name = a.normalized_name
   and nc.rn = 1
  cross join settings s
  where a.sample_count >= s.min_samples
)
select *
from preview
order by sample_count desc, canonical_name_candidate asc;


-- ============================================================
-- 2) 插入：把预览结果批量写入 food_nutrition_library
-- ============================================================
with settings as (
  select
    3650::int as lookback_days,
    1::int as min_samples
),
historical_items as (
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
    ) as normalized_name,
    nullif((item->>'weight')::numeric, 0) as weight_g,
    nullif((item->'nutrients'->>'calories')::numeric, 0) as calories,
    nullif((item->'nutrients'->>'protein')::numeric, 0) as protein,
    nullif((item->'nutrients'->>'carbs')::numeric, 0) as carbs,
    nullif((item->'nutrients'->>'fat')::numeric, 0) as fat
  from public.user_food_records r
  cross join lateral jsonb_array_elements(coalesce(r.items, '[]'::jsonb)) as item
  cross join settings s
  where r.record_time >= now() - make_interval(days => s.lookback_days)
    and coalesce(trim(item->>'name'), '') <> ''
),
valid_items as (
  select *
  from historical_items
  where normalized_name <> ''
    and weight_g is not null
    and weight_g > 0
    and calories is not null
    and calories > 0
),
library_names as (
  select l.normalized_name
  from public.food_nutrition_library l
  where l.is_active = true

  union

  select a.normalized_alias as normalized_name
  from public.food_nutrition_aliases a
),
unmatched_items as (
  select v.*
  from valid_items v
  left join library_names ln
    on ln.normalized_name = v.normalized_name
  where ln.normalized_name is null
),
name_candidates as (
  select
    normalized_name,
    raw_name,
    count(*) as raw_name_count,
    row_number() over (
      partition by normalized_name
      order by count(*) desc, length(raw_name) asc, raw_name asc
    ) as rn
  from unmatched_items
  group by normalized_name, raw_name
),
aggregated as (
  select
    u.normalized_name,
    count(*) as sample_count,
    round(avg(u.calories * 100.0 / u.weight_g), 2) as kcal_per_100g,
    round(avg(coalesce(u.protein, 0) * 100.0 / u.weight_g), 2) as protein_per_100g,
    round(avg(coalesce(u.carbs, 0) * 100.0 / u.weight_g), 2) as carbs_per_100g,
    round(avg(coalesce(u.fat, 0) * 100.0 / u.weight_g), 2) as fat_per_100g
  from unmatched_items u
  group by u.normalized_name
),
to_insert as (
  select
    nc.raw_name as canonical_name,
    a.normalized_name,
    a.kcal_per_100g,
    a.protein_per_100g,
    a.carbs_per_100g,
    a.fat_per_100g,
    a.sample_count
  from aggregated a
  join name_candidates nc
    on nc.normalized_name = a.normalized_name
   and nc.rn = 1
  cross join settings s
  where a.sample_count >= s.min_samples
)
insert into public.food_nutrition_library (
  canonical_name,
  normalized_name,
  kcal_per_100g,
  protein_per_100g,
  carbs_per_100g,
  fat_per_100g,
  source
)
select
  canonical_name,
  normalized_name,
  kcal_per_100g,
  protein_per_100g,
  carbs_per_100g,
  fat_per_100g,
  'history_backfill_user_food_records_v1'
from to_insert
on conflict (normalized_name) do nothing;
