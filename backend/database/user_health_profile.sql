-- ============================================================
-- 深度个性化健康档案 (Professional Onboarding)
-- 扩展 weapp_user 表 + 健康报告 OCR 导入表
--
-- 【必须执行】保存健康档案接口依赖本脚本：
-- 1. 打开你的 PostgreSQL 客户端
-- 2. 新建查询，粘贴本文件全部内容并执行
-- 3. 未执行时接口可能返回 200 但数据库不会写入新字段
-- ============================================================

-- 1. 扩展 weapp_user 表：生理指标、健康背景、代谢结果
ALTER TABLE public.weapp_user
  ADD COLUMN IF NOT EXISTS height numeric,
  ADD COLUMN IF NOT EXISTS weight numeric,
  ADD COLUMN IF NOT EXISTS birthday date,
  ADD COLUMN IF NOT EXISTS gender text CHECK (gender IN ('male', 'female', 'other', '')),
  ADD COLUMN IF NOT EXISTS activity_level text CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active', '')),
  ADD COLUMN IF NOT EXISTS health_condition jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS bmr numeric,
  ADD COLUMN IF NOT EXISTS tdee numeric,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS execution_mode text DEFAULT 'standard' CHECK (execution_mode IN ('standard', 'strict')),
  ADD COLUMN IF NOT EXISTS mode_set_by text DEFAULT 'system' CHECK (mode_set_by IN ('system', 'user_manual', 'coach_manual')),
  ADD COLUMN IF NOT EXISTS mode_set_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS mode_reason text,
  ADD COLUMN IF NOT EXISTS mode_commitment_days integer DEFAULT 14,
  ADD COLUMN IF NOT EXISTS mode_switch_count_30d integer DEFAULT 0;

COMMENT ON COLUMN public.weapp_user.height IS '身高(cm)';
COMMENT ON COLUMN public.weapp_user.weight IS '体重(kg)';
COMMENT ON COLUMN public.weapp_user.birthday IS '出生日期，用于计算年龄';
COMMENT ON COLUMN public.weapp_user.gender IS '性别: male/female/other';
COMMENT ON COLUMN public.weapp_user.activity_level IS '日常活动水平: sedentary/light/moderate/active/very_active';
COMMENT ON COLUMN public.weapp_user.health_condition IS 'JSON: medical_history[], diet_preference[], allergies[], ocr_notes';
COMMENT ON COLUMN public.weapp_user.bmr IS '基础代谢率(kcal/天)';
COMMENT ON COLUMN public.weapp_user.tdee IS '每日总能量消耗(kcal/天)';
COMMENT ON COLUMN public.weapp_user.onboarding_completed IS '是否已完成首次健康档案问卷';
COMMENT ON COLUMN public.weapp_user.execution_mode IS '执行模式: standard(标准)/strict(精准)';
COMMENT ON COLUMN public.weapp_user.mode_set_by IS '模式设置来源: system/user_manual/coach_manual';
COMMENT ON COLUMN public.weapp_user.mode_set_at IS '最近一次模式设置时间';
COMMENT ON COLUMN public.weapp_user.mode_reason IS '模式设置原因编码';
COMMENT ON COLUMN public.weapp_user.mode_commitment_days IS '建议承诺期天数';
COMMENT ON COLUMN public.weapp_user.mode_switch_count_30d IS '近30天模式切换次数（简化计数）';

-- 2. 健康报告/体检报告 OCR 导入记录表（可选，用于快速导入）
CREATE TABLE IF NOT EXISTS public.user_health_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  document_type text DEFAULT 'report' CHECK (document_type IN ('report', 'record', 'other')),
  image_url text,
  extracted_content jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_health_documents_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_user_health_documents_user_id ON public.user_health_documents(user_id);

COMMENT ON TABLE public.user_health_documents IS '用户上传的体检报告/病例截图，OCR 解析结果';

-- 3. 用户模式切换日志（可选，用于埋点与策略分析）
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

CREATE INDEX IF NOT EXISTS idx_user_mode_switch_logs_user_id ON public.user_mode_switch_logs(user_id);

-- 3. 体检报告图片存储桶（在腾讯云 COS 控制台中手动创建）
-- 桶名：health-reports
-- 权限：Public（允许公网读，供多模态模型通过 URL 识别）
-- 路径示例：{user_id}/{uuid}.jpg
