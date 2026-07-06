-- Audit likely calorie outliers in food library tables.
-- This is a read-only report. Review rows manually before applying data fixes.

WITH packaged AS (
  SELECT
    'packaged_food_library' AS source_table,
    id::text AS id,
    trim(concat_ws(' ', brand, product_name, display_name, flavor_text, spec_text)) AS title,
    package_category,
    nutrition_basis_unit,
    net_content_value,
    net_content_unit,
    net_weight_g,
    serving_weight_g,
    kcal_per_100g,
    CASE
      WHEN serving_weight_g > 750
        AND (lower(coalesce(nutrition_basis_unit, '')) LIKE '%100ml%' OR lower(coalesce(net_content_unit, '')) = 'ml')
        THEN 500
      WHEN serving_weight_g > 0 THEN serving_weight_g
      WHEN lower(coalesce(net_content_unit, '')) = 'ml' AND net_content_value > 0 AND net_content_value <= 750 THEN net_content_value
      WHEN lower(coalesce(net_content_unit, '')) = 'ml' AND net_content_value > 750 THEN 500
      WHEN net_weight_g > 0 AND net_weight_g <= 500 THEN net_weight_g
      ELSE 100
    END AS display_weight,
    CASE
      WHEN lower(coalesce(nutrition_basis_unit, '')) LIKE '%100ml%'
        OR lower(coalesce(net_content_unit, '')) = 'ml'
        OR coalesce(package_category, '') ~ '(饮料|茶饮|奶茶|果汁|可乐|汽水|柠檬茶|冰红茶|绿茶|红茶|乌龙茶)'
        OR concat_ws(' ', brand, product_name, display_name, flavor_text, spec_text) ~ '(饮料|茶饮|奶茶|果汁|可乐|汽水|柠檬茶|冰红茶|绿茶|红茶|乌龙茶)'
        THEN 'beverage'
      ELSE 'packaged'
    END AS inferred_category
  FROM packaged_food_library
  WHERE is_active = TRUE
    AND kcal_per_100g > 0
    AND coalesce(nullif(review_status, ''), 'active') = 'active'
),
packaged_issues AS (
  SELECT
    source_table,
    id,
    title,
    inferred_category,
    kcal_per_100g,
    display_weight,
    kcal_per_100g * display_weight / 100.0 AS display_calories,
    concat_ws(
      '; ',
      CASE WHEN inferred_category = 'beverage' AND kcal_per_100g > 120 THEN 'beverage kcal_per_100g high' END,
      CASE WHEN inferred_category = 'beverage' AND kcal_per_100g * display_weight / 100.0 > 800 THEN 'beverage display calories high' END,
      CASE WHEN inferred_category = 'beverage' AND serving_weight_g > 750 THEN 'beverage serving weight high' END,
      CASE WHEN inferred_category = 'packaged' AND kcal_per_100g > 900 THEN 'packaged kcal_per_100g high' END,
      CASE WHEN lower(coalesce(net_content_unit, '')) = 'ml' AND net_content_value > 2000 THEN 'beverage net content suspicious' END
    ) AS issue
  FROM packaged
  WHERE (inferred_category = 'beverage' AND (kcal_per_100g > 120 OR kcal_per_100g * display_weight / 100.0 > 800 OR serving_weight_g > 750))
     OR (inferred_category = 'packaged' AND kcal_per_100g > 900)
     OR (lower(coalesce(net_content_unit, '')) = 'ml' AND net_content_value > 2000)
),
nutrition_issues AS (
  SELECT
    'food_nutrition_library' AS source_table,
    id::text AS id,
    canonical_name AS title,
    CASE
      WHEN canonical_name ~ '(饮料|茶饮|奶茶|果汁|可乐|汽水|柠檬茶|冰红茶|绿茶|红茶|乌龙茶)' THEN 'beverage'
      WHEN canonical_name ~ '(油|oil|脂|fat|Lard|tallow)' THEN 'oil_or_fat'
      ELSE 'nutrition'
    END AS inferred_category,
    kcal_per_100g,
    100::numeric AS display_weight,
    kcal_per_100g AS display_calories,
    concat_ws(
      '; ',
      CASE WHEN canonical_name ~ '(饮料|茶饮|奶茶|果汁|可乐|汽水|柠檬茶|冰红茶|绿茶|红茶|乌龙茶)' AND kcal_per_100g > 120 THEN 'beverage kcal_per_100g high' END,
      CASE WHEN kcal_per_100g > 900 AND canonical_name !~ '(油|oil|脂|fat|Lard|tallow)' THEN 'non-oil kcal_per_100g high' END
    ) AS issue
  FROM food_nutrition_library
  WHERE is_active = TRUE
    AND (
      (canonical_name ~ '(饮料|茶饮|奶茶|果汁|可乐|汽水|柠檬茶|冰红茶|绿茶|红茶|乌龙茶)' AND kcal_per_100g > 120)
      OR (kcal_per_100g > 900 AND canonical_name !~ '(油|oil|脂|fat|Lard|tallow)')
    )
),
public_issues AS (
  SELECT
    'public_food_library' AS source_table,
    id::text AS id,
    food_name AS title,
    type AS inferred_category,
    NULL::numeric AS kcal_per_100g,
    1::numeric AS display_weight,
    total_calories AS display_calories,
    'public library total calories high' AS issue
  FROM public_food_library
  WHERE status = 'published'
    AND total_calories > 1500
)
SELECT *
FROM (
  SELECT * FROM packaged_issues
  UNION ALL
  SELECT * FROM nutrition_issues
  UNION ALL
  SELECT * FROM public_issues
) issues
ORDER BY display_calories DESC NULLS LAST, source_table, title;
