-- 评论审核任务表
-- 用于异步处理用户提交的评论，先审核后入库
CREATE TABLE public.comment_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  comment_type text NOT NULL,
  target_id uuid NOT NULL,
  content text NOT NULL,
  rating integer NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb NULL,
  error_message text NULL,
  is_violated boolean NOT NULL DEFAULT false,
  violation_reason text NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT comment_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT comment_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES weapp_user (id) ON DELETE CASCADE,
  CONSTRAINT comment_tasks_status_check CHECK (
    status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text, 'violated'::text])
  ),
  CONSTRAINT comment_tasks_type_check CHECK (
    comment_type = ANY (ARRAY['feed'::text, 'public_food_library'::text])
  )
) TABLESPACE pg_default;

-- 索引：按用户查询
CREATE INDEX idx_comment_tasks_user_id ON public.comment_tasks USING btree (user_id) TABLESPACE pg_default;

-- 索引：按状态和类型查询（Worker 抢占任务）
CREATE INDEX idx_comment_tasks_status_type ON public.comment_tasks USING btree (status, comment_type) TABLESPACE pg_default;

-- 索引：按创建时间排序
CREATE INDEX idx_comment_tasks_created_at ON public.comment_tasks USING btree (created_at) TABLESPACE pg_default;

-- 字段注释
COMMENT ON TABLE public.comment_tasks IS '评论审核任务表，用于异步处理评论审核';
COMMENT ON COLUMN public.comment_tasks.comment_type IS '评论类型: feed(圈子评论) / public_food_library(食物库评论)';
COMMENT ON COLUMN public.comment_tasks.target_id IS '目标对象 ID（record_id 或 library_item_id）';
COMMENT ON COLUMN public.comment_tasks.content IS '评论内容';
COMMENT ON COLUMN public.comment_tasks.rating IS '评分（食物库评论可选 1-5）';
COMMENT ON COLUMN public.comment_tasks.status IS '任务状态: pending/processing/done/failed/violated';
COMMENT ON COLUMN public.comment_tasks.result IS '审核通过后写入评论表的结果（包含 comment_id）';
COMMENT ON COLUMN public.comment_tasks.is_violated IS '是否违规（AI 审核标记）';
COMMENT ON COLUMN public.comment_tasks.violation_reason IS '违规原因（AI 审核返回的详细说明）';
