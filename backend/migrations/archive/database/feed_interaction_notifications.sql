-- 圈子互动通知：点赞 / 评论 / 回复 / 评论审核失败
CREATE TABLE IF NOT EXISTS public.feed_interaction_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  actor_user_id uuid NULL REFERENCES public.weapp_user(id) ON DELETE SET NULL,
  record_id uuid NULL REFERENCES public.user_food_records(id) ON DELETE CASCADE,
  comment_id uuid NULL REFERENCES public.feed_comments(id) ON DELETE CASCADE,
  parent_comment_id uuid NULL REFERENCES public.feed_comments(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  content_preview text NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  read_at timestamp with time zone NULL,
  CONSTRAINT feed_interaction_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT feed_interaction_notifications_type_check CHECK (
    notification_type = ANY (ARRAY[
      'like_received'::text,
      'comment_received'::text,
      'reply_received'::text,
      'comment_rejected'::text
    ])
  )
);

CREATE INDEX IF NOT EXISTS idx_feed_interaction_notifications_recipient
  ON public.feed_interaction_notifications(recipient_user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feed_interaction_notifications_record_id
  ON public.feed_interaction_notifications(record_id);

COMMENT ON TABLE public.feed_interaction_notifications IS '圈子互动通知：收到点赞、收到评论、收到回复、评论审核未通过';
COMMENT ON COLUMN public.feed_interaction_notifications.recipient_user_id IS '通知接收人';
COMMENT ON COLUMN public.feed_interaction_notifications.actor_user_id IS '触发动作的人';
COMMENT ON COLUMN public.feed_interaction_notifications.record_id IS '关联的动态记录 ID';
COMMENT ON COLUMN public.feed_interaction_notifications.comment_id IS '关联的新评论 ID';
COMMENT ON COLUMN public.feed_interaction_notifications.parent_comment_id IS '被回复的父评论 ID';
COMMENT ON COLUMN public.feed_interaction_notifications.notification_type IS 'like_received / comment_received / reply_received / comment_rejected';
