-- 同一用户同一识别任务仅一条饮食记录，避免好友圈子动态重复。
-- 在 PostgreSQL SQL 编辑器中执行一次即可（若已存在同名索引会跳过）。
-- 若报错「duplicate key」说明表中已有重复 (user_id, source_task_id)，需先人工删除多余行再建索引。
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_food_records_user_source_task
  ON public.user_food_records (user_id, source_task_id)
  WHERE source_task_id IS NOT NULL;
