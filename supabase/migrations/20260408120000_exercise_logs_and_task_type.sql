-- 运动记录表 + analysis_tasks.task_type 扩展（supabase db push / SQL Editor 均可执行）
-- 与 backend/sql/migrate_exercise_logs_and_task_type.sql 内容一致

CREATE TABLE IF NOT EXISTS public.user_exercise_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  exercise_desc text NOT NULL,
  calories_burned integer NOT NULL CHECK (calories_burned >= 0 AND calories_burned <= 5000),
  recorded_on date NOT NULL,
  recorded_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_exercise_logs_user_date
  ON public.user_exercise_logs (user_id, recorded_on);

CREATE INDEX IF NOT EXISTS idx_user_exercise_logs_user_recorded_at
  ON public.user_exercise_logs (user_id, recorded_at DESC);

COMMENT ON TABLE public.user_exercise_logs IS '用户运动记录表';

ALTER TABLE public.analysis_tasks DROP CONSTRAINT IF EXISTS analysis_tasks_task_type_check;

ALTER TABLE public.analysis_tasks ADD CONSTRAINT analysis_tasks_task_type_check CHECK (
  task_type IN (
    'food',
    'food_debug',
    'food_text',
    'food_text_debug',
    'health_report',
    'public_food_library_text',
    'exercise'
  )
);
