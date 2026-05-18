-- Migration: 将 health_condition 中的 routine_type 文本解析为数字作息，
-- 回填到 routine_sleep_hour 和 routine_wake_hour。
-- 执行方式：在 PostgreSQL 中直接运行，或集成到后端启动时自动执行。

-- 第一步：处理预设值（early_bird / regular / night_owl）
UPDATE weapp_user
SET health_condition = jsonb_set(
  jsonb_set(
    health_condition,
    '{routine_sleep_hour}',
    CASE health_condition->>'routine_type'
      WHEN 'early_bird' THEN '22'::jsonb
      WHEN 'regular'    THEN '23'::jsonb
      WHEN 'night_owl'  THEN '1'::jsonb
      ELSE NULL
    END
  ),
  '{routine_wake_hour}',
  CASE health_condition->>'routine_type'
    WHEN 'early_bird' THEN '6'::jsonb
    WHEN 'regular'    THEN '7'::jsonb
    WHEN 'night_owl'  THEN '9'::jsonb
    ELSE NULL
  END
)
WHERE health_condition->>'routine_type' IN ('early_bird', 'regular', 'night_owl')
  AND (health_condition->>'routine_sleep_hour' IS NULL);

-- 第二步：处理自定义文本格式（如 "23:00 睡，07:00 起"）
-- 使用正则提取前两个时间数字
UPDATE weapp_user
SET health_condition = jsonb_set(
  jsonb_set(
    health_condition,
    '{routine_sleep_hour}',
    to_jsonb((regexp_match(health_condition->>'routine_type', '(\d{1,2}):\d{2}'))[1]::int)
  ),
  '{routine_wake_hour}',
  to_jsonb((regexp_match(health_condition->>'routine_type', '(\d{1,2}):\d{2}.*?(\d{1,2}):\d{2}'))[2]::int)
)
WHERE health_condition->>'routine_type' IS NOT NULL
  AND health_condition->>'routine_type' != ''
  AND health_condition->>'routine_type' NOT IN ('early_bird', 'regular', 'night_owl', 'irregular')
  AND health_condition->>'routine_type' ~ '^\d{1,2}:\d{2}'
  AND (health_condition->>'routine_sleep_hour' IS NULL);

-- 第三步：清理不匹配的记录（如果正则匹配失败导致 NULL）
UPDATE weapp_user
SET health_condition = health_condition - 'routine_sleep_hour' - 'routine_wake_hour'
WHERE health_condition->>'routine_sleep_hour' IS NULL
  AND health_condition ? 'routine_sleep_hour';
