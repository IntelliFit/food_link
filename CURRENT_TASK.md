# CURRENT_TASK

- Task: 保质期订阅提醒功能落地
- Status: in_progress（主链路代码已实现，旧 `user_food_expiry_items` 链路已移除，`dev:weapp` 已编译通过，待数据库建表与真机/开发者工具联调）
- Scope:
  ## 本次实现
  - `pages/expiry/*` 绑定 `/api/expiry/*` 新链路，并移除旧 `/api/food-expiry/*`
  - 删除旧页面 `pages/food-expiry/*` 与对应前端 API 封装
  - 首页“快到期食物”摘要与跳转入口已切到新链路 `pages/expiry/* + food_expiry_items`
  - 新增小程序订阅提醒登记接口 `POST /api/expiry/items/{id}/subscribe`
  - 新增保质期通知任务表 `food_expiry_notification_jobs`
  - 新增独立保质期通知 Worker，按队列轮询并发送小程序订阅消息
  - 新增后自动弹出“是否订阅到期提醒”弹窗，用户同意后登记当天提醒任务
  - 修复 `src/utils/api.ts` 构建常量读取方式，避免 `ReferenceError` 且恢复开发环境 API 地址注入
  - `npm run dev:weapp` 脚本已追加 `--no-check`，绕过当前机器上的 Taro doctor Rust panic

  ## 当前阻塞
  - 需要在数据库执行 `backend/database/food_expiry_notification_jobs.sql`
  - 后端环境需配置 `EXPIRY_SUBSCRIBE_TEMPLATE_ID`
  - 前端环境需将 `TARO_APP_EXPIRY_SUBSCRIBE_TEMPLATE_ID` 替换为真正的小程序订阅消息模板 ID（当前 `.env.development` 里仍是旧服务通知模板 ID）
  - 已确认 `expiry-notify-worker` 会正常抢占并处理 `food_expiry_notification_jobs`，当前“未提醒”不是 worker 未运行，而是微信发送阶段报错：`argument invalid! data.character_string5.value`
  - 2026-04-07 已修复后端 `quantity_note -> character_string5` 的字符清洗：中文/空值不再直接发给微信，改为发送前统一收敛成 ASCII 安全值，旧队列快照在 worker 重试时也会自动清洗
  - 若修复后仍报参错，需要继续核对真实模板 ID 与字段定义是否匹配，尤其第 5 个字段是否确实还是 `character_string`
  - 微信开发者工具端口 `9420` 已监听，但 `mrc` 仍无法完成握手；本轮重启 CLI 自动化所需提权未获批准，暂未拿到截图证据

  ## 下一步
  - 执行新表 SQL 并确认 Supabase 中 `food_expiry_items` / `food_expiry_notification_jobs` 可用
  - 将前后端 `*_EXPIRY_SUBSCRIBE_TEMPLATE_ID` 一并替换成真实的小程序订阅消息模板 ID，并核对该模板第 5 个字段是否确实是 `character_string`
  - 用真实模板 ID 重新联调一次新增-订阅-入队-Worker 发送，重点确认修复后 `character_string5` 不再因中文/空值报错
  - 配置小程序订阅消息模板 ID 后联调新增-订阅-入队-Worker 发送
  - 如继续验证前端，优先排查开发者工具自动化握手失败，并在开发者工具内确认“自动化”已对当前项目窗口开启

---

- Previous Task: 运动记录功能 UI 实现
- Previous Status: done
