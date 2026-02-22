-- 公共食物库支持多图：新增 image_paths (jsonb)，保留 image_path 作首图/兼容
ALTER TABLE public.public_food_library
  ADD COLUMN IF NOT EXISTS image_paths jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.public_food_library.image_paths IS '多图 URL 列表，首张与 image_path 一致时以 image_paths 为准展示';
