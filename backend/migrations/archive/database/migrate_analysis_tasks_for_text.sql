-- 修改 analysis_tasks 表以支持文字分析
-- 1. image_url 改为可空（因为文字分析不需要图片）
-- 2. 添加 text_input 字段存储文字输入
-- 3. 更新 task_type 约束，添加 'food_text' 类型

-- 修改 image_url 为可空
ALTER TABLE public.analysis_tasks 
  ALTER COLUMN image_url DROP NOT NULL;

-- 添加 text_input 字段（可空，用于文字分析）
ALTER TABLE public.analysis_tasks 
  ADD COLUMN IF NOT EXISTS text_input TEXT NULL;

-- 删除旧的 task_type 约束
ALTER TABLE public.analysis_tasks 
  DROP CONSTRAINT IF EXISTS analysis_tasks_task_type_check;

-- 添加新的 task_type 约束（包含 food_text）
ALTER TABLE public.analysis_tasks 
  ADD CONSTRAINT analysis_tasks_task_type_check 
  CHECK (task_type = ANY (ARRAY['food'::text, 'food_text'::text, 'health_report'::text]));

-- 添加注释
COMMENT ON COLUMN public.analysis_tasks.image_url IS '图片URL（图片分析时必填）';
COMMENT ON COLUMN public.analysis_tasks.text_input IS '文字描述（文字分析时必填）';
COMMENT ON COLUMN public.analysis_tasks.task_type IS '任务类型: food(图片分析) / food_text(文字分析) / health_report(健康报告)';
