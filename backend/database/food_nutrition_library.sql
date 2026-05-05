-- ============================================================
-- 食物营养查表：标准库 + 别名 + 未命中日志
-- 执行位置：Supabase Dashboard -> SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.food_nutrition_library (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  kcal_per_100g numeric NOT NULL DEFAULT 0,
  protein_per_100g numeric NOT NULL DEFAULT 0,
  carbs_per_100g numeric NOT NULL DEFAULT 0,
  fat_per_100g numeric NOT NULL DEFAULT 0,
  fiber_per_100g numeric NOT NULL DEFAULT 0,
  sugar_per_100g numeric NOT NULL DEFAULT 0,
  saturated_fat_per_100g numeric NOT NULL DEFAULT 0,
  cholesterol_mg_per_100g numeric NOT NULL DEFAULT 0,
  sodium_mg_per_100g numeric NOT NULL DEFAULT 0,
  potassium_mg_per_100g numeric NOT NULL DEFAULT 0,
  calcium_mg_per_100g numeric NOT NULL DEFAULT 0,
  iron_mg_per_100g numeric NOT NULL DEFAULT 0,
  magnesium_mg_per_100g numeric NOT NULL DEFAULT 0,
  zinc_mg_per_100g numeric NOT NULL DEFAULT 0,
  vitamin_a_rae_mcg_per_100g numeric NOT NULL DEFAULT 0,
  vitamin_c_mg_per_100g numeric NOT NULL DEFAULT 0,
  vitamin_d_mcg_per_100g numeric NOT NULL DEFAULT 0,
  vitamin_e_mg_per_100g numeric NOT NULL DEFAULT 0,
  vitamin_k_mcg_per_100g numeric NOT NULL DEFAULT 0,
  thiamin_mg_per_100g numeric NOT NULL DEFAULT 0,
  riboflavin_mg_per_100g numeric NOT NULL DEFAULT 0,
  niacin_mg_per_100g numeric NOT NULL DEFAULT 0,
  vitamin_b6_mg_per_100g numeric NOT NULL DEFAULT 0,
  folate_mcg_per_100g numeric NOT NULL DEFAULT 0,
  vitamin_b12_mcg_per_100g numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  source text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT food_nutrition_library_pkey PRIMARY KEY (id),
  CONSTRAINT food_nutrition_library_normalized_name_key UNIQUE (normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_food_nutrition_library_canonical_name
  ON public.food_nutrition_library(canonical_name);

CREATE INDEX IF NOT EXISTS idx_food_nutrition_library_is_active
  ON public.food_nutrition_library(is_active);

COMMENT ON TABLE public.food_nutrition_library IS '标准食物营养库（单位：每100g）';
COMMENT ON COLUMN public.food_nutrition_library.canonical_name IS '标准食物名（展示名）';
COMMENT ON COLUMN public.food_nutrition_library.normalized_name IS '规范化名称（用于匹配）';
COMMENT ON COLUMN public.food_nutrition_library.kcal_per_100g IS '每100g热量（kcal）';
COMMENT ON COLUMN public.food_nutrition_library.protein_per_100g IS '每100g蛋白质（g）';
COMMENT ON COLUMN public.food_nutrition_library.carbs_per_100g IS '每100g碳水（g）';
COMMENT ON COLUMN public.food_nutrition_library.fat_per_100g IS '每100g脂肪（g）';
COMMENT ON COLUMN public.food_nutrition_library.fiber_per_100g IS '每100g膳食纤维（g）';
COMMENT ON COLUMN public.food_nutrition_library.sugar_per_100g IS '每100g糖（g）';
COMMENT ON COLUMN public.food_nutrition_library.saturated_fat_per_100g IS '每100g饱和脂肪（g）';
COMMENT ON COLUMN public.food_nutrition_library.cholesterol_mg_per_100g IS '每100g胆固醇（mg）';
COMMENT ON COLUMN public.food_nutrition_library.sodium_mg_per_100g IS '每100g钠（mg）';
COMMENT ON COLUMN public.food_nutrition_library.potassium_mg_per_100g IS '每100g钾（mg）';
COMMENT ON COLUMN public.food_nutrition_library.calcium_mg_per_100g IS '每100g钙（mg）';
COMMENT ON COLUMN public.food_nutrition_library.iron_mg_per_100g IS '每100g铁（mg）';
COMMENT ON COLUMN public.food_nutrition_library.magnesium_mg_per_100g IS '每100g镁（mg）';
COMMENT ON COLUMN public.food_nutrition_library.zinc_mg_per_100g IS '每100g锌（mg）';
COMMENT ON COLUMN public.food_nutrition_library.vitamin_a_rae_mcg_per_100g IS '每100g维生素A（RAE, mcg）';
COMMENT ON COLUMN public.food_nutrition_library.vitamin_c_mg_per_100g IS '每100g维生素C（mg）';
COMMENT ON COLUMN public.food_nutrition_library.vitamin_d_mcg_per_100g IS '每100g维生素D（mcg）';
COMMENT ON COLUMN public.food_nutrition_library.vitamin_e_mg_per_100g IS '每100g维生素E（mg）';
COMMENT ON COLUMN public.food_nutrition_library.vitamin_k_mcg_per_100g IS '每100g维生素K（mcg）';
COMMENT ON COLUMN public.food_nutrition_library.thiamin_mg_per_100g IS '每100g维生素B1/硫胺素（mg）';
COMMENT ON COLUMN public.food_nutrition_library.riboflavin_mg_per_100g IS '每100g维生素B2/核黄素（mg）';
COMMENT ON COLUMN public.food_nutrition_library.niacin_mg_per_100g IS '每100g烟酸（mg）';
COMMENT ON COLUMN public.food_nutrition_library.vitamin_b6_mg_per_100g IS '每100g维生素B6（mg）';
COMMENT ON COLUMN public.food_nutrition_library.folate_mcg_per_100g IS '每100g叶酸（DFE, mcg）';
COMMENT ON COLUMN public.food_nutrition_library.vitamin_b12_mcg_per_100g IS '每100g维生素B12（mcg）';


CREATE TABLE IF NOT EXISTS public.food_nutrition_aliases (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  food_id uuid NOT NULL REFERENCES public.food_nutrition_library(id) ON DELETE CASCADE,
  alias_name text NOT NULL,
  normalized_alias text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT food_nutrition_aliases_pkey PRIMARY KEY (id),
  CONSTRAINT food_nutrition_aliases_normalized_alias_key UNIQUE (normalized_alias)
);

CREATE INDEX IF NOT EXISTS idx_food_nutrition_aliases_food_id
  ON public.food_nutrition_aliases(food_id);

COMMENT ON TABLE public.food_nutrition_aliases IS '食物别名映射（同物多名）';
COMMENT ON COLUMN public.food_nutrition_aliases.alias_name IS '别名原文';
COMMENT ON COLUMN public.food_nutrition_aliases.normalized_alias IS '规范化别名';


CREATE TABLE IF NOT EXISTS public.food_unresolved_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.analysis_tasks(id) ON DELETE SET NULL,
  raw_name text NOT NULL,
  normalized_name text NOT NULL,
  hit_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  sample_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT food_unresolved_logs_pkey PRIMARY KEY (id),
  CONSTRAINT food_unresolved_logs_normalized_name_key UNIQUE (normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_food_unresolved_logs_hit_count
  ON public.food_unresolved_logs(hit_count DESC);

CREATE INDEX IF NOT EXISTS idx_food_unresolved_logs_last_seen_at
  ON public.food_unresolved_logs(last_seen_at DESC);

COMMENT ON TABLE public.food_unresolved_logs IS '未收录食物名日志（用于补库优先级）';
COMMENT ON COLUMN public.food_unresolved_logs.hit_count IS '出现频次';
COMMENT ON COLUMN public.food_unresolved_logs.sample_payload IS '最近一次样本（如重量、来源任务）';
