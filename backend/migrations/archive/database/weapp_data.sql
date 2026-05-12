-- 创建 weapp_user 表
create table public.weapp_user (
  id uuid not null default gen_random_uuid (),
  openid text not null,
  unionid text null,
  avatar text null default ''::text,
  nickname text null default ''::text,
  telephone text null,
  create_time timestamp with time zone null default now(),
  update_time timestamp with time zone null default now(),
  height numeric null,
  weight numeric null,
  birthday date null,
  gender text null,
  activity_level text null,
  health_condition jsonb null default '{}'::jsonb,
  bmr numeric null,
  tdee numeric null,
  onboarding_completed boolean null default false,
  diet_goal character varying(50) null,
  constraint weapp_user_pkey primary key (id),
  constraint weapp_user_openid_unique unique (openid),
  constraint weapp_user_unionid_unique unique (unionid),
  constraint weapp_user_activity_level_check check (
    (
      activity_level = any (
        array[
          'sedentary'::text,
          'light'::text,
          'moderate'::text,
          'active'::text,
          'very_active'::text,
          ''::text
        ]
      )
    )
  ),
  constraint weapp_user_gender_check check (
    (
      gender = any (
        array[
          'male'::text,
          'female'::text,
          'other'::text,
          ''::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_weapp_user_openid on public.weapp_user using btree (openid) TABLESPACE pg_default;

create index IF not exists idx_weapp_user_unionid on public.weapp_user using btree (unionid) TABLESPACE pg_default
where
  (unionid is not null);

create trigger trigger_update_weapp_user_updated_at BEFORE
update on weapp_user for EACH row
execute FUNCTION update_weapp_user_updated_at ();