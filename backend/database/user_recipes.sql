-- 用户私人食谱表
-- 保存用户常吃的食物组合，支持一键记录

CREATE TABLE IF NOT EXISTS user_recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES weapp_user(id) ON DELETE CASCADE,
    
    -- 食谱基本信息
    recipe_name VARCHAR(100) NOT NULL,  -- 食谱名称，如"我的标配减脂早餐"
    description TEXT,  -- 食谱描述
    image_path TEXT,  -- 食谱封面图片（可选，可以是第一次记录的图片）
    
    -- 食物明细（JSON 数组）
    items JSONB NOT NULL,  -- 食物列表，格式同 user_food_records.items
    
    -- 营养汇总
    total_calories DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_protein DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_carbs DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_fat DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_weight_grams DECIMAL(10, 2) NOT NULL DEFAULT 0,
    
    -- 标签与分类
    tags TEXT[],  -- 标签，如 ["早餐", "减脂", "快手"]
    meal_type VARCHAR(20),  -- 常用餐次：breakfast/lunch/dinner/snack
    is_favorite BOOLEAN DEFAULT false,  -- 是否收藏
    
    -- 使用统计
    use_count INTEGER DEFAULT 0,  -- 使用次数
    last_used_at TIMESTAMP WITH TIME ZONE,  -- 最后使用时间
    
    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_user_recipes_user_id ON user_recipes(user_id);
CREATE INDEX idx_user_recipes_meal_type ON user_recipes(meal_type);
CREATE INDEX idx_user_recipes_is_favorite ON user_recipes(is_favorite);
CREATE INDEX idx_user_recipes_created_at ON user_recipes(created_at DESC);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_user_recipes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_recipes_updated_at
    BEFORE UPDATE ON user_recipes
    FOR EACH ROW
    EXECUTE FUNCTION update_user_recipes_updated_at();

-- 注释
COMMENT ON TABLE user_recipes IS '用户私人食谱表，保存常吃的食物组合';
COMMENT ON COLUMN user_recipes.recipe_name IS '食谱名称';
COMMENT ON COLUMN user_recipes.items IS '食物明细 JSON 数组';
COMMENT ON COLUMN user_recipes.use_count IS '使用次数统计';
