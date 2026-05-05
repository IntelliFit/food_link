-- 会员数据治理执行 02：给异常丢资格的 paid 用户补 1 个月会员
-- 只更新“已有 membership 行”的用户

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
    p.duration_months,
    p.paid_at,
    p.updated_at,
    COALESCE(p.paid_at, p.updated_at, p.created_at) AS paid_sort_at
  FROM membership_payment_orders p
  WHERE p.status = 'paid'
  ORDER BY p.user_id, COALESCE(p.paid_at, p.updated_at, p.created_at) DESC, p.order_no DESC
),
compensation_candidates AS (
  SELECT
    lp.user_id,
    lp.order_no,
    lp.plan_code,
    lp.paid_at,
    CASE
      WHEN lp.plan_code LIKE 'light\_%' ESCAPE '\' THEN 'light_monthly'
      WHEN lp.plan_code LIKE 'standard\_%' ESCAPE '\' THEN 'standard_monthly'
      WHEN lp.plan_code LIKE 'advanced\_%' ESCAPE '\' THEN 'advanced_monthly'
      WHEN lp.plan_code = 'pro_monthly' THEN 'standard_monthly'
      ELSE NULL
    END AS compensation_plan_code
  FROM latest_paid_order lp
  LEFT JOIN active_memberships a
    ON a.user_id = lp.user_id
  WHERE a.user_id IS NULL
    AND lp.paid_at IS NOT NULL
    AND (lp.paid_at + make_interval(months => GREATEST(COALESCE(lp.duration_months, 1), 1))) > NOW()
),
compensation_payload AS (
  SELECT
    c.user_id,
    c.order_no,
    c.plan_code AS latest_paid_plan_code,
    c.paid_at,
    c.compensation_plan_code,
    p.daily_credits
  FROM compensation_candidates c
  JOIN public.membership_plan_config p
    ON p.code = c.compensation_plan_code
)
UPDATE public.user_pro_memberships m
SET
  status = 'active',
  current_plan_code = cp.compensation_plan_code,
  current_period_start = NOW(),
  expires_at = NOW() + INTERVAL '1 month',
  daily_credits = COALESCE(cp.daily_credits, 0),
  updated_at = NOW()
FROM compensation_payload cp
WHERE m.user_id = cp.user_id
RETURNING
  m.user_id,
  cp.latest_paid_plan_code,
  cp.compensation_plan_code,
  m.expires_at,
  m.daily_credits;

