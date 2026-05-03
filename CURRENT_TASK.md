# 当前任务

## 状态：进行中 - 等待用户反馈调试日志

## 任务列表

### 1. 一键删除未记录按钮 ✅ 已完成
- **导航栏右上角按钮**：已恢复垃圾桶图标（`icon-shanchu`）
- **列表顶部胶囊按钮**：保留
- **删除范围**：`pending + processing + failed`
- **过滤逻辑**：基于后端删除结果过滤列表
- **缓存清除**：删除后清理 `analyze_waiting_record_count`

### 2. 已记录天数排查 🔄 等待反馈
- **调试日志已添加**：`src/pages/profile/index.tsx` 中已添加 `console.log('[Profile] getUserRecordDays 返回:', recordDaysData)`
- **请用户操作**：进入「我的」页面，查看微信开发者工具控制台输出
- **预期情况**：如果用户只做了识别（未保存到食物日记），`user_food_records` 表为空，返回 0 是正常的
- **下一步**：根据控制台输出判断是后端问题还是数据问题

## 阻塞点
- 需要用户在开发者工具中查看控制台日志，确认 `getUserRecordDays` 返回值
