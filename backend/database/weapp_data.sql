-- 创建 weapp_user 表
CREATE TABLE public.weapp_user (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  openid text NOT NULL,
  unionid text,
  avatar text DEFAULT '',
  nickname text DEFAULT '',
  telephone text,
  create_time timestamp with time zone DEFAULT now(),
  update_time timestamp with time zone DEFAULT now(),
  CONSTRAINT weapp_user_pkey PRIMARY KEY (id),
  CONSTRAINT weapp_user_openid_unique UNIQUE (openid),
  CONSTRAINT weapp_user_unionid_unique UNIQUE (unionid)
);

-- 创建索引（提升查询性能）
CREATE INDEX idx_weapp_user_openid ON public.weapp_user(openid);
CREATE INDEX idx_weapp_user_unionid ON public.weapp_user(unionid) WHERE unionid IS NOT NULL;

-- 创建更新时间触发器函数
CREATE OR REPLACE FUNCTION update_weapp_user_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.update_time = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 创建触发器（自动更新 update_time）
CREATE TRIGGER trigger_update_weapp_user_updated_at
    BEFORE UPDATE ON public.weapp_user
    FOR EACH ROW
    EXECUTE FUNCTION update_weapp_user_updated_at();