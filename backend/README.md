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
```

**注意：** `.env` 文件会被自动加载，无需手动设置环境变量。

## 运行

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

服务将在 `http://localhost:8000` 启动。

## API 文档

启动服务后，访问以下地址查看自动生成的 API 文档：

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

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

