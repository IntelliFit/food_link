-- ============================================================
-- 拍照识别后的饮食记录表（确认记录并选择餐次后落库）
--
-- 【必须执行】确认记录接口依赖本脚本：
-- 1. 打开 Supabase Dashboard → SQL Editor
-- 2. 新建查询，粘贴本文件全部内容并执行
-- ============================================================

-- 饮食记录表：每一条为一次「确认记录」的餐食（含餐次、识别结果、营养汇总）
CREATE TABLE IF NOT EXISTS public.user_food_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  meal_type text NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  image_path text,
  description text,
  insight text,
  items jsonb NOT NULL DEFAULT '[]',
  total_calories numeric DEFAULT 0,
  total_protein numeric DEFAULT 0,
  total_carbs numeric DEFAULT 0,
  total_fat numeric DEFAULT 0,
  total_weight_grams integer DEFAULT 0,
  record_time timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_food_records_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_user_food_records_user_id ON public.user_food_records(user_id);
CREATE INDEX IF NOT EXISTS idx_user_food_records_record_time ON public.user_food_records(record_time);
CREATE INDEX IF NOT EXISTS idx_user_food_records_meal_type ON public.user_food_records(meal_type);

COMMENT ON TABLE public.user_food_records IS '用户拍照识别后确认记录的饮食条目（含餐次：早餐/午餐/晚餐/加餐）';
COMMENT ON COLUMN public.user_food_records.meal_type IS '餐次: breakfast/lunch/dinner/snack';
COMMENT ON COLUMN public.user_food_records.items IS '食物项 JSON 数组：name, weight, ratio, intake, nutrients';
COMMENT ON COLUMN public.user_food_records.record_time IS '记录时间（用户确认时）';
