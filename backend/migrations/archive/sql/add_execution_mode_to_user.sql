-- ============================================================
-- 执行模式（精准模式）迁移
-- 作用：
-- 1) weapp_user 新增 execution_mode 及相关元数据字段
-- 2) 新增 user_mode_switch_logs 记录模式切换历史
-- ============================================================

ALTER TABLE public.weapp_user
  ADD COLUMN IF NOT EXISTS execution_mode text DEFAULT 'standard'
    CHECK (execution_mode IN ('standard', 'strict')),
  ADD COLUMN IF NOT EXISTS mode_set_by text DEFAULT 'system'
    CHECK (mode_set_by IN ('system', 'user_manual', 'coach_manual')),
  ADD COLUMN IF NOT EXISTS mode_set_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS mode_reason text,
  ADD COLUMN IF NOT EXISTS mode_commitment_days integer DEFAULT 14,
  ADD COLUMN IF NOT EXISTS mode_switch_count_30d integer DEFAULT 0;

COMMENT ON COLUMN public.weapp_user.execution_mode IS '执行模式: standard(标准)/strict(精准)';
COMMENT ON COLUMN public.weapp_user.mode_set_by IS '模式设置来源: system/user_manual/coach_manual';
COMMENT ON COLUMN public.weapp_user.mode_set_at IS '最近一次模式设置时间';
COMMENT ON COLUMN public.weapp_user.mode_reason IS '模式设置原因编码';
COMMENT ON COLUMN public.weapp_user.mode_commitment_days IS '建议承诺期天数';
COMMENT ON COLUMN public.weapp_user.mode_switch_count_30d IS '近30天模式切换次数（简化计数）';

CREATE TABLE IF NOT EXISTS public.user_mode_switch_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  from_mode text NOT NULL CHECK (from_mode IN ('standard', 'strict')),
  to_mode text NOT NULL CHECK (to_mode IN ('standard', 'strict')),
  changed_by text NOT NULL CHECK (changed_by IN ('system', 'user_manual', 'coach_manual')),
  reason_code text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_mode_switch_logs_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_user_mode_switch_logs_user_id
  ON public.user_mode_switch_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_user_mode_switch_logs_created_at
  ON public.user_mode_switch_logs(created_at DESC);

