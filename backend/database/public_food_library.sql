create table public.public_food_library (
  id uuid not null default gen_random_uuid (),
  user_id uuid not null,
  source_record_id uuid null,
  image_path text null,
  total_calories numeric null default 0,
  total_protein numeric null default 0,
  total_carbs numeric null default 0,
  total_fat numeric null default 0,
  items jsonb not null default '[]'::jsonb,
  description text null,
  insight text null,
  merchant_name text null,
  merchant_address text null,
  taste_rating smallint null,
  suitable_for_fat_loss boolean null default false,
  user_tags jsonb null default '[]'::jsonb,
  user_notes text null,
  latitude numeric null,
  longitude numeric null,
  city text null,
  district text null,
  status text not null default 'published'::text,
  audit_reject_reason text null,
  published_at timestamp with time zone null,
  like_count integer null default 0,
  comment_count integer null default 0,
  avg_rating numeric null default 0,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  detail_address text null,
  province text null,
  food_name text null,
  constraint public_food_library_pkey primary key (id),
  constraint public_food_library_source_record_id_fkey foreign KEY (source_record_id) references user_food_records (id) on delete set null,
  constraint public_food_library_user_id_fkey foreign KEY (user_id) references weapp_user (id) on delete CASCADE,
  constraint public_food_library_status_check check (
    (
      status = any (
        array[
          'draft'::text,
          'pending_review'::text,
          'published'::text,
          'rejected'::text,
          'hidden'::text
        ]
      )
    )
  ),
  constraint public_food_library_taste_rating_check check (
    (
      (taste_rating is null)
      or (
        (taste_rating >= 1)
        and (taste_rating <= 5)
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_public_food_library_province on public.public_food_library using btree (province) TABLESPACE pg_default;

create index IF not exists idx_public_food_library_food_name on public.public_food_library using btree (food_name) TABLESPACE pg_default;

create index IF not exists idx_public_food_library_user_id on public.public_food_library using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_public_food_library_status on public.public_food_library using btree (status) TABLESPACE pg_default;

create index IF not exists idx_public_food_library_published_at on public.public_food_library using btree (published_at desc) TABLESPACE pg_default;

create index IF not exists idx_public_food_library_city on public.public_food_library using btree (city) TABLESPACE pg_default;

create index IF not exists idx_public_food_library_suitable on public.public_food_library using btree (suitable_for_fat_loss) TABLESPACE pg_default;

create index IF not exists idx_public_food_library_merchant on public.public_food_library using btree (merchant_name) TABLESPACE pg_default;

create index IF not exists idx_public_food_library_like_count on public.public_food_library using btree (like_count desc) TABLESPACE pg_default;

create trigger trg_public_food_library_updated_at BEFORE
update on public_food_library for EACH row
execute FUNCTION update_public_food_library_updated_at ();