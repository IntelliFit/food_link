-- ============================================================
-- 饮食记录表：增强专业营养分析字段（PFC 比例、吸收率、情境建议）
--
-- 【执行】在 Supabase SQL Editor 中执行本脚本（在 user_food_records 表已存在后）
-- ============================================================

-- 用户当前状态（提交记录时选择）：如 刚健身完、空腹、减脂期、增肌期、维持体重、无特殊
ALTER TABLE public.user_food_records
  ADD COLUMN IF NOT EXISTS context_state text;

-- 宏量营养素比例评价（PFC Ratio）：AI 根据本餐 P/C/F 占比给出的简要评价
ALTER TABLE public.user_food_records
  ADD COLUMN IF NOT EXISTS pfc_ratio_comment text;

-- 吸收率与生物利用度：食物组合或烹饪方式对吸收的简要说明
ALTER TABLE public.user_food_records
  ADD COLUMN IF NOT EXISTS absorption_notes text;

-- 情境感知建议：结合用户当前状态给出的针对性建议
ALTER TABLE public.user_food_records
  ADD COLUMN IF NOT EXISTS context_advice text;

COMMENT ON COLUMN public.user_food_records.context_state IS '用户当前状态：如 post_workout, fasting, fat_loss, muscle_gain, maintain, none';
COMMENT ON COLUMN public.user_food_records.pfc_ratio_comment IS 'PFC 比例评价（蛋白质/脂肪/碳水占比是否符合目标）';
COMMENT ON COLUMN public.user_food_records.absorption_notes IS '吸收率与生物利用度简要说明';
COMMENT ON COLUMN public.user_food_records.context_advice IS '情境感知建议（结合 context_state）';
