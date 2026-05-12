-- 创建运动记录表
-- 用于存储用户的运动记录和消耗的卡路里

create table if not exists public.user_exercise_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references weapp_user(id) on delete cascade,
  exercise_desc text not null,  -- 运动描述（用户输入）
  calories_burned integer not null check (calories_burned >= 0 and calories_burned <= 5000),  -- 消耗的卡路里
  recorded_on date not null,  -- 记录日期（中国时区）
  recorded_at timestamptz default now() not null,  -- 记录时间戳
  created_at timestamptz default now() not null
);

-- 创建索引用于按用户和日期查询
-- 获取某天运动记录列表
CREATE INDEX IF NOT EXISTS idx_user_exercise_logs_user_date
  ON public.user_exercise_logs (user_id, recorded_on);

-- 获取用户所有运动记录（按时间倒序）
CREATE INDEX IF NOT EXISTS idx_user_exercise_logs_user_recorded_at
  ON public.user_exercise_logs (user_id, recorded_at desc);

-- 添加注释
comment on table public.user_exercise_logs is '用户运动记录表';
comment on column public.user_exercise_logs.exercise_desc is '运动描述，如"跑步30分钟"';
comment on column public.user_exercise_logs.calories_burned is '消耗的卡路里数（千卡）';
comment on column public.user_exercise_logs.recorded_on is '记录日期（中国时区），用于按天统计';
