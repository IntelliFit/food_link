-- 运动记录：保存模型估算时的简要思考过程（便于前端展示与复盘）
-- 在 Supabase SQL Editor 执行，或随 supabase migration 一并应用

ALTER TABLE public.user_exercise_logs
ADD COLUMN IF NOT EXISTS ai_reasoning text;

COMMENT ON COLUMN public.user_exercise_logs.ai_reasoning IS '运动热量估算时模型的思考过程（简体中文），与 calories_burned 同时写入';
