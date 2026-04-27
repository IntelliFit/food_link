-- 运动记录 + analysis_tasks.task_type 补充（在 PostgreSQL ????/SQL ???? 中整段执行）
-- 修复：1) public.user_exercise_logs 不存在导致 GET /api/exercise-logs 500
--       2) task_type='exercise' 违反 analysis_tasks_task_type_check 导致 POST 失败

-- ---------- 1. 运动记录表 ----------
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

-- ---------- 2. 扩展 task_type 检查（含 exercise 与 debug 队列类型）----------
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
