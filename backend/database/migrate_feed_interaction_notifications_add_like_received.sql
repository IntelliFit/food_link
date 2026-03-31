-- 为旧库补齐点赞互动通知类型
ALTER TABLE public.feed_interaction_notifications
  DROP CONSTRAINT IF EXISTS feed_interaction_notifications_type_check;

ALTER TABLE public.feed_interaction_notifications
  ADD CONSTRAINT feed_interaction_notifications_type_check CHECK (
    notification_type = ANY (ARRAY[
      'like_received'::text,
      'comment_received'::text,
      'reply_received'::text,
      'comment_rejected'::text
    ])
  );

COMMENT ON TABLE public.feed_interaction_notifications IS '圈子互动通知：收到点赞、收到评论、收到回复、评论审核未通过';
COMMENT ON COLUMN public.feed_interaction_notifications.notification_type IS 'like_received / comment_received / reply_received / comment_rejected';
