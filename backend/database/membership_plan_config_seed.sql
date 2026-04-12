-- 食探会员套餐数据初始化
-- 在 Supabase SQL Editor 中执行此文件

INSERT INTO membership_plan_config (code, name, description, amount, duration_months, is_active)
VALUES (
  'pro_monthly',
  '食探会员',
  '每日20次拍照 · 精准识别模式 · 计划指导 · 精美分享海报',
  9.90,
  1,
  true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  amount = EXCLUDED.amount,
  duration_months = EXCLUDED.duration_months,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- 积分充值 plan_code 外键占位（需 duration_months=0；若表上仍有 duration_months>=1 的 CHECK，请先执行 backend/sql/migrate_membership_plan_config_points_recharge_fk.sql 前半段 ALTER）
ALTER TABLE public.membership_plan_config
  DROP CONSTRAINT IF EXISTS membership_plan_config_duration_months_check;

ALTER TABLE public.membership_plan_config
  ADD CONSTRAINT membership_plan_config_duration_months_check
  CHECK (duration_months >= 0);

INSERT INTO membership_plan_config (code, name, description, amount, duration_months, is_active)
VALUES (
  'points_recharge',
  '积分充值',
  '微信支付积分充值（展示价占位，以下单金额为准）',
  1.00,
  0,
  false
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  amount = EXCLUDED.amount,
  duration_months = EXCLUDED.duration_months,
  is_active = EXCLUDED.is_active,
  updated_at = now();
