-- 用法：
-- 1. 将下面的 REPLACE_WITH_OPENID 替换为要测试的用户 openid
-- 2. 在 Supabase SQL Editor 中执行
-- 作用：
-- - 立即取消该用户的 Pro 会员资格
-- - 不退款
-- - 不删除历史支付记录

BEGIN;

WITH target_user AS (
  SELECT id
  FROM public.weapp_user
  WHERE openid = 'REPLACE_WITH_OPENID'
  LIMIT 1
)
UPDATE public.user_pro_memberships AS upm
SET
  status = 'cancelled',
  current_plan_code = NULL,
  current_period_start = NULL,
  expires_at = now(),
  auto_renew = false,
  updated_at = now()
FROM target_user tu
WHERE upm.user_id = tu.id;

COMMIT;
