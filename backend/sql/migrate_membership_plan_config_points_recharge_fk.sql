-- 积分充值订单的 plan_code=points_recharge 受 FK：pro_membership_payment_records.plan_code -> membership_plan_config.code
-- 若未插入该行，INSERT 会报 23503。
-- is_active=false：不在「会员套餐列表」中展示，且 POST /api/membership/pay/create 仍会要求套餐已启用，避免误用。
-- amount/duration_months 仅为占位；真实金额由 /api/points/recharge/create 请求体决定。
--
-- 原表常有 membership_plan_config_duration_months_check（例如 duration_months>=1），无法插入积分充值的 0 月占位，需先放宽。

ALTER TABLE public.membership_plan_config
  DROP CONSTRAINT IF EXISTS membership_plan_config_duration_months_check;

ALTER TABLE public.membership_plan_config
  ADD CONSTRAINT membership_plan_config_duration_months_check
  CHECK (duration_months >= 0);

INSERT INTO public.membership_plan_config (code, name, description, amount, duration_months, is_active)
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
