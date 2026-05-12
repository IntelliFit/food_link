-- ============================================================
-- 好友系统：好友关系表 + 好友请求表
-- 圈子页「添加好友」、查看好友今日饮食依赖本脚本
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- 好友关系表：双方同意后各写一条，便于查询「我的好友列表」和「是否互为好友」
CREATE TABLE IF NOT EXISTS public.user_friends (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  friend_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_friends_pkey PRIMARY KEY (id),
  CONSTRAINT user_friends_unique UNIQUE (user_id, friend_id),
  CONSTRAINT user_friends_no_self CHECK (user_id != friend_id)
);

CREATE INDEX IF NOT EXISTS idx_user_friends_user_id ON public.user_friends(user_id);
CREATE INDEX IF NOT EXISTS idx_user_friends_friend_id ON public.user_friends(friend_id);

COMMENT ON TABLE public.user_friends IS '好友关系（双方同意后插入两条：A->B 与 B->A）';

-- 好友请求表：待处理 / 已接受 / 已拒绝
CREATE TABLE IF NOT EXISTS public.friend_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES public.weapp_user(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT friend_requests_pkey PRIMARY KEY (id),
  CONSTRAINT friend_requests_no_self CHECK (from_user_id != to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user ON public.friend_requests(to_user_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_from_user ON public.friend_requests(from_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pair ON public.friend_requests(from_user_id, to_user_id);

COMMENT ON TABLE public.friend_requests IS '好友申请：pending 待处理，accepted/rejected 已处理';
