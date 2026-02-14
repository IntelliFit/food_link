# 文字分析异步化 - 部署检查清单

## 📋 部署前检查

### 环境准备
- [ ] 确认 Supabase 数据库连接正常
- [ ] 确认 `DASHSCOPE_API_KEY` 已配置
- [ ] 确认后端服务运行正常
- [ ] 备份当前数据库（可选但推荐）

### 代码审查
- [ ] 所有修改的文件已提交到 Git
- [ ] 代码符合项目规范
- [ ] 无明显的语法错误或 linter 错误

## 🗄️ 数据库迁移

### 步骤 1: 执行迁移脚本
- [ ] 登录 Supabase Dashboard
- [ ] 进入 SQL Editor
- [ ] 复制 `backend/database/migrate_analysis_tasks_for_text.sql` 内容
- [ ] 执行 SQL 脚本
- [ ] 验证执行结果（无错误）

### 步骤 2: 验证表结构
```sql
-- 执行此查询验证
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'analysis_tasks' 
  AND column_name IN ('image_url', 'text_input');
```
- [ ] `image_url` 列的 `is_nullable` 为 `YES`
- [ ] `text_input` 列已存在，类型为 `text`，`is_nullable` 为 `YES`

### 步骤 3: 验证约束
```sql
-- 执行此查询验证
SELECT constraint_name, check_clause 
FROM information_schema.check_constraints 
WHERE constraint_name = 'analysis_tasks_task_type_check';
```
- [ ] 约束包含 `'food_text'`

## 🔧 后端部署

### 步骤 1: 代码部署
- [ ] 拉取最新代码：`git pull`
- [ ] 检查修改的文件：
  - [ ] `backend/database.py`
  - [ ] `backend/main.py`
  - [ ] `backend/worker.py`
  - [ ] `backend/run_backend.py`

### 步骤 2: 环境变量
- [ ] 检查 `.env` 文件包含必需的环境变量：
  ```bash
  DASHSCOPE_API_KEY=your_key
  TEXT_WORKER_COUNT=1  # 可选，默认 1
  ```

### 步骤 3: 重启服务
- [ ] 停止当前服务
- [ ] 启动新服务：`python backend/run_backend.py`
- [ ] 检查启动日志，确认包含：
  ```
  [run_backend] 已启动 X 个图片分析 Worker + 1 个文字分析 Worker + ...
  [worker-0] 启动，任务类型: food_text
  ```

### 步骤 4: 验证后端
- [ ] 健康检查：`curl http://localhost:3010/api/health`
- [ ] 测试提交接口（需要 token）：
  ```bash
  curl -X POST http://localhost:3010/api/analyze-text/submit \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"text": "测试"}'
  ```
- [ ] 确认返回包含 `task_id`

## 💻 前端部署

### 步骤 1: 代码部署
- [ ] 拉取最新代码：`git pull`
- [ ] 检查修改的文件：
  - [ ] `src/utils/api.ts`
  - [ ] `src/pages/record/index.tsx`
  - [ ] `src/pages/analyze-loading/index.tsx`

### 步骤 2: 构建
- [ ] 安装依赖（如有新增）：`npm install`
- [ ] 构建小程序：`npm run build:weapp`
- [ ] 检查构建输出，无错误

### 步骤 3: 上传
- [ ] 打开微信开发者工具
- [ ] 加载项目目录
- [ ] 检查编译结果，无错误
- [ ] 上传代码到微信小程序后台
- [ ] 设置为体验版

## 🧪 功能测试

### 测试 1: 提交任务
- [ ] 打开小程序（体验版）
- [ ] 登录账号
- [ ] 进入"记录"页面
- [ ] 选择"文字记录"
- [ ] 输入测试内容：`一碗红烧牛肉面，一个苹果`
- [ ] 选择餐次：午餐
- [ ] 选择目标：减脂期
- [ ] 选择时机：日常
- [ ] 点击"开始智能分析"
- [ ] 确认弹窗
- [ ] 观察是否显示"提交任务中..."

### 测试 2: 加载页面
- [ ] 自动跳转到加载页面
- [ ] 标题显示"AI 文字分析中..."
- [ ] 显示健康小知识（每3秒轮播）
- [ ] 显示"先离开，稍后查看"按钮

### 测试 3: 结果页面
- [ ] 等待几秒（通常 10-30 秒）
- [ ] 自动跳转到结果页面
- [ ] 显示食物列表（红烧牛肉面、苹果）
- [ ] 显示营养成分（热量、蛋白质等）
- [ ] 显示健康建议
- [ ] 显示 PFC 比例评价
- [ ] 显示吸收建议
- [ ] 显示情境建议

### 测试 4: 错误处理
- [ ] 测试未登录情况（应提示登录）
- [ ] 测试空输入（应提示"请输入食物描述"）
- [ ] 测试网络错误（断网后提交，应显示错误提示）

### 测试 5: 并发测试
- [ ] 快速提交多个任务（3-5个）
- [ ] 观察是否都能正常处理
- [ ] 检查数据库中的任务状态

## 📊 数据验证

### 验证 1: 查看任务记录
```sql
SELECT 
  id,
  task_type,
  text_input,
  status,
  created_at
FROM analysis_tasks
WHERE task_type = 'food_text'
ORDER BY created_at DESC
LIMIT 5;
```
- [ ] 能看到新创建的文字分析任务
- [ ] `task_type` 为 `'food_text'`
- [ ] `text_input` 包含用户输入的内容

### 验证 2: 查看任务结果
```sql
SELECT 
  id,
  status,
  result->>'description' as description,
  jsonb_array_length(result->'items') as items_count,
  updated_at - created_at as processing_time
FROM analysis_tasks
WHERE task_type = 'food_text' AND status = 'done'
ORDER BY created_at DESC
LIMIT 1;
```
- [ ] 任务状态为 `'done'`
- [ ] `result` 包含分析结果
- [ ] `items_count` > 0
- [ ] `processing_time` 合理（通常 10-30 秒）

### 验证 3: 统计数据
```sql
SELECT 
  status,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_seconds
FROM analysis_tasks
WHERE task_type = 'food_text'
GROUP BY status;
```
- [ ] 查看各状态的任务数量
- [ ] 平均处理时间合理

## 🔍 监控检查

### 日志监控
- [ ] 检查后端日志，无异常错误
- [ ] 检查 Worker 日志，任务正常处理
- [ ] 检查大模型调用日志，无频繁失败

### 性能监控
- [ ] API 响应时间 < 1秒
- [ ] Worker 处理时间 < 30秒
- [ ] 数据库查询时间 < 100ms

### 告警设置（可选）
- [ ] 设置任务失败率告警（> 10%）
- [ ] 设置任务积压告警（pending > 100）
- [ ] 设置 Worker 宕机告警

## 📝 回滚计划

如果部署出现问题，执行以下回滚步骤：

### 数据库回滚
```sql
-- 如果需要回滚（通常不需要，因为修改是向后兼容的）
ALTER TABLE analysis_tasks 
  ALTER COLUMN image_url SET NOT NULL;

ALTER TABLE analysis_tasks 
  DROP COLUMN IF EXISTS text_input;

-- 恢复旧的约束
ALTER TABLE analysis_tasks 
  DROP CONSTRAINT IF EXISTS analysis_tasks_task_type_check;

ALTER TABLE analysis_tasks 
  ADD CONSTRAINT analysis_tasks_task_type_check 
  CHECK (task_type = ANY (ARRAY['food'::text, 'health_report'::text]));
```

### 后端回滚
```bash
# 回滚到上一个版本
git checkout <previous-commit>

# 重启服务
python backend/run_backend.py
```

### 前端回滚
```bash
# 回滚到上一个版本
git checkout <previous-commit>

# 重新构建
npm run build:weapp

# 在微信开发者工具中回退版本
```

## ✅ 部署完成确认

- [ ] 所有测试通过
- [ ] 数据验证通过
- [ ] 监控正常
- [ ] 用户反馈良好（如有）
- [ ] 文档已更新
- [ ] 团队已通知

## 📞 问题联系

如果部署过程中遇到问题：

1. 查看 [测试指南](backend/database/TEST_TEXT_ANALYSIS.md)
2. 查看 [迁移说明](backend/database/README_TEXT_ANALYSIS.md)
3. 查看 [修改总结](CHANGELOG_TEXT_ANALYSIS_ASYNC.md)
4. 联系技术支持

---

**部署人员签名：** __________

**部署日期：** __________

**部署环境：** □ 开发环境  □ 测试环境  □ 生产环境

**部署结果：** □ 成功  □ 失败（备注：__________）
