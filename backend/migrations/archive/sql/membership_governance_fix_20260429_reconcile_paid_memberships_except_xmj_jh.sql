-- 目的：
-- 1) 排除“小马哥 / 锦恢”不动
-- 2) 其余已存在真实 paid 会员订单的用户，统一按“最近一次 paid 会员订单”回写 user_pro_memberships
-- 3) 修正错挂成年卡 / 状态与到期时间不一致 / 日积分快照异常的问题
--
-- 说明：
-- - 这里不处理没有 paid 记录的假会员（它们已在前序脚本里单独取消）
-- - 这里不处理 pending / points_recharge
-- - legacy `pro_monthly` 暂按“旧 Pro 月卡”保留 code，不强行改名；daily_credits 快照按 20 写入
--   这样后端当前“前 1000 用户付费积分 x2”逻辑会在运行时把它提升到 40

WITH fixes AS (
  SELECT *
  FROM (
    VALUES
      -- ikura：最近一次 paid = pro_monthly 9.9
      ('6646baaa-e86b-410b-a801-d56936d2b8ef'::uuid, 'pro_monthly'::text, '2026-03-31T16:09:21+00:00'::timestamptz, '2026-04-30T16:09:21+00:00'::timestamptz, 'expired'::text, 0::int),
      -- myRan：最近一次 paid = standard_monthly 19.9
      ('5515f5b6-eaa5-495c-8900-228f8be844a1'::uuid, 'standard_monthly'::text, '2026-04-26T23:28:04+00:00'::timestamptz, '2026-05-26T23:28:04+00:00'::timestamptz, 'active'::text, 20::int),
      -- 丹：最近一次 paid = pro_monthly 9.9
      ('9ffe3971-5a3a-488a-957c-ee96dff7ad9b'::uuid, 'pro_monthly'::text, '2026-04-19T15:33:20+00:00'::timestamptz, '2026-05-19T15:33:20+00:00'::timestamptz, 'active'::text, 20::int),
      -- 子夜求知：最近一次 paid = pro_monthly 0.01（测试价，但仍按 paid 真相收口）
      ('c313abe7-686d-47c5-a29f-50ad2988d05b'::uuid, 'pro_monthly'::text, '2026-03-21T20:05:39+00:00'::timestamptz, '2026-04-21T20:05:39+00:00'::timestamptz, 'expired'::text, 0::int),
      -- 群群：最近一次 paid = pro_monthly 9.9
      ('ec5f80b3-9ed8-4d2b-9a4a-76fe00b9a79d'::uuid, 'pro_monthly'::text, '2026-04-20T02:47:09+00:00'::timestamptz, '2026-05-20T02:47:09+00:00'::timestamptz, 'active'::text, 20::int),
      -- 饭饭：当前错挂 standard_yearly，最近一次 paid 实际是 standard_monthly 19.9
      ('6f0b67e5-f3b1-4b38-b3fc-081d931d8ef1'::uuid, 'standard_monthly'::text, '2026-04-26T01:36:30+00:00'::timestamptz, '2026-05-26T01:36:30+00:00'::timestamptz, 'active'::text, 20::int),
      -- 魔法猫咪：当前误成 expired，最近一次 paid 实际仍在有效期内
      ('c63681c3-17f5-446d-b885-d3320687108f'::uuid, 'light_monthly'::text, '2026-04-26T10:49:46+00:00'::timestamptz, '2026-05-26T10:49:46+00:00'::timestamptz, 'active'::text, 8::int)
  ) AS t(user_id, plan_code, paid_at, expires_at, target_status, daily_credits)
)
UPDATE public.user_pro_memberships upm
SET
  current_plan_code = f.plan_code,
  status = f.target_status,
  current_period_start = f.paid_at,
  expires_at = f.expires_at,
  last_paid_at = f.paid_at,
  daily_credits = f.daily_credits,
  updated_at = NOW()
FROM fixes f
WHERE upm.user_id = f.user_id
RETURNING
  upm.user_id,
  upm.current_plan_code,
  upm.status,
  upm.current_period_start,
  upm.expires_at,
  upm.last_paid_at,
  upm.daily_credits,
  upm.updated_at;
