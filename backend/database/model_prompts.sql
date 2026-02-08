-- 模型提示词管理表
-- 用于存储 Gemini 和千问模型的食物分析提示词

CREATE TABLE IF NOT EXISTS model_prompts (
    id SERIAL PRIMARY KEY,
    model_type VARCHAR(50) NOT NULL,          -- 模型类型: 'qwen' 或 'gemini'
    prompt_name VARCHAR(100) NOT NULL,         -- 提示词名称（用于标识）
    prompt_content TEXT NOT NULL,              -- 提示词内容
    is_active BOOLEAN DEFAULT FALSE,           -- 是否启用（当前使用的提示词）
    description VARCHAR(500),                  -- 提示词描述/备注
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_model_prompts_model_type ON model_prompts(model_type);
CREATE INDEX IF NOT EXISTS idx_model_prompts_is_active ON model_prompts(is_active);

-- 创建部分唯一索引：每个模型类型只能有一个激活的提示词
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_prompt 
    ON model_prompts(model_type) 
    WHERE is_active = TRUE;

-- 插入默认提示词 - 千问
INSERT INTO model_prompts (model_type, prompt_name, prompt_content, is_active, description) VALUES
('qwen', '默认食物分析提示词', '请作为专业的营养师分析这张食物图片。
1. 识别图中所有不同的食物单品。
2. 估算每种食物的重量（克）和详细营养成分。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（如维生素C促铁吸收、油脂助脂溶性维生素等，一两句话）。
7. context_advice: 结合用户状态或剩余热量的情境建议（若无则可为空字符串）。

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{
  "items": [
    {
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {
        "calories": 热量,
        "protein": 蛋白质,
        "carbs": 碳水,
        "fat": 脂肪,
        "fiber": 纤维,
        "sugar": 糖分
      }
    }
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）"
}', TRUE, '千问模型默认的食物分析提示词')
ON CONFLICT DO NOTHING;

-- 插入默认提示词 - Gemini
INSERT INTO model_prompts (model_type, prompt_name, prompt_content, is_active, description) VALUES
('gemini', '默认食物分析提示词', '请作为专业的营养师分析这张食物图片。
1. 识别图中所有不同的食物单品。
2. 估算每种食物的重量（克）和详细营养成分。
3. description: 提供这顿饭的简短中文描述。
4. insight: 基于该餐营养成分的一句话健康建议。
5. pfc_ratio_comment: 本餐蛋白质(P)、脂肪(F)、碳水(C) 占比的简要评价（是否均衡、适合增肌/减脂/维持）。
6. absorption_notes: 食物组合或烹饪方式对吸收率、生物利用度的简要说明（如维生素C促铁吸收、油脂助脂溶性维生素等，一两句话）。
7. context_advice: 结合用户状态或剩余热量的情境建议（若无则可为空字符串）。

重要：请务必使用**简体中文**返回所有文本内容。
请严格按照以下 JSON 格式返回，不要包含任何其他文本：

{
  "items": [
    {
      "name": "食物名称（简体中文）",
      "estimatedWeightGrams": 重量（数字）,
      "nutrients": {
        "calories": 热量,
        "protein": 蛋白质,
        "carbs": 碳水,
        "fat": 脂肪,
        "fiber": 纤维,
        "sugar": 糖分
      }
    }
  ],
  "description": "餐食描述（简体中文）",
  "insight": "健康建议（简体中文）",
  "pfc_ratio_comment": "PFC 比例评价（简体中文，一两句话）",
  "absorption_notes": "吸收率/生物利用度说明（简体中文，一两句话）",
  "context_advice": "情境建议（简体中文，若无则空字符串）"
}', TRUE, 'Gemini模型默认的食物分析提示词')
ON CONFLICT DO NOTHING;

-- 提示词历史记录表（可选，用于追踪修改历史）
CREATE TABLE IF NOT EXISTS model_prompts_history (
    id SERIAL PRIMARY KEY,
    prompt_id INTEGER REFERENCES model_prompts(id) ON DELETE CASCADE,
    model_type VARCHAR(50) NOT NULL,
    prompt_name VARCHAR(100) NOT NULL,
    prompt_content TEXT NOT NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    change_reason VARCHAR(500)                 -- 修改原因
);
