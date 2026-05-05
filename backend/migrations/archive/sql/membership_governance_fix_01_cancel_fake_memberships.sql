-- 会员数据治理执行 01：取消假会员
-- 定义：当前 active 且未过期，但没有 paid，也不在合法试用期
-- 当前按实库字段 `weapp_user.create_time` 作为注册时间

WITH membership_payment_orders AS (
  SELECT *
  FROM public.pro_membership_payment_records
  WHERE
    plan_code = 'pro_monthly'
    OR plan_code LIKE 'light\_%' ESCAPE '\'
    OR plan_code LIKE 'standard\_%' ESCAPE '\'
    OR plan_code LIKE 'advanced\_%' ESCAPE '\'
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
  SELECT *
  FROM public.user_pro_memberships
  WHERE status = 'active'
    AND expires_at > NOW()
),
paid_users AS (
  SELECT DISTINCT user_id
  FROM membership_payment_orders
  WHERE status = 'paid'
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
)
UPDATE public.user_pro_memberships m
SET
  status = 'expired',
  expires_at = NOW() - INTERVAL '1 second',
  daily_credits = 0,
  updated_at = NOW()
FROM fake_active_memberships f
WHERE m.user_id = f.user_id
RETURNING
  m.user_id,
  m.current_plan_code,
  m.status,
  m.expires_at,
  m.updated_at;
