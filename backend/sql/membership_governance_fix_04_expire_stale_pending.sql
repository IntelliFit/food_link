-- 会员数据治理执行 04：把超过 1 天的历史会员 pending 改成 expired
-- 不处理 points_recharge

UPDATE public.pro_membership_payment_records p
SET
  status = 'expired',
  updated_at = NOW(),
  extra = COALESCE(p.extra, '{}'::jsonb)
    || jsonb_build_object(
      'expire_reason', 'stale_pending_cleanup_20260427',
      'expired_at', NOW()
    )
WHERE p.status = 'pending'
  AND p.created_at < NOW() - INTERVAL '1 day'
  AND (
    p.plan_code = 'pro_monthly'
    OR p.plan_code LIKE 'light\_%' ESCAPE '\'
    OR p.plan_code LIKE 'standard\_%' ESCAPE '\'
    OR p.plan_code LIKE 'advanced\_%' ESCAPE '\'
  )
RETURNING
  p.user_id,
  p.order_no,
  p.plan_code,
  p.created_at,
  p.updated_at,
  p.status;

