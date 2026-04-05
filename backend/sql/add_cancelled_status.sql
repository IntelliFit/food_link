-- 为 analysis_tasks 表添加 cancelled 状态支持
-- 用于标记用户主动取消的任务

-- 修改 status 检查约束，添加 cancelled 状态
ALTER TABLE public.analysis_tasks DROP CONSTRAINT IF EXISTS analysis_tasks_status_check;
ALTER TABLE public.analysis_tasks ADD CONSTRAINT analysis_tasks_status_check CHECK (
    status = ANY (
        array[
            'pending'::text,
            'processing'::text,
            'done'::text,
            'failed'::text,
            'timed_out'::text,
            'violated'::text,
            'cancelled'::text
        ]
    )
);

-- 添加注释说明
COMMENT ON CONSTRAINT analysis_tasks_status_check ON public.analysis_tasks IS 
    '任务状态: pending(待处理), processing(处理中), done(完成), failed(失败), timed_out(超时), violated(违规), cancelled(已取消)';
