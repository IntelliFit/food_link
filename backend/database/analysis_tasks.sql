-- ============================================================
-- 异步分析任务表（食物分析、体检 OCR 等）
-- 子进程 Worker 轮询 pending 任务并处理，结果写回本表。
--
-- 【执行】在 Supabase Dashboard → SQL Editor 中执行本文件
-- ============================================================

-- 任务表：支持多种 task_type，后续可扩展 health_report 等
CREATE TABLE IF NOT EXISTS public.analysis_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('food', 'health_report')),
  image_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  payload jsonb DEFAULT '{}',
  result jsonb,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT analysis_tasks_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_tasks_user_id ON public.analysis_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_status_type ON public.analysis_tasks(status, task_type);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_created_at ON public.analysis_tasks(created_at);

COMMENT ON TABLE public.analysis_tasks IS '异步分析任务：食物识别、体检 OCR 等，由 Worker 子进程消费';
COMMENT ON COLUMN public.analysis_tasks.task_type IS '任务类型: food=食物分析, health_report=体检报告OCR';
COMMENT ON COLUMN public.analysis_tasks.payload IS '提交时的参数：meal_type, diet_goal, user_goal 等';
COMMENT ON COLUMN public.analysis_tasks.result IS '分析结果 JSON：食物为 description/items/insight 等，体检为 extracted_content';
