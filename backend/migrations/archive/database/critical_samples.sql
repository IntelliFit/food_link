-- ============================================================
-- AI 偏差样本表：用户标记「AI 估算偏差大」的样本，用于后续模型优化
--
-- 【必须执行】标记样本接口依赖本脚本：
-- 1. 打开 Supabase Dashboard → SQL Editor
-- 2. 新建查询，粘贴本文件全部内容并执行
--
-- 若表已存在但报错缺少 image_path 列，请执行：
--   database/critical_samples_add_image_path.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.critical_samples_weapp (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  image_path text,
  food_name text NOT NULL,
  ai_weight numeric NOT NULL,
  user_weight numeric NOT NULL,
  deviation_percent numeric NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT critical_samples_weapp_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_critical_samples_weapp_user_id ON public.critical_samples_weapp(user_id);
CREATE INDEX IF NOT EXISTS idx_critical_samples_weapp_created_at ON public.critical_samples_weapp(created_at);

COMMENT ON TABLE public.critical_samples_weapp IS '用户手动标记的 AI 重量估算偏差样本（用于模型优化）';
COMMENT ON COLUMN public.critical_samples_weapp.ai_weight IS 'AI 估算重量（克）';
COMMENT ON COLUMN public.critical_samples_weapp.user_weight IS '用户修正后的重量（克）';
COMMENT ON COLUMN public.critical_samples_weapp.deviation_percent IS '偏差百分比，如 50 表示 +50%，-30 表示 -30%';
