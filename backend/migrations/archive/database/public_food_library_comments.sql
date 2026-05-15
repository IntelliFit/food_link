-- 公共食物库评论表（如果已存在请跳过此 SQL）
CREATE TABLE IF NOT EXISTS public.public_food_library_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  library_item_id uuid NOT NULL,
  content text NOT NULL,
  rating integer NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT public_food_library_comments_pkey PRIMARY KEY (id),
  CONSTRAINT public_food_library_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES weapp_user (id) ON DELETE CASCADE,
  CONSTRAINT public_food_library_comments_library_item_id_fkey FOREIGN KEY (library_item_id) REFERENCES public_food_library (id) ON DELETE CASCADE,
  CONSTRAINT public_food_library_comments_rating_check CHECK (
    (rating IS NULL) OR (rating >= 1 AND rating <= 5)
  )
) TABLESPACE pg_default;

-- 索引：按食物库条目查询评论
CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_library_item_id 
  ON public.public_food_library_comments USING btree (library_item_id) TABLESPACE pg_default;

-- 索引：按用户查询评论
CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_user_id 
  ON public.public_food_library_comments USING btree (user_id) TABLESPACE pg_default;

-- 索引：按创建时间排序
CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_created_at 
  ON public.public_food_library_comments USING btree (created_at DESC) TABLESPACE pg_default;

COMMENT ON TABLE public.public_food_library_comments IS '公共食物库评论表';
COMMENT ON COLUMN public.public_food_library_comments.library_item_id IS '关联的食物库条目 ID';
COMMENT ON COLUMN public.public_food_library_comments.rating IS '评分（可选 1-5）';
