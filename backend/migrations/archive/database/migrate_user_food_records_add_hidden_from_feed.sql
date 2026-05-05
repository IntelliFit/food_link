-- 为 user_food_records 增加 hidden_from_feed 字段
-- 用于"从圈子撤回动态"而不删除底层饮食记录
-- 默认 false，设为 true 后该记录不再出现在好友/公共 Feed 中

ALTER TABLE public.user_food_records
  ADD COLUMN IF NOT EXISTS hidden_from_feed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_user_food_records_hidden_from_feed
  ON public.user_food_records (hidden_from_feed)
  WHERE hidden_from_feed = false;
