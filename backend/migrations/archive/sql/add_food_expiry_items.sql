create table if not exists public.food_expiry_items (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  food_name text not null,
  category text null,
  storage_type text not null default 'refrigerated'::text,
  quantity_note text null,
  expire_date date not null,
  opened_date date null,
  note text null,
  source_type text not null default 'manual'::text,
  status text not null default 'active'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint food_expiry_items_pkey primary key (id),
  constraint food_expiry_items_user_id_fkey foreign key (user_id) references weapp_user (id) on delete cascade,
  constraint food_expiry_items_storage_type_check check (
    storage_type = any (array['room_temp'::text, 'refrigerated'::text, 'frozen'::text])
  ),
  constraint food_expiry_items_source_type_check check (
    source_type = any (array['manual'::text, 'ocr'::text, 'ai'::text])
  ),
  constraint food_expiry_items_status_check check (
    status = any (array['active'::text, 'consumed'::text, 'discarded'::text])
  )
);

create index if not exists idx_food_expiry_items_user_id
  on public.food_expiry_items using btree (user_id);

create index if not exists idx_food_expiry_items_user_status
  on public.food_expiry_items using btree (user_id, status);

create index if not exists idx_food_expiry_items_user_expire_date
  on public.food_expiry_items using btree (user_id, expire_date);
