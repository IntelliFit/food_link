-- 为用户表添加「最后一次查看识别记录列表」的时间戳
-- 用于前端红点提醒：当 waiting_record > 0 且存在任务的 created_at > last_seen 时显示红点
ALTER TABLE public.weapp_user
  ADD COLUMN IF NOT EXISTS last_seen_analyze_history_at timestamp with time zone;
