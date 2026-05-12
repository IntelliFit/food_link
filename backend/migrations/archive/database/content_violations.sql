-- 内容违规记录表
-- 用于存储 AI 审核检测到的违规内容，包括食物分析违规和评论违规
CREATE TABLE public.content_violations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_openid text NOT NULL,
  user_id uuid NOT NULL,
  violation_type text NOT NULL,
  violation_category text NOT NULL,
  violation_reason text NOT NULL,
  reference_id uuid NULL,
  image_url text NULL,
  text_content text NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT content_violations_pkey PRIMARY KEY (id),
  CONSTRAINT content_violations_user_id_fkey FOREIGN KEY (user_id) REFERENCES weapp_user (id) ON DELETE CASCADE,
  CONSTRAINT content_violations_type_check CHECK (
    violation_type = ANY (ARRAY['food_analysis'::text, 'comment'::text])
  ),
  CONSTRAINT content_violations_category_check CHECK (
    violation_category = ANY (ARRAY[
      'pornography'::text,
      'violence'::text,
      'politics'::text,
      'irrelevant_image'::text,
      'inappropriate_text'::text,
      'crime'::text,
      'harassment'::text,
      'spam'::text,
      'other'::text
    ])
  )
) TABLESPACE pg_default;

-- 索引：按用户查询违规记录
CREATE INDEX idx_content_violations_user_id ON public.content_violations USING btree (user_id) TABLESPACE pg_default;

-- 索引：按违规类型查询
CREATE INDEX idx_content_violations_type ON public.content_violations USING btree (violation_type) TABLESPACE pg_default;

-- 索引：按关联记录 ID 查询
CREATE INDEX idx_content_violations_reference_id ON public.content_violations USING btree (reference_id) TABLESPACE pg_default;

-- 索引：按创建时间排序
CREATE INDEX idx_content_violations_created_at ON public.content_violations USING btree (created_at) TABLESPACE pg_default;

-- 字段注释
COMMENT ON TABLE public.content_violations IS '内容违规记录表，记录 AI 审核检测到的违规内容';
COMMENT ON COLUMN public.content_violations.user_openid IS '违规用户的微信 openid';
COMMENT ON COLUMN public.content_violations.user_id IS '违规用户 ID，关联 weapp_user';
COMMENT ON COLUMN public.content_violations.violation_type IS '违规来源类型: food_analysis(食物分析违规) / comment(评论违规)';
COMMENT ON COLUMN public.content_violations.violation_category IS '违规内容分类: pornography/violence/politics/irrelevant_image/inappropriate_text/crime/other';
COMMENT ON COLUMN public.content_violations.violation_reason IS 'AI 返回的详细违规原因';
COMMENT ON COLUMN public.content_violations.reference_id IS '关联的原始记录 ID（analysis_tasks.id 或 comment.id）';
COMMENT ON COLUMN public.content_violations.image_url IS '违规图片 URL（如适用）';
COMMENT ON COLUMN public.content_violations.text_content IS '违规文本内容（如适用）';
