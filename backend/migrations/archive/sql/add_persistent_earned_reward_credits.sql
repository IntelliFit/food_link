-- 会员奖励积分累计余额
-- 执行位置：Supabase SQL Editor
-- 日期：2026-05-01
--
-- 变更说明：
--   1. weapp_user 新增 earned_credits_balance，保存用户累计奖励积分余额
--   2. user_earned_credit_ledger 记录邀请/分享入账及消费流水

alter table public.weapp_user
  add column if not exists earned_credits_balance integer not null default 0;

create table if not exists public.user_earned_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.weapp_user(id) on delete cascade,
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  reason text not null,
  source_key text null,
  related_date date null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_user_earned_credit_ledger_user_reason_source
  on public.user_earned_credit_ledger(user_id, reason, source_key)
  where source_key is not null;

create index if not exists idx_user_earned_credit_ledger_user_created_at
  on public.user_earned_credit_ledger(user_id, created_at desc);

create index if not exists idx_user_earned_credit_ledger_user_related_date
  on public.user_earned_credit_ledger(user_id, related_date desc);
