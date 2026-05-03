-- 食探会员奖励体系（邀请奖励 + 分享海报奖励）
-- 执行位置：Supabase SQL Editor
-- 日期：2026-04-27
--
-- 变更说明：
--   1. user_invite_referrals：记录邀请关系与后续邀请奖励资格状态
--   2. user_credit_bonus_events：分享海报奖励等（每条记录每日最多 1 次，每用户每日最多 3 次）

create table if not exists public.user_invite_referrals (
  id uuid primary key default gen_random_uuid(),
  inviter_user_id uuid not null references public.weapp_user(id) on delete cascade,
  invitee_user_id uuid not null references public.weapp_user(id) on delete cascade,
  invite_code text,
  source_request_id uuid null,
  status text not null default 'pending_qualified'
    check (status in ('pending_qualified', 'reward_active', 'reward_completed', 'reward_blocked', 'cancelled')),
  first_effective_action_at timestamptz null,
  first_effective_action_type text null,
  reward_start_date date null,
  reward_end_date date null,
  blocked_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invitee_user_id)
);

create index if not exists idx_user_invite_referrals_inviter
  on public.user_invite_referrals(inviter_user_id, status, reward_start_date, reward_end_date);

create index if not exists idx_user_invite_referrals_invitee
  on public.user_invite_referrals(invitee_user_id, status, reward_start_date, reward_end_date);

create table if not exists public.user_credit_bonus_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.weapp_user(id) on delete cascade,
  bonus_type text not null
    check (bonus_type in ('share_poster')),
  bonus_date date not null,
  credits integer not null default 0 check (credits >= 0),
  source_record_id uuid null references public.user_food_records(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_credit_bonus_events_user_date
  on public.user_credit_bonus_events(user_id, bonus_type, bonus_date);

-- 分享海报：同一用户同一天同一记录仅一条；每日总条数由应用层限制为 3
create unique index if not exists uq_user_credit_bonus_share_poster_record
  on public.user_credit_bonus_events (user_id, bonus_type, bonus_date, source_record_id)
  where bonus_type = 'share_poster' and source_record_id is not null;
