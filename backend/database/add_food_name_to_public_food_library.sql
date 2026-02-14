-- ============================================================
-- 为 public_food_library 表添加食物名称字段
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 添加 food_name 字段
ALTER TABLE public.public_food_library
ADD COLUMN IF NOT EXISTS food_name text;

-- 添加索引以支持按食物名称搜索
CREATE INDEX IF NOT EXISTS idx_public_food_library_food_name ON public.public_food_library(food_name);

-- 添加字段注释
COMMENT ON COLUMN public.public_food_library.food_name IS '食物名称（用户填写）';
