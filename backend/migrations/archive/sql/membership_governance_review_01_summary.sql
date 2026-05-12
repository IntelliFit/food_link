-- 会员数据治理审核 01：总览统计（只查不改）
-- 当前按实库字段 `weapp_user.create_time` 作为注册时间

WITH membership_payment_orders AS (
  SELECT p.*
  FROM public.pro_membership_payment_records p
  WHERE
    p.plan_code = 'pro_monthly'
    OR p.plan_code LIKE 'light\_%' ESCAPE '\'
    OR p.plan_code LIKE 'standard\_%' ESCAPE '\'
    OR p.plan_code LIKE 'advanced\_%' ESCAPE '\'
),
early_trial_users AS (
  SELECT id, create_time
  FROM public.weapp_user
  ORDER BY create_time ASC NULLS LAST, id ASC
  LIMIT 1000
),
trial_eligible_users AS (
  SELECT
    u.id AS user_id,
    CASE
      WHEN e.id IS NOT NULL THEN u.create_time + INTERVAL '30 day'
      ELSE u.create_time + INTERVAL '3 day'
    END AS trial_expires_at
  FROM public.weapp_user u
  LEFT JOIN early_trial_users e
    ON e.id = u.id
),
active_memberships AS (
  SELECT
    m.user_id,
    m.current_plan_code,
    m.daily_credits,
    m.expires_at
  FROM public.user_pro_memberships m
  WHERE m.status = 'active'
    AND m.expires_at > NOW()
),
paid_users AS (
  SELECT DISTINCT user_id
  FROM membership_payment_orders
  WHERE status = 'paid'
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
fake_active_memberships AS (
  SELECT a.user_id
  FROM active_memberships a
  LEFT JOIN paid_users pu
    ON pu.user_id = a.user_id
  LEFT JOIN trial_eligible_users t
    ON t.user_id = a.user_id
   AND t.trial_expires_at > NOW()
  WHERE pu.user_id IS NULL
    AND t.user_id IS NULL
),
compensation_candidates AS (
  SELECT lp.user_id
  FROM latest_paid_order lp
  LEFT JOIN active_memberships a
    ON a.user_id = lp.user_id
  WHERE a.user_id IS NULL
    AND lp.paid_at IS NOT NULL
    AND (lp.paid_at + make_interval(months => GREATEST(COALESCE(lp.duration_months, 1), 1))) > NOW()
)
SELECT 'active_memberships' AS metric, COUNT(*)::BIGINT AS value FROM active_memberships
UNION ALL
SELECT 'paid_users_distinct', COUNT(*)::BIGINT FROM paid_users
UNION ALL
SELECT 'trial_eligible_users_now', COUNT(*)::BIGINT
FROM trial_eligible_users
WHERE trial_expires_at > NOW()
UNION ALL
SELECT 'fake_active_membership_candidates', COUNT(*)::BIGINT FROM fake_active_memberships
UNION ALL
SELECT 'compensation_candidates', COUNT(*)::BIGINT FROM compensation_candidates
UNION ALL
SELECT 'pending_membership_orders_total', COUNT(*)::BIGINT
FROM membership_payment_orders
WHERE status = 'pending'
UNION ALL
SELECT 'pending_points_recharge_orders_total', COUNT(*)::BIGINT
FROM public.pro_membership_payment_records
WHERE status = 'pending'
  AND plan_code = 'points_recharge'
ORDER BY metric;
