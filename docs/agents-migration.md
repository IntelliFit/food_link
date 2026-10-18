# 规则拆分说明

2026-10-16。这里只记录本次迁移与证据，后续工作不必启动读取。

| 原AGENTS内容 | 当前入口 |
| --- | --- |
| 完整原文（包含已被替代的旧规则） | `archive/agents-backup-20261015/AGENTS.original.md`，逐字备份 |
| 部署、Go builder候选、镜像平台、本地进程登记 | `runbooks/deploy.md` |
| API契约、小程序E2E、临时数据库与fixtures | `runbooks/e2e.md`，原 `../backend/e2e-test/README.md` 继续保留 |
| slog日志配置、trace、分层日志要求 | `runbooks/logging.md` |
| 迁移DO、幂等逻辑、目标库与HTTP启动边界 | `runbooks/db-migration.md` |
| 图标脚本、缓存清单 | `runbooks/icons.md`、已有 `frontend-cache-design.md` |
| 启动八文件、写死月份、重复开发构建禁令 | 精简为根AGENTS及 `STATE.md`；旧说明只保留在原文归档 |
| 产品入口关系 | `product-map.md`（代码现状，未做本轮微信运行验收） |
| 发版操作 | `../.agents/skills/release/SKILL.md`；按用户范围执行 |

与交接草案的差异：本机目录为 `D:/files/food_link`；用户级文件原已有磁盘规则；不能因“提交”自动部署生产，也不把新增迁移视为常设授权。保留现有dev分支策略，未自行创建分支/worktree。当前仅commit-msg业务hook，未新设门禁，也未授权自动绕过hook。

已静态核对：npm脚本及调用文件、两环境envVersion选择器、进程脚本Action/TaskId、迁移config-dir及定向选项。迁移没有通用dry-run。现有发布记录对应K8s，旧systemctl方法仅留归档；本轮没有上机证明当前自动更新机制、数据库隔离或部署健康状态。

本轮未改变原有未提交业务/状态文件，未运行应用测试、构建、上传或部署。最终commit与验证清单见执行机器 `D:/cache/codex-rule-refresh-20261015/REPORT.md`；该路径是本机审计，不要求另一台电脑存在。
