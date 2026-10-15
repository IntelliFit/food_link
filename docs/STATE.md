# FoodLink 当前状态

更新：2026-10-16。只保留可交接结论，最多80行；本轮仅核实本地代码和已有回执，未连接生产。

## 当前工作

- 规则已拆为精简 AGENTS.md、按需 runbook 和 release skill，保留现有 dev 分支策略。
- 最新本地业务提交为 `d770ea42`：营养状态匹配保留份量说明。规则文档提交在此之后，不代表再次发布应用。
- `PROJECT_STATE.md` 含其他对话尚未提交更新，本轮未改；仅需追历史时定向搜索。

## 已有发布证据（不是本轮实查）

- 旧状态记录2026-10-15双后端核验：dev generation216、main179，各3个Ready，health200；源码 dev `d770ea42`、main `305a0251`。
- 同一记录称小程序4.6.12官方上传成功；未确认后台设体验、未提审/正式发布。证据入口为旧状态中 `releases/20261015-repeat-publish/REPORT.md`，本轮未独立核验该回执。
- 营养状态/重量口径修复和边界见 `docs/nutrition-state-matching-fix-2026-10-15.md`；全库状态未全部治理，不把样本验证当作全库准确度。

## 未完成与限制

- 微信目标视口运行、截图和手机验收不能从上传成功推断；发布前按实际变更补证据。
- 自动匹配仍须拒绝状态/重量口径不明或冲突候选；旧历史摄入不静默改写。
- 生产实际镜像、数据库/schema及体验版后台指向，下一次相关操作前重新只读核实。
- 用户已确认多对话继续共用dev，各对话只提交自己的改动；同文件混有他人变更时只暂存自己的部分，不自动创建隔离分支/worktree。

## 固定入口

- 产品信息架构：`docs/product-map.md`。
- 发布：`.agents/skills/release/SKILL.md`、`docs/runbooks/deploy.md`。
- 迁移、日志、契约与E2E：`docs/runbooks/`。
- 旧规则原文：`docs/archive/agents-backup-20261015/AGENTS.original.md`，仅供查历史。
