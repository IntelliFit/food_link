-- 收口脏状态：expires_at 已过期，但 status 仍为 active 的会员
-- 只处理这一类，不涉及假会员筛选、补偿会员或 pending 订单

UPDATE public.user_pro_memberships
SET
  status = 'expired',
  daily_credits = 0,
  updated_at = NOW()
WHERE status = 'active'
  AND expires_at IS NOT NULL
  AND expires_at <= NOW()
RETURNING
  user_id,
  current_plan_code,
  status,
  expires_at,
  updated_at;
