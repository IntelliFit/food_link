-- 公共食物库用户反馈表
CREATE TABLE IF NOT EXISTS public.public_food_library_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  library_item_id uuid NULL,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT public_food_library_feedback_pkey PRIMARY KEY (id),
  CONSTRAINT public_food_library_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES weapp_user (id) ON DELETE CASCADE,
  CONSTRAINT public_food_library_feedback_library_item_id_fkey FOREIGN KEY (library_item_id) REFERENCES public_food_library (id) ON DELETE SET NULL
) TABLESPACE pg_default;

-- 索引：按食物库条目查询反馈
CREATE INDEX IF NOT EXISTS idx_public_food_library_feedback_library_item_id
  ON public.public_food_library_feedback USING btree (library_item_id) TABLESPACE pg_default;

-- 索引：按用户查询反馈
CREATE INDEX IF NOT EXISTS idx_public_food_library_feedback_user_id
  ON public.public_food_library_feedback USING btree (user_id) TABLESPACE pg_default;

-- 索引：按创建时间排序
CREATE INDEX IF NOT EXISTS idx_public_food_library_feedback_created_at
  ON public.public_food_library_feedback USING btree (created_at DESC) TABLESPACE pg_default;

COMMENT ON TABLE public.public_food_library_feedback IS '公共食物库用户反馈表';
COMMENT ON COLUMN public.public_food_library_feedback.library_item_id IS '关联的食物库条目 ID（可选）';
COMMENT ON COLUMN public.public_food_library_feedback.content IS '反馈内容';
