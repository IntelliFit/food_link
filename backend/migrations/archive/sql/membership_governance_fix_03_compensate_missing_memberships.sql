-- 会员数据治理执行 03：给异常丢资格的 paid 用户补 1 个月会员
-- 只插入“缺失 membership 行”的用户

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
),
missing_membership_rows AS (
  SELECT cp.*
  FROM compensation_payload cp
  LEFT JOIN public.user_pro_memberships m
    ON m.user_id = cp.user_id
  WHERE m.user_id IS NULL
)
INSERT INTO public.user_pro_memberships (
  user_id,
  status,
  current_plan_code,
  first_activated_at,
  current_period_start,
  expires_at,
  last_paid_at,
  auto_renew,
  daily_credits,
  created_at,
  updated_at
)
SELECT
  mm.user_id,
  'active',
  mm.compensation_plan_code,
  COALESCE(mm.paid_at, NOW()),
  NOW(),
  NOW() + INTERVAL '1 month',
  mm.paid_at,
  FALSE,
  COALESCE(mm.daily_credits, 0),
  NOW(),
  NOW()
FROM missing_membership_rows mm
RETURNING
  user_id,
  current_plan_code,
  expires_at,
  daily_credits;

