# 食物分析 API

基于 FastAPI 和 DashScope 的食物图片分析服务。

## 功能

- 接收食物图片（Base64 编码）
- 使用 DashScope 的视觉模型分析食物
- 返回营养成分、健康建议等信息

## 安装

1. 安装依赖：

```bash
pip install -r requirements.txt
```

2. 配置环境变量：

在 `backend` 目录下创建 `.env` 文件，并填入你的 DashScope API Key：

```bash
cd backend
touch .env
```

编辑 `.env` 文件，设置：

```env
# DashScope API 配置
DASHSCOPE_API_KEY=your_dashscope_api_key_here

# 或者使用通用的 API_KEY 环境变量名
# API_KEY=your_api_key_here

# DashScope API 基础 URL（可选，默认使用兼容模式）
# DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# Ofox / OpenAI 兼容模型（可选）
# 若 LLM_PROVIDER=gemini，则异步分析 Worker 会优先使用这些模型名
# OFOX_MODEL_NAME=openai/gpt-5.4-nano
# 或分别单独指定图片 / 文字模型：
# OFOX_VISION_MODEL_NAME=openai/gpt-5.4-nano
# OFOX_TEXT_MODEL_NAME=openai/gpt-5.4-nano
```

**注意：** `.env` 文件会被自动加载，无需手动设置环境变量。

## 运行

**推荐（含异步分析 Worker）**：启动多个 Worker 子进程 + API 服务，处理后台食物分析任务：

```bash
python run_backend.py
```

可通过环境变量 `WORKER_COUNT`（默认 2，范围 1~8）、`PORT`（默认 3010）调整。

**仅 API（无 Worker）**：

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 3010
```

服务将在 `http://localhost:3010` 启动（或你配置的端口）。

### 运动记录相关表（PostgreSQL）

若 `GET /api/exercise-logs` 一直为空、Worker 写入运动失败，请在目标 PostgreSQL 中执行 `sql/migrate_exercise_logs_and_task_type.sql`（或配置 `DATABASE_URL` / `POSTGRESQL_*` 后运行 `python scripts/apply_exercise_migration.py`）。执行后 `task_type=exercise` 可直接入库，无需 API 回退到 `food_text`。

## API 文档

启动服务后，访问以下地址查看自动生成的 API 文档：

- Swagger UI: `http://localhost:3010/docs`
- ReDoc: `http://localhost:3010/redoc`

## 精准模式验证建议

为验证“精准模式”是否真的比标准模式更稳，建议固定一组小样本长期复用：

- 单食物：如一碗米饭、一个红薯、一块鸡胸肉；重点看重量误差和热量误差。
- 可拆分混合餐：如米饭 + 鸡胸 + 西兰花这类 2-3 个主体且边界清楚的样本；重点看是否能逐项估计。
- 复杂混合餐：如盖饭、大拼盘、5-6 个菜互相遮挡的整餐；重点看是否会稳定提示拆拍，而不是硬算。

第一阶段建议每组至少准备 3 张样本，重点关注 4 个指标：

- 精准模式通过率
- 通过样本的重量误差
- 通过样本的热量误差
- 被拒样本是否真的属于“该拆拍”的复杂场景

## API 端点

### POST /api/analyze

分析食物图片。

**请求体：**

```json
{
  "base64Image": "data:image/jpeg;base64,/9j/4AAQ...",
  "additionalContext": "这是学校食堂的大份",
  "modelName": "qwen-vl-max"
}
```

**响应：**

```json
{
  "description": "餐食描述",
  "insight": "健康建议",
  "items": [
    {
      "name": "食物名称",
      "estimatedWeightGrams": 200,
      "originalWeightGrams": 200,
      "nutrients": {
        "calories": 300,
        "protein": 20,
        "carbs": 40,
        "fat": 10,
        "fiber": 5,
        "sugar": 8
      }
    }
  ]
}
```

## 环境变量

- `DASHSCOPE_API_KEY`: DashScope API Key（必需）
- `API_KEY`: 备用 API Key 环境变量名
- `DASHSCOPE_BASE_URL`: DashScope API 基础 URL（可选，默认使用兼容模式）

