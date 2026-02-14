create table public.user_food_records (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  meal_type text not null,
  image_path text null,
  description text null,
  insight text null,
  items jsonb not null default '[]'::jsonb,
  total_calories numeric null default 0,
  total_protein numeric null default 0,
  total_carbs numeric null default 0,
  total_fat numeric null default 0,
  total_weight_grams integer null default 0,
  record_time timestamp with time zone null default now(),
  created_at timestamp with time zone null default now(),
  context_state text null,
  pfc_ratio_comment text null,
  absorption_notes text null,
  context_advice text null,
  diet_goal text null,
  activity_timing text null,
  source_task_id uuid null,
  constraint user_food_records_pkey primary key (id),
  constraint user_food_records_source_task_id_fkey foreign KEY (source_task_id) references analysis_tasks (id) on delete set null,
  constraint user_food_records_user_id_fkey foreign KEY (user_id) references weapp_user (id) on delete CASCADE,
  constraint user_food_records_meal_type_check check (
    (
      meal_type = any (
        array[
          'breakfast'::text,
          'lunch'::text,
          'dinner'::text,
          'snack'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_user_food_records_user_id on public.user_food_records using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_user_food_records_record_time on public.user_food_records using btree (record_time) TABLESPACE pg_default;

create index IF not exists idx_user_food_records_meal_type on public.user_food_records using btree (meal_type) TABLESPACE pg_default;

create index IF not exists idx_user_food_records_source_task_id on public.user_food_records using btree (source_task_id) TABLESPACE pg_default;