-- 会员数据治理审核 03：补偿候选明细
-- 定义：最近一次 paid 理论上仍未到期，但当前没有有效会员资格
-- 当前按实库字段 `weapp_user.create_time` 展示注册时间

WITH membership_payment_orders AS (
  SELECT *
  FROM public.pro_membership_payment_records
  WHERE
    plan_code = 'pro_monthly'
    OR plan_code LIKE 'light\_%' ESCAPE '\'
    OR plan_code LIKE 'standard\_%' ESCAPE '\'
    OR plan_code LIKE 'advanced\_%' ESCAPE '\'
),
active_memberships AS (
  SELECT user_id
  FROM public.user_pro_memberships
  WHERE status = 'active'
    AND expires_at > NOW()
),
latest_paid_order AS (
  SELECT DISTINCT ON (p.user_id)
    p.user_id,
    p.order_no,
    p.plan_code,
    p.amount,
    p.duration_months,
    p.paid_at,
    p.updated_at,
    COALESCE(p.paid_at, p.updated_at, p.created_at) AS paid_sort_at
  FROM membership_payment_orders p
  WHERE p.status = 'paid'
  ORDER BY p.user_id, COALESCE(p.paid_at, p.updated_at, p.created_at) DESC, p.order_no DESC
)
SELECT
  lp.user_id,
  u.nickname,
  u.create_time AS user_created_at,
  lp.order_no,
  lp.plan_code AS latest_paid_plan_code,
  lp.amount,
  lp.duration_months,
  lp.paid_at,
  (lp.paid_at + make_interval(months => GREATEST(COALESCE(lp.duration_months, 1), 1))) AS should_expire_at
FROM latest_paid_order lp
LEFT JOIN active_memberships a
  ON a.user_id = lp.user_id
LEFT JOIN public.weapp_user u
  ON u.id = lp.user_id
WHERE a.user_id IS NULL
  AND lp.paid_at IS NOT NULL
  AND (lp.paid_at + make_interval(months => GREATEST(COALESCE(lp.duration_months, 1), 1))) > NOW()
ORDER BY should_expire_at DESC, lp.paid_at DESC;
