-- 积分制：在 PostgreSQL SQL 编辑器中执行（或 psql）
-- 1) weapp_user 扩展字段
ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS points_balance NUMERIC(12, 2) DEFAULT 100;
ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS registration_invite_code TEXT;
ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS referred_by_user_id UUID;

-- 唯一邀请码（注册用，与好友邀请 build_friend_invite_code 不同）
CREATE UNIQUE INDEX IF NOT EXISTS weapp_user_registration_invite_code_key
  ON weapp_user (registration_invite_code)
  WHERE registration_invite_code IS NOT NULL AND registration_invite_code <> '';

-- 若需外键可手动添加（部分库已有 referred_by 字段时）
-- ALTER TABLE weapp_user ADD CONSTRAINT weapp_user_referred_by_fk
--   FOREIGN KEY (referred_by_user_id) REFERENCES weapp_user (id) ON DELETE SET NULL;

-- 老用户补默认积分
UPDATE weapp_user SET points_balance = COALESCE(points_balance, 100) WHERE points_balance IS NULL;

-- 流水账
CREATE TABLE IF NOT EXISTS user_points_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES weapp_user (id) ON DELETE CASCADE,
  delta NUMERIC(12, 2) NOT NULL,
  balance_after NUMERIC(12, 2) NOT NULL,
  reason TEXT NOT NULL,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_points_ledger_user_created
  ON user_points_ledger (user_id, created_at DESC);
