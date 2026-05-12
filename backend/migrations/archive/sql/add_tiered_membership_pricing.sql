-- 食探会员：新定价策略 Schema 迁移
-- 执行位置：Supabase SQL Editor
-- 日期：2026-04-21
--
-- 变更说明：
--   1. membership_plan_config 扩展：tier / period / daily_credits / original_amount / sort_order
--   2. user_pro_memberships 扩展：daily_credits（当前套餐的每日积分快照）
--   3. 兼容 pro_monthly 等旧 code，不做删除，仅标记 is_active=false（由 seed 文件处理）

-- 1. membership_plan_config 扩展字段 -----------------------------------------
ALTER TABLE public.membership_plan_config
  ADD COLUMN IF NOT EXISTS tier TEXT,                       -- 'light' | 'standard' | 'advanced'
  ADD COLUMN IF NOT EXISTS period TEXT,                     -- 'monthly' | 'quarterly' | 'yearly'
  ADD COLUMN IF NOT EXISTS daily_credits INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC,         -- 对照价（用于"立省 xx 元"），NULL 表示无对照
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- 约束（幂等）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'membership_plan_config_tier_check'
  ) THEN
    ALTER TABLE public.membership_plan_config
      ADD CONSTRAINT membership_plan_config_tier_check
      CHECK (tier IS NULL OR tier IN ('light','standard','advanced'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'membership_plan_config_period_check'
  ) THEN
    ALTER TABLE public.membership_plan_config
      ADD CONSTRAINT membership_plan_config_period_check
      CHECK (period IS NULL OR period IN ('monthly','quarterly','yearly'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_membership_plan_config_tier_period
  ON public.membership_plan_config(tier, period);

-- 2. user_pro_memberships 扩展字段 -------------------------------------------
ALTER TABLE public.user_pro_memberships
  ADD COLUMN IF NOT EXISTS daily_credits INTEGER NOT NULL DEFAULT 0;

-- 注：3 天免费试用不额外落表，由 weapp_user.created_at + 后端计算得出。
