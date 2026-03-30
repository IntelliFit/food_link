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
