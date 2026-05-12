create table if not exists public.user_weight_records (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  recorded_on date not null,
  client_record_id text null,
  weight_kg numeric(6, 2) not null,
  source_type text not null default 'manual'::text,
  note text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_weight_records_pkey primary key (id),
  constraint user_weight_records_user_id_fkey foreign key (user_id) references weapp_user (id) on delete cascade,
  constraint user_weight_records_weight_kg_check check (weight_kg >= 20 and weight_kg <= 300),
  constraint user_weight_records_source_type_check check (
    source_type = any (array['manual'::text, 'imported'::text, 'ai'::text])
  )
) tablespace pg_default;

create index if not exists idx_user_weight_records_user_date
  on public.user_weight_records using btree (user_id, recorded_on) tablespace pg_default;

create index if not exists idx_user_weight_records_user_created_at
  on public.user_weight_records using btree (user_id, created_at desc) tablespace pg_default;

create unique index if not exists idx_user_weight_records_user_client_record_id
  on public.user_weight_records using btree (user_id, client_record_id)
  where client_record_id is not null;

create table if not exists public.user_water_logs (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  recorded_on date not null,
  amount_ml integer not null,
  source_type text not null default 'manual'::text,
  created_at timestamp with time zone not null default now(),
  recorded_at timestamp with time zone not null default now(),
  constraint user_water_logs_pkey primary key (id),
  constraint user_water_logs_user_id_fkey foreign key (user_id) references weapp_user (id) on delete cascade,
  constraint user_water_logs_amount_ml_check check (amount_ml > 0 and amount_ml <= 5000),
  constraint user_water_logs_source_type_check check (
    source_type = any (array['manual'::text, 'imported'::text, 'ai'::text])
  )
) tablespace pg_default;

create index if not exists idx_user_water_logs_user_date
  on public.user_water_logs using btree (user_id, recorded_on) tablespace pg_default;

create index if not exists idx_user_water_logs_user_recorded_at
  on public.user_water_logs using btree (user_id, recorded_at desc) tablespace pg_default;

create table if not exists public.user_body_metric_settings (
  user_id uuid not null,
  water_goal_ml integer not null default 2000,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_body_metric_settings_pkey primary key (user_id),
  constraint user_body_metric_settings_user_id_fkey foreign key (user_id) references weapp_user (id) on delete cascade,
  constraint user_body_metric_settings_water_goal_ml_check check (water_goal_ml >= 500 and water_goal_ml <= 10000)
) tablespace pg_default;
