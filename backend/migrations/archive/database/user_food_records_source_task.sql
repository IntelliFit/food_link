-- ============================================================
-- 饮食记录表：关联来源任务（从哪条 analysis_tasks 识别结果保存而来）
--
-- 【执行】在 Supabase SQL Editor 中执行（需先执行 analysis_tasks.sql）
-- ============================================================

ALTER TABLE public.user_food_records
  ADD COLUMN IF NOT EXISTS source_task_id uuid REFERENCES public.analysis_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_food_records_source_task_id ON public.user_food_records(source_task_id);

COMMENT ON COLUMN public.user_food_records.source_task_id IS '来源识别任务 ID（从 analysis_tasks 哪条任务保存而来）';
