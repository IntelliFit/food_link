ALTER TABLE public.feed_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid NULL REFERENCES public.feed_comments(id) ON DELETE CASCADE;

ALTER TABLE public.feed_comments
  ADD COLUMN IF NOT EXISTS reply_to_user_id uuid NULL REFERENCES public.weapp_user(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_feed_comments_parent_comment_id ON public.feed_comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_feed_comments_reply_to_user_id ON public.feed_comments(reply_to_user_id);
