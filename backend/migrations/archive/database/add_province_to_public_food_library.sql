-- ============================================================
-- 为 public_food_library 表添加省份字段
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 添加 province 字段
ALTER TABLE public.public_food_library
ADD COLUMN IF NOT EXISTS province text;

-- 添加索引以支持按省份查询
CREATE INDEX IF NOT EXISTS idx_public_food_library_province ON public.public_food_library(province);

-- 添加字段注释
COMMENT ON COLUMN public.public_food_library.province IS '省份/直辖市（用户填写或从地址解析）';
