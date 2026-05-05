-- ============================================================
-- 扩展 food_nutrition_library 营养字段
-- 执行位置：Supabase Dashboard -> SQL Editor
-- ============================================================

ALTER TABLE public.food_nutrition_library
  ADD COLUMN IF NOT EXISTS fiber_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sugar_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saturated_fat_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cholesterol_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sodium_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS potassium_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calcium_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iron_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS magnesium_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS zinc_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vitamin_a_rae_mcg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vitamin_c_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vitamin_d_mcg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vitamin_e_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vitamin_k_mcg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS thiamin_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS riboflavin_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS niacin_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vitamin_b6_mg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS folate_mcg_per_100g numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vitamin_b12_mcg_per_100g numeric NOT NULL DEFAULT 0;
