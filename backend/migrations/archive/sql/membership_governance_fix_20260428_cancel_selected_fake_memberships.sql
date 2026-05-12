-- 只取消本轮确认的 4 个假会员，不处理其他候选人

UPDATE public.user_pro_memberships
SET
  status = 'expired',
  expires_at = NOW() - INTERVAL '1 second',
  daily_credits = 0,
  updated_at = NOW()
WHERE user_id IN (
  'ec6b7cf7-4719-497c-bc58-78e362b16824', -- 凣凣尜尜
  'eb0d0221-509f-4b5a-bd2d-449f63468264', -- 草！我要干俄挺
  'b4846126-7823-4091-af3f-30b073e4b0f4', -- kk
  'd8c5807f-a3b4-4004-a3ad-ded5a489d2a9'  -- 条条
)
RETURNING
  user_id,
  current_plan_code,
  status,
  expires_at,
  updated_at;
