CREATE TABLE IF NOT EXISTS public.food_expiry_notification_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  expiry_item_id uuid NOT NULL REFERENCES public.food_expiry_items(id) ON DELETE CASCADE,
  template_id text NOT NULL,
  openid text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  scheduled_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone NULL,
  last_error text NULL,
  retry_count integer NOT NULL DEFAULT 0,
  max_retry_count integer NOT NULL DEFAULT 3,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT food_expiry_notification_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT food_expiry_notification_jobs_status_check CHECK (
    status = ANY (ARRAY['pending'::text, 'processing'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])
  ),
  CONSTRAINT food_expiry_notification_jobs_retry_count_check CHECK (retry_count >= 0),
  CONSTRAINT food_expiry_notification_jobs_max_retry_count_check CHECK (max_retry_count >= 0),
  CONSTRAINT food_expiry_notification_jobs_item_template_schedule_unique UNIQUE (expiry_item_id, template_id, scheduled_at)
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_food_expiry_notification_jobs_status_schedule
  ON public.food_expiry_notification_jobs(status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_food_expiry_notification_jobs_user_id
  ON public.food_expiry_notification_jobs(user_id);

CREATE INDEX IF NOT EXISTS idx_food_expiry_notification_jobs_expiry_item_id
  ON public.food_expiry_notification_jobs(expiry_item_id);

CREATE OR REPLACE FUNCTION update_food_expiry_notification_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_food_expiry_notification_jobs_updated_at ON public.food_expiry_notification_jobs;
CREATE TRIGGER trigger_update_food_expiry_notification_jobs_updated_at
  BEFORE UPDATE ON public.food_expiry_notification_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_food_expiry_notification_jobs_updated_at();

COMMENT ON TABLE public.food_expiry_notification_jobs IS '食物保质期小程序订阅提醒任务队列';
COMMENT ON COLUMN public.food_expiry_notification_jobs.expiry_item_id IS '关联 food_expiry_items.id';
COMMENT ON COLUMN public.food_expiry_notification_jobs.template_id IS '小程序订阅消息模板 ID';
COMMENT ON COLUMN public.food_expiry_notification_jobs.status IS 'pending/processing/sent/failed/cancelled';
COMMENT ON COLUMN public.food_expiry_notification_jobs.payload_snapshot IS '发送时使用的模板字段快照';
