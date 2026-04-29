-- 会员数据治理审核 04：会员 pending 概览 + 老 pending 明细

WITH membership_payment_orders AS (
  SELECT *
  FROM public.pro_membership_payment_records
  WHERE
    plan_code = 'pro_monthly'
    OR plan_code LIKE 'light\_%' ESCAPE '\'
    OR plan_code LIKE 'standard\_%' ESCAPE '\'
    OR plan_code LIKE 'advanced\_%' ESCAPE '\'
)
SELECT
  status,
  plan_code,
  COUNT(*) AS order_count,
  COUNT(DISTINCT user_id) AS user_count
FROM membership_payment_orders
GROUP BY status, plan_code
ORDER BY status, plan_code;


WITH membership_payment_orders AS (
  SELECT *
  FROM public.pro_membership_payment_records
  WHERE
    plan_code = 'pro_monthly'
    OR plan_code LIKE 'light\_%' ESCAPE '\'
    OR plan_code LIKE 'standard\_%' ESCAPE '\'
    OR plan_code LIKE 'advanced\_%' ESCAPE '\'
)
SELECT
  p.user_id,
  u.nickname,
  p.order_no,
  p.plan_code,
  p.amount,
  p.status,
  p.created_at,
  p.updated_at
FROM membership_payment_orders p
LEFT JOIN public.weapp_user u
  ON u.id = p.user_id
WHERE p.status = 'pending'
  AND p.created_at < NOW() - INTERVAL '1 day'
ORDER BY p.created_at ASC;

