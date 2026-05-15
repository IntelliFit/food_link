-- ============================================================
-- 饮食记录表：拆分状态字段为 diet_goal 和 activity_timing
--
-- 【执行】在 Supabase SQL Editor 中执行本脚本
-- ============================================================

-- 饮食目标：减脂期、增肌期、维持体重、无
ALTER TABLE public.user_food_records
  ADD COLUMN IF NOT EXISTS diet_goal text;

-- 运动时机：练后、日常、睡前、无
ALTER TABLE public.user_food_records
  ADD COLUMN IF NOT EXISTS activity_timing text;

COMMENT ON COLUMN public.user_food_records.diet_goal IS '饮食目标：fat_loss(减脂期), muscle_gain(增肌期), maintain(维持体重), none(无)';
COMMENT ON COLUMN public.user_food_records.activity_timing IS '运动时机：post_workout(练后), daily(日常), before_sleep(睡前), none(无)';

-- 注意：旧的 context_state 字段保留，以便迁移和兼容
COMMENT ON COLUMN public.user_food_records.context_state IS '旧版用户状态字段（已废弃，保留兼容）';
