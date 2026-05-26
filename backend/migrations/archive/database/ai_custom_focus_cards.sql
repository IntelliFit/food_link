-- AI 自定义健康关注卡片缓存表
create table if not exists public.ai_custom_focus_cards (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  focus_id text not null,
  range_type text not null,
  generated_date date not null,
  data_fingerprint text not null default ''::text,
  focus_label text not null default ''::text,
  score integer not null default 0,
  brief text not null default ''::text,
  summary text not null default ''::text,
  basis text not null default ''::text,
  action text not null default ''::text,
  created_at timestamp with time zone null default now(),
  constraint ai_custom_focus_cards_pkey primary key (id),
  constraint ai_custom_focus_cards_user_id_fkey foreign key (user_id) references weapp_user (id) on delete cascade,
  constraint ai_custom_focus_cards_range_type_check check (
    range_type = any (array['week'::text, 'month'::text])
  ),
  constraint ai_custom_focus_cards_user_range_focus_unique unique (user_id, range_type, focus_id)
) tablespace pg_default;

create index if not exists idx_ai_custom_focus_cards_user_range_focus
  on public.ai_custom_focus_cards using btree (user_id, range_type, focus_id);
