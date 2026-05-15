-- ============================================================
-- 圈子动态点赞与评论：针对好友的饮食记录（user_food_records）
-- 在 Supabase SQL Editor 中执行（需先存在 user_food_records 表）
-- ============================================================

-- 动态点赞：用户对某条饮食记录的点赞
CREATE TABLE IF NOT EXISTS public.feed_likes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  record_id uuid NOT NULL REFERENCES public.user_food_records(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT feed_likes_pkey PRIMARY KEY (id),
  CONSTRAINT feed_likes_unique UNIQUE (user_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_likes_record_id ON public.feed_likes(record_id);
CREATE INDEX IF NOT EXISTS idx_feed_likes_user_id ON public.feed_likes(user_id);

COMMENT ON TABLE public.feed_likes IS '圈子动态点赞：对好友饮食记录的点赞';

-- 动态评论
CREATE TABLE IF NOT EXISTS public.feed_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  record_id uuid NOT NULL REFERENCES public.user_food_records(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT feed_comments_pkey PRIMARY KEY (id)
);

-- 兼容老库：若 feed_comments 已存在旧结构，需要补回复相关字段
ALTER TABLE public.feed_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid NULL REFERENCES public.feed_comments(id) ON DELETE CASCADE;

ALTER TABLE public.feed_comments
  ADD COLUMN IF NOT EXISTS reply_to_user_id uuid NULL REFERENCES public.weapp_user(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_feed_comments_record_id ON public.feed_comments(record_id);
CREATE INDEX IF NOT EXISTS idx_feed_comments_user_id ON public.feed_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_comments_parent_comment_id ON public.feed_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_feed_comments_reply_to_user_id ON public.feed_comments(reply_to_user_id);

COMMENT ON TABLE public.feed_comments IS '圈子动态评论：对好友饮食记录的评论';
COMMENT ON COLUMN public.feed_comments.parent_comment_id IS '父评论 ID；为空表示直接评论动态';
COMMENT ON COLUMN public.feed_comments.reply_to_user_id IS '被回复用户 ID；为空表示直接评论动态';
