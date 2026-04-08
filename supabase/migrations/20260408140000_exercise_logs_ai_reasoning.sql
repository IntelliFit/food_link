-- 运动记录表增加 ai_reasoning（与 backend/sql/add_exercise_ai_reasoning.sql 一致）

ALTER TABLE public.user_exercise_logs
ADD COLUMN IF NOT EXISTS ai_reasoning text;

COMMENT ON COLUMN public.user_exercise_logs.ai_reasoning IS '运动热量估算时模型的思考过程（简体中文），与 calories_burned 同时写入';
