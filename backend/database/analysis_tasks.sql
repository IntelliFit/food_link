create table public.analysis_tasks (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  task_type text not null,
  image_url text null,
  status text not null default 'pending'::text,
  payload jsonb null default '{}'::jsonb,
  result jsonb null,
  error_message text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  text_input text null,
  constraint analysis_tasks_pkey primary key (id),
  constraint analysis_tasks_user_id_fkey foreign KEY (user_id) references weapp_user (id) on delete CASCADE,
  constraint analysis_tasks_status_check check (
    (
      status = any (
        array[
          'pending'::text,
          'processing'::text,
          'done'::text,
          'failed'::text
        ]
      )
    )
  ),
  constraint analysis_tasks_task_type_check check (
    (
      task_type = any (
        array[
          'food'::text,
          'food_text'::text,
          'health_report'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_analysis_tasks_user_id on public.analysis_tasks using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_analysis_tasks_status_type on public.analysis_tasks using btree (status, task_type) TABLESPACE pg_default;

create index IF not exists idx_analysis_tasks_created_at on public.analysis_tasks using btree (created_at) TABLESPACE pg_default;