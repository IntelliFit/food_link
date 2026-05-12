-- ============================================================
-- 补全 user_food_records 表缺失字段
-- 用于存储完整的分析结果（建议、目标、上下文等）
--
-- 【执行方式】
-- 1. 打开 Supabase Dashboard -> SQL Editor
-- 2. 粘贴本脚本内容并运行
-- ============================================================

-- 1. 添加 context_state (已移除)
-- DO $$
-- BEGIN
--     IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_food_records' AND column_name = 'context_state') THEN
--         ALTER TABLE public.user_food_records ADD COLUMN context_state text;
--         COMMENT ON COLUMN public.user_food_records.context_state IS '用户当前状态（已废弃，兼容旧版）';
--     END IF;
-- END $$;

-- 2. 添加 diet_goal (饮食目标)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_food_records' AND column_name = 'diet_goal') THEN
        ALTER TABLE public.user_food_records ADD COLUMN diet_goal text;
        COMMENT ON COLUMN public.user_food_records.diet_goal IS '饮食目标: fat_loss / muscle_gain / maintain / none';
    END IF;
END $$;

-- 3. 添加 activity_timing (运动时机)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_food_records' AND column_name = 'activity_timing') THEN
        ALTER TABLE public.user_food_records ADD COLUMN activity_timing text;
        COMMENT ON COLUMN public.user_food_records.activity_timing IS '运动时机: post_workout / daily / before_sleep / none';
    END IF;
END $$;

-- 4. 添加 pfc_ratio_comment (PFC 比例评价)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_food_records' AND column_name = 'pfc_ratio_comment') THEN
        ALTER TABLE public.user_food_records ADD COLUMN pfc_ratio_comment text;
        COMMENT ON COLUMN public.user_food_records.pfc_ratio_comment IS 'PFC 比例评价';
    END IF;
END $$;

-- 5. 添加 absorption_notes (吸收率说明)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_food_records' AND column_name = 'absorption_notes') THEN
        ALTER TABLE public.user_food_records ADD COLUMN absorption_notes text;
        COMMENT ON COLUMN public.user_food_records.absorption_notes IS '吸收率说明';
    END IF;
END $$;

-- 6. 添加 context_advice (情境建议)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_food_records' AND column_name = 'context_advice') THEN
        ALTER TABLE public.user_food_records ADD COLUMN context_advice text;
        COMMENT ON COLUMN public.user_food_records.context_advice IS '情境建议';
    END IF;
END $$;

-- 7. 添加 source_task_id (关联的分析任务 ID)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_food_records' AND column_name = 'source_task_id') THEN
        ALTER TABLE public.user_food_records ADD COLUMN source_task_id uuid REFERENCES public.analysis_tasks(id) ON DELETE SET NULL;
        COMMENT ON COLUMN public.user_food_records.source_task_id IS '来源分析任务 ID';
        CREATE INDEX IF NOT EXISTS idx_user_food_records_source_task_id ON public.user_food_records(source_task_id);
    END IF;
END $$;

-- 8. 刷新 schema 缓存（Supabase 可能需要）
NOTIFY pgrst, 'reload config';
