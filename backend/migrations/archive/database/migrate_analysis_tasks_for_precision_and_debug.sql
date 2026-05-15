-- 为已存在的 analysis_tasks 表补齐精准模式 / debug 队列 task_type，
-- 同时补齐运行时代码实际会写入的 status 枚举。

ALTER TABLE public.analysis_tasks
  DROP CONSTRAINT IF EXISTS analysis_tasks_status_check;

ALTER TABLE public.analysis_tasks
  ADD CONSTRAINT analysis_tasks_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'pending'::text,
        'processing'::text,
        'done'::text,
        'failed'::text,
        'cancelled'::text,
        'timed_out'::text,
        'violated'::text
      ]
    )
  );

ALTER TABLE public.analysis_tasks
  DROP CONSTRAINT IF EXISTS analysis_tasks_task_type_check;

ALTER TABLE public.analysis_tasks
  ADD CONSTRAINT analysis_tasks_task_type_check
  CHECK (
    task_type = ANY (
      ARRAY[
        'food'::text,
        'food_text'::text,
        'precision_plan'::text,
        'precision_item_estimate'::text,
        'precision_aggregate'::text,
        'health_report'::text,
        'public_food_library_text'::text,
        'exercise'::text
      ]
    )
    OR task_type ~ '^(food|food_text|precision_plan|precision_item_estimate|precision_aggregate)_debug(_[a-z0-9_]+)?$'
  );

COMMENT ON COLUMN public.analysis_tasks.status IS
'pending / processing / done / failed / cancelled / timed_out / violated';

COMMENT ON COLUMN public.analysis_tasks.task_type IS
'food / food_text / precision_* / *_debug / *_debug_<suffix> / health_report / public_food_library_text / exercise';
