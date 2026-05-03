-- 分享海报奖励：由「每用户每日 1 条」改为「每用户每日最多 3 条、每条记录每日最多 1 条」
-- 在 Supabase SQL Editor 执行（已有库需执行；新建库请使用更新后的 add_membership_reward_system.sql）

alter table public.user_credit_bonus_events
  drop constraint if exists user_credit_bonus_events_user_id_bonus_type_bonus_date_key;

create unique index if not exists uq_user_credit_bonus_share_poster_record
  on public.user_credit_bonus_events (user_id, bonus_type, bonus_date, source_record_id)
  where bonus_type = 'share_poster' and source_record_id is not null;
