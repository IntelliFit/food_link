-- 为 analysis_tasks 表添加 timed_out 状态支持
-- 同时添加超时任务自动标记的函数

-- 1. 修改 status 检查约束，添加 timed_out 状态
ALTER TABLE public.analysis_tasks DROP CONSTRAINT IF EXISTS analysis_tasks_status_check;
ALTER TABLE public.analysis_tasks ADD CONSTRAINT analysis_tasks_status_check CHECK (
    status = ANY (
        array[
            'pending'::text,
            'processing'::text,
            'done'::text,
            'failed'::text,
            'timed_out'::text
        ]
    )
);

-- 2. 创建索引用于快速查询超时任务
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_status_created 
ON public.analysis_tasks USING btree (status, created_at) 
TABLESPACE pg_default;

-- 3. 创建函数：标记超时的 processing/pending 任务
CREATE OR REPLACE FUNCTION mark_timed_out_tasks(timeout_minutes INTEGER DEFAULT 5)
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE public.analysis_tasks
    SET 
        status = 'timed_out',
        error_message = '分析超时，请重试',
        updated_at = NOW()
    WHERE 
        status IN ('pending', 'processing')
        AND created_at < NOW() - INTERVAL '1 minute' * timeout_minutes;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- 4. 注释说明
COMMENT ON FUNCTION mark_timed_out_tasks IS '将超时的 pending/processing 任务标记为 timed_out，默认超时时间为5分钟';
