-- AI 营养洞察缓存表：按用户、时间范围、日期缓存大模型生成的洞察
create table public.ai_stats_insights (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  range_type text not null,
  generated_date date not null,
  data_fingerprint text not null default ''::text,
  insight_text text not null default ''::text,
  created_at timestamp with time zone null default now(),
  constraint ai_stats_insights_pkey primary key (id),
  constraint ai_stats_insights_user_id_fkey foreign key (user_id) references weapp_user (id) on delete cascade,
  constraint ai_stats_insights_range_type_check check (
    range_type = any (array['week'::text, 'month'::text])
  ),
  constraint ai_stats_insights_user_range_date_unique unique (user_id, range_type, generated_date)
) tablespace pg_default;

create index if not exists idx_ai_stats_insights_user_range_date
  on public.ai_stats_insights using btree (user_id, range_type, generated_date);
