create table if not exists public.precision_sessions (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  source_type text not null,
  execution_mode text not null default 'strict'::text,
  status text not null default 'collecting'::text,
  round_index integer not null default 1,
  latest_inputs jsonb not null default '{}'::jsonb,
  pending_requirements jsonb not null default '[]'::jsonb,
  reference_objects jsonb not null default '[]'::jsonb,
  split_plan jsonb null,
  latest_planner_result jsonb null,
  final_result jsonb null,
  current_task_id uuid null,
  last_error text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint precision_sessions_pkey primary key (id),
  constraint precision_sessions_user_id_fkey foreign key (user_id) references weapp_user (id) on delete cascade,
  constraint precision_sessions_current_task_id_fkey foreign key (current_task_id) references analysis_tasks (id) on delete set null,
  constraint precision_sessions_source_type_check check (
    source_type = any (array['image'::text, 'text'::text])
  ),
  constraint precision_sessions_execution_mode_check check (
    execution_mode = any (array['standard'::text, 'strict'::text])
  ),
  constraint precision_sessions_status_check check (
    status = any (
      array[
        'collecting'::text,
        'estimating'::text,
        'needs_user_input'::text,
        'needs_retake'::text,
        'done'::text,
        'cancelled'::text,
        'failed'::text
      ]
    )
  ),
  constraint precision_sessions_round_index_check check (round_index >= 1)
) tablespace pg_default;

create index if not exists idx_precision_sessions_user_created_at
  on public.precision_sessions using btree (user_id, created_at desc) tablespace pg_default;

create index if not exists idx_precision_sessions_user_status
  on public.precision_sessions using btree (user_id, status) tablespace pg_default;

create table if not exists public.precision_session_rounds (
  id uuid not null default gen_random_uuid (),
  session_id uuid not null,
  round_index integer not null,
  actor_role text not null,
  input_payload jsonb not null default '{}'::jsonb,
  planner_result jsonb null,
  created_at timestamp with time zone not null default now(),
  constraint precision_session_rounds_pkey primary key (id),
  constraint precision_session_rounds_session_id_fkey foreign key (session_id) references precision_sessions (id) on delete cascade,
  constraint precision_session_rounds_actor_role_check check (
    actor_role = any (array['user'::text, 'assistant'::text, 'system'::text])
  ),
  constraint precision_session_rounds_round_index_check check (round_index >= 1)
) tablespace pg_default;

create index if not exists idx_precision_session_rounds_session_round
  on public.precision_session_rounds using btree (session_id, round_index asc, created_at asc) tablespace pg_default;

create table if not exists public.precision_item_estimates (
  id uuid not null default gen_random_uuid (),
  session_id uuid not null,
  round_index integer not null,
  item_index integer not null,
  item_key text not null,
  item_name text not null,
  status text not null default 'pending'::text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb null,
  source_task_id uuid null,
  error_message text null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint precision_item_estimates_pkey primary key (id),
  constraint precision_item_estimates_session_id_fkey foreign key (session_id) references precision_sessions (id) on delete cascade,
  constraint precision_item_estimates_source_task_id_fkey foreign key (source_task_id) references analysis_tasks (id) on delete set null,
  constraint precision_item_estimates_status_check check (
    status = any (array['pending'::text, 'processing'::text, 'done'::text, 'failed'::text])
  ),
  constraint precision_item_estimates_round_index_check check (round_index >= 1),
  constraint precision_item_estimates_item_index_check check (item_index >= 0),
  constraint precision_item_estimates_session_round_item_key_key unique (session_id, round_index, item_key)
) tablespace pg_default;

create index if not exists idx_precision_item_estimates_session_round
  on public.precision_item_estimates using btree (session_id, round_index, item_index asc) tablespace pg_default;

create index if not exists idx_precision_item_estimates_source_task_id
  on public.precision_item_estimates using btree (source_task_id) tablespace pg_default;
