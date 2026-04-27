-- 食探会员套餐数据初始化（3 档 × 3 周期 = 9 套餐）
-- 在 Supabase SQL Editor 中执行此文件
-- 前置依赖：backend/sql/add_tiered_membership_pricing.sql
-- 说明：本文件仅更新 seed 数据，不新增 schema；可在已迁移库上重复执行
-- 日期：2026-04-21
--
-- 定价矩阵：
--              月卡     季卡     年卡      每日积分
--   轻度版    9.90    27.90    99.00       8
--   标准版   19.90    56.90   199.00      20
--   进阶版   29.90    84.90   299.00      40
--
-- 积分消耗：运动记录 1 积分/次，基础记录/基础分析 2 积分/次
-- 免费试用：
--   - 前 1000 名注册用户：30 天 × 每日 8 积分
--   - 其余新用户：3 天 × 每日 8 积分
--   - 积分当天清零，不累计

-- 先关闭历史单一套餐（不删除，避免外键/历史记录丢参考）
UPDATE public.membership_plan_config
SET is_active = false, updated_at = now()
WHERE code = 'pro_monthly';

-- ========== 轻度版 Light ==========
INSERT INTO public.membership_plan_config
  (code, name, description, amount, duration_months, is_active, tier, period, daily_credits, original_amount, sort_order)
VALUES
  ('light_monthly',   '轻度版 · 月卡', '每日 8 积分 · 轻量记录',
   9.90,  1,  true, 'light',    'monthly',    8, NULL,   11),
  ('light_quarterly', '轻度版 · 季卡', '每日 8 积分 · 轻量记录 · 3 个月',
   27.90, 3,  true, 'light',    'quarterly',  8, 29.70,  12),
  ('light_yearly',    '轻度版 · 年卡', '每日 8 积分 · 轻量记录 · 12 个月',
   99.00, 12, true, 'light',    'yearly',     8, 118.80, 13),

  -- ========== 标准版 Standard ==========
  ('standard_monthly',   '标准版 · 月卡', '每日 20 积分 · 含精准模式 · 适合日常使用',
   19.90, 1,  true, 'standard', 'monthly',   20, NULL,   21),
  ('standard_quarterly', '标准版 · 季卡', '每日 20 积分 · 含精准模式 · 3 个月',
   56.90, 3,  true, 'standard', 'quarterly', 20, 59.70,  22),
  ('standard_yearly',    '标准版 · 年卡', '每日 20 积分 · 含精准模式 · 12 个月',
   199.00, 12, true, 'standard','yearly',    20, 238.80, 23),

  -- ========== 进阶版 Advanced ==========
  ('advanced_monthly',   '进阶版 · 月卡', '每日 40 积分 · 含精准模式 · 适合高频使用',
   29.90, 1,  true, 'advanced', 'monthly',   40, NULL,   31),
  ('advanced_quarterly', '进阶版 · 季卡', '每日 40 积分 · 含精准模式 · 3 个月',
   84.90, 3,  true, 'advanced', 'quarterly', 40, 89.70,  32),
  ('advanced_yearly',    '进阶版 · 年卡', '每日 40 积分 · 含精准模式 · 12 个月',
   299.00, 12, true, 'advanced','yearly',    40, 358.80, 33)
ON CONFLICT (code) DO UPDATE SET
  name             = EXCLUDED.name,
  description      = EXCLUDED.description,
  amount           = EXCLUDED.amount,
  duration_months  = EXCLUDED.duration_months,
  is_active        = EXCLUDED.is_active,
  tier             = EXCLUDED.tier,
  period           = EXCLUDED.period,
  daily_credits    = EXCLUDED.daily_credits,
  original_amount  = EXCLUDED.original_amount,
  sort_order       = EXCLUDED.sort_order,
  updated_at       = now();
