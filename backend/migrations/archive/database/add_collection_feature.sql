-- ============================================================
-- 公共食物库收藏表
-- ============================================================
CREATE TABLE IF NOT EXISTS public.public_food_library_collections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  library_item_id uuid NOT NULL REFERENCES public.public_food_library(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT public_food_library_collections_pkey PRIMARY KEY (id),
  CONSTRAINT public_food_library_collections_unique UNIQUE (user_id, library_item_id)
);

CREATE INDEX IF NOT EXISTS idx_public_food_library_collections_item ON public.public_food_library_collections(library_item_id);
CREATE INDEX IF NOT EXISTS idx_public_food_library_collections_user ON public.public_food_library_collections(user_id);

COMMENT ON TABLE public.public_food_library_collections IS '公共食物库收藏';

-- ============================================================
-- 主表增加收藏计数
-- ============================================================
ALTER TABLE public.public_food_library ADD COLUMN IF NOT EXISTS collection_count integer DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_public_food_library_collection_count ON public.public_food_library(collection_count DESC);

-- ============================================================
-- 触发器：收藏时更新 collection_count
-- ============================================================
CREATE OR REPLACE FUNCTION update_library_collection_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.public_food_library SET collection_count = collection_count + 1 WHERE id = NEW.library_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.public_food_library SET collection_count = GREATEST(collection_count - 1, 0) WHERE id = OLD.library_item_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_library_collection_count ON public.public_food_library_collections;
CREATE TRIGGER trg_library_collection_count
  AFTER INSERT OR DELETE ON public.public_food_library_collections
  FOR EACH ROW
  EXECUTE FUNCTION update_library_collection_count();
