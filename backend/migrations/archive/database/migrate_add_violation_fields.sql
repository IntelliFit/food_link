-- 为 analysis_tasks 表添加违规审核相关字段
-- 1. 添加 is_violated 布尔字段标记是否违规
-- 2. 添加 violation_reason 字段存储违规原因
-- 3. 扩展 status 约束，新增 'violated' 状态

-- 添加 is_violated 字段
ALTER TABLE public.analysis_tasks
  ADD COLUMN IF NOT EXISTS is_violated boolean NOT NULL DEFAULT false;

-- 添加 violation_reason 字段
ALTER TABLE public.analysis_tasks
  ADD COLUMN IF NOT EXISTS violation_reason text NULL;

-- 删除旧的 status 约束
ALTER TABLE public.analysis_tasks
  DROP CONSTRAINT IF EXISTS analysis_tasks_status_check;

-- 添加新的 status 约束（包含 violated）
ALTER TABLE public.analysis_tasks
  ADD CONSTRAINT analysis_tasks_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text, 'violated'::text]));

-- 添加注释
COMMENT ON COLUMN public.analysis_tasks.is_violated IS '是否违规（AI 审核标记）';
COMMENT ON COLUMN public.analysis_tasks.violation_reason IS '违规原因（AI 审核返回的详细说明）';
