CREATE TABLE IF NOT EXISTS public.user_food_expiry_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  food_name text NOT NULL,
  quantity_text text NULL,
  storage_location text NULL,
  note text NULL,
  deadline_at timestamp with time zone NOT NULL,
  deadline_precision text NOT NULL DEFAULT 'date',
  completed_at timestamp with time zone NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_food_expiry_items_pkey PRIMARY KEY (id),
  CONSTRAINT user_food_expiry_items_deadline_precision_check CHECK (
    deadline_precision = ANY (ARRAY['date'::text, 'datetime'::text])
  )
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_user_food_expiry_items_user_id
  ON public.user_food_expiry_items(user_id);

CREATE INDEX IF NOT EXISTS idx_user_food_expiry_items_deadline_at
  ON public.user_food_expiry_items(deadline_at);

CREATE INDEX IF NOT EXISTS idx_user_food_expiry_items_completed_at
  ON public.user_food_expiry_items(completed_at);

CREATE OR REPLACE FUNCTION update_user_food_expiry_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_food_expiry_items_updated_at ON public.user_food_expiry_items;
CREATE TRIGGER trigger_update_user_food_expiry_items_updated_at
  BEFORE UPDATE ON public.user_food_expiry_items
  FOR EACH ROW
  EXECUTE FUNCTION update_user_food_expiry_items_updated_at();

COMMENT ON TABLE public.user_food_expiry_items IS '用户手动维护的食物保质期/吃完期限清单';
COMMENT ON COLUMN public.user_food_expiry_items.food_name IS '食物名称';
COMMENT ON COLUMN public.user_food_expiry_items.quantity_text IS '数量描述，如 2盒/半袋';
COMMENT ON COLUMN public.user_food_expiry_items.storage_location IS '存放位置，如 常温/冷藏/冷冻';
COMMENT ON COLUMN public.user_food_expiry_items.note IS '备注';
COMMENT ON COLUMN public.user_food_expiry_items.deadline_at IS '用户设置的吃完截止时间';
COMMENT ON COLUMN public.user_food_expiry_items.deadline_precision IS '截止精度：date(仅日期)/datetime(日期+时间)';
COMMENT ON COLUMN public.user_food_expiry_items.completed_at IS '标记已吃完时间，NULL 表示仍待处理';
