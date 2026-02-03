-- ============================================================
-- 公共食物库：带地理位置/商家信息的健康饮食红黑榜
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 公共食物库主表
CREATE TABLE IF NOT EXISTS public.public_food_library (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  -- 若从个人记录分享，关联来源记录
  source_record_id uuid REFERENCES public.user_food_records(id) ON DELETE SET NULL,
  -- 图片
  image_path text,
  -- AI 标签（自动识别）
  total_calories numeric DEFAULT 0,
  total_protein numeric DEFAULT 0,
  total_carbs numeric DEFAULT 0,
  total_fat numeric DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]',
  description text,
  insight text,
  -- 用户标签（手动填写）
  merchant_name text,
  merchant_address text,
  taste_rating smallint CHECK (taste_rating IS NULL OR (taste_rating >= 1 AND taste_rating <= 5)),
  suitable_for_fat_loss boolean DEFAULT false,
  user_tags jsonb DEFAULT '[]',
  user_notes text,
  -- 地理位置
  latitude numeric,
  longitude numeric,
  city text,
  district text,
  -- 状态与审核
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'pending_review', 'published', 'rejected', 'hidden')),
  audit_reject_reason text,
  published_at timestamp with time zone,
  -- 统计缓存（定期更新或触发器更新）
  like_count integer DEFAULT 0,
  comment_count integer DEFAULT 0,
  avg_rating numeric DEFAULT 0,
  -- 时间戳
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT public_food_library_pkey PRIMARY KEY (id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_public_food_library_user_id ON public.public_food_library(user_id);
CREATE INDEX IF NOT EXISTS idx_public_food_library_status ON public.public_food_library(status);
CREATE INDEX IF NOT EXISTS idx_public_food_library_published_at ON public.public_food_library(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_food_library_city ON public.public_food_library(city);
CREATE INDEX IF NOT EXISTS idx_public_food_library_suitable ON public.public_food_library(suitable_for_fat_loss);
CREATE INDEX IF NOT EXISTS idx_public_food_library_merchant ON public.public_food_library(merchant_name);
CREATE INDEX IF NOT EXISTS idx_public_food_library_like_count ON public.public_food_library(like_count DESC);

COMMENT ON TABLE public.public_food_library IS '公共食物库：用户分享的健康餐/外卖，带商家与地理位置';
COMMENT ON COLUMN public.public_food_library.source_record_id IS '若从个人饮食记录分享，关联来源记录 ID';
COMMENT ON COLUMN public.public_food_library.merchant_name IS '商家名称（用户填写）';
COMMENT ON COLUMN public.public_food_library.taste_rating IS '口味评分 1-5';
COMMENT ON COLUMN public.public_food_library.suitable_for_fat_loss IS '是否适合减脂';
COMMENT ON COLUMN public.public_food_library.user_tags IS '用户自定义标签数组，如 ["少油","高蛋白"]';
COMMENT ON COLUMN public.public_food_library.status IS '状态: draft/pending_review/published/rejected/hidden';

-- ============================================================
-- 公共食物库点赞表
-- ============================================================
CREATE TABLE IF NOT EXISTS public.public_food_library_likes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  library_item_id uuid NOT NULL REFERENCES public.public_food_library(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT public_food_library_likes_pkey PRIMARY KEY (id),
  CONSTRAINT public_food_library_likes_unique UNIQUE (user_id, library_item_id)
);

CREATE INDEX IF NOT EXISTS idx_public_food_library_likes_item ON public.public_food_library_likes(library_item_id);
CREATE INDEX IF NOT EXISTS idx_public_food_library_likes_user ON public.public_food_library_likes(user_id);

COMMENT ON TABLE public.public_food_library_likes IS '公共食物库点赞';

-- ============================================================
-- 公共食物库评论表（含可选评分）
-- ============================================================
CREATE TABLE IF NOT EXISTS public.public_food_library_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  library_item_id uuid NOT NULL REFERENCES public.public_food_library(id) ON DELETE CASCADE,
  content text NOT NULL,
  rating smallint CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT public_food_library_comments_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_item ON public.public_food_library_comments(library_item_id);
CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_user ON public.public_food_library_comments(user_id);

COMMENT ON TABLE public.public_food_library_comments IS '公共食物库评论（含可选评分）';
COMMENT ON COLUMN public.public_food_library_comments.rating IS '评论时可选评分 1-5';

-- ============================================================
-- 触发器：自动更新 updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_public_food_library_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_public_food_library_updated_at ON public.public_food_library;
CREATE TRIGGER trg_public_food_library_updated_at
  BEFORE UPDATE ON public.public_food_library
  FOR EACH ROW
  EXECUTE FUNCTION update_public_food_library_updated_at();

-- ============================================================
-- 触发器：点赞时更新 like_count
-- ============================================================
CREATE OR REPLACE FUNCTION update_library_like_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.public_food_library SET like_count = like_count + 1 WHERE id = NEW.library_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.public_food_library SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.library_item_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_library_like_count ON public.public_food_library_likes;
CREATE TRIGGER trg_library_like_count
  AFTER INSERT OR DELETE ON public.public_food_library_likes
  FOR EACH ROW
  EXECUTE FUNCTION update_library_like_count();

-- ============================================================
-- 触发器：评论时更新 comment_count 和 avg_rating
-- ============================================================
CREATE OR REPLACE FUNCTION update_library_comment_stats()
RETURNS TRIGGER AS $$
DECLARE
  new_count integer;
  new_avg numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT COUNT(*), COALESCE(AVG(rating), 0)
      INTO new_count, new_avg
      FROM public.public_food_library_comments
      WHERE library_item_id = NEW.library_item_id;
    UPDATE public.public_food_library
      SET comment_count = new_count, avg_rating = ROUND(new_avg, 1)
      WHERE id = NEW.library_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT COUNT(*), COALESCE(AVG(rating), 0)
      INTO new_count, new_avg
      FROM public.public_food_library_comments
      WHERE library_item_id = OLD.library_item_id;
    UPDATE public.public_food_library
      SET comment_count = new_count, avg_rating = ROUND(new_avg, 1)
      WHERE id = OLD.library_item_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_library_comment_stats ON public.public_food_library_comments;
CREATE TRIGGER trg_library_comment_stats
  AFTER INSERT OR DELETE ON public.public_food_library_comments
  FOR EACH ROW
  EXECUTE FUNCTION update_library_comment_stats();
