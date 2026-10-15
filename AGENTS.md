# food_link（食探）项目规则

通用协作和磁盘约束见用户级 `~/.codex/AGENTS.md`。本文件取代旧的启动必读、重复记忆和提交清理流程；历史规则保存在 `docs/archive/agents-backup-20261015/AGENTS.original.md`，不是当前指令。

## 开工与状态

- 核对当前 Git 根目录、分支、已有改动；本机目录为 `D:/files/food_link`，其他机器以实际 Git 根目录为准。
- 只读 `docs/STATE.md`（不超过80行）了解交接，再按任务查源码、runbook 和历史。不要机械读取或新建 IDENTITY/SOUL/USER/memory 等整套文件。
- 状态文件只写已确认决定、证据入口和未完成事项，跟随 Git；发布状态注明证据日期。旧记录和本地回执不等于本轮线上实查。
- 只写本任务目标项目；可只读参考同级产品。跨项目写入要在用户授权范围内。未经用户要求不委托外部编码代理。

## 项目与环境

- `apps/wechat/`：Taro 小程序；`apps/mobile/`：App；`admin/`：管理端；`backend/`：Go 后端；`e2e-weapp/`：小程序端到端验证。
- 小程序运行时按 `envVersion` 选 API：trial → `dev.api.healthymax.cn`，release → `api.healthymax.cn`，develop 取开发配置；代码入口 `apps/wechat/src/utils/api-base-url.ts`。配置说明见 `docs/api-url-configuration.md`，不把地址和密钥散落到业务页。
- 既有记录显示 dev/main 共享 `food-link` 数据库，迁移可能同时影响两套后端；执行前核对实际目标库与 schema，不根据分支推断数据隔离。本轮未连接生产验证。
- 后端为 CCR 镜像发布与 K8s 部署，详见 `docs/runbooks/deploy.md`；旧 `food-backend.service` 检查仅留历史，不作为当前部署验收。
- 生产主机与 CoachLink 等产品共享。操作前确认目标域名、服务/容器、数据库、端口、目录及回滚；不改变无关 Nginx、权限、缓存、磁盘或服务。

## 分支、提交与发布

- 日常沿用 `dev`；不自行创建/切换分支或 worktree。需要隔离或当前分支不同，先保护已有改动，不能强制 checkout/reset。并行策略变更需用户选择。
- 只暂存本任务的具体路径，提交前审阅 diff 和敏感信息。不要用扩展名通配删除根目录文件；只收拾确认由本任务生成的临时产物。
- 不新增 pre-commit 全量门禁。现有 commit-msg 保留；失败先查原因，“直接提交”不自动等于绕过 hook。
- 提交、推送、同步 main、部署、上传体验版、提审和正式发布分别按用户实际授权执行。发布任务使用 `.agents/skills/release/SKILL.md`；已授权的完整链路连续完成，不逐步重复请示。
- 检查按风险做一次：小程序相关类型/lint/测试、Go 格式和相关包测试、Admin 必要检查。文档修改不触发应用测试或构建；构建和大任务遵守用户磁盘约束。

## 前端与产品入口

- 开发复用已有 watch，只用 `npm run dev:weapp`，不直接运行 taro watch；`npm run build:weapp` 仅用于已授权的打包/上传任务。同一生产包按运行时环境选 API，不为 trial/release 重复构建。
- 小程序验证使用现有 `.agents/skills/weapp-devtools/SKILL.md`；不是浏览器页面，不用浏览器工具冒充验收。目标视口截图加至少一条交互路径；失败两次后记录阻塞，不反复开窗。
- 用户自行启动/验证时不代做。需要资源时先用 `scripts/dev-process.ps1 -Action Status` 检查；必要本地调试已获常设授权，Start/Release 必须指定本对话 TaskId，详见部署 runbook。
- 复用同项目窗口，核对完整路径、AppID、端口和构建目录；借用窗口不关闭，只释放连接；收尾只处理本任务资源。
- UI 少字、层级清楚；加载态用 spinner/skeleton，不添加“加载中”文案。参考图按同视口对照；新 API 先核对小程序兼容性，不假定所有手机支持 Intl 等能力。
- 信息架构见 `docs/product-map.md`。改美食图谱、食物库、食堂或地图前核对受影响入口，不能因移除一项限制丢失其他功能。
- 缓存问题先核验接口数据，再排本地缓存与服务端。新增用户缓存须同步 `apps/wechat/src/pages/profile/index.tsx` 的 `handleClearCache` 和 `docs/frontend-cache-design.md`。

## 后端与迁移

- 按已有 Go DDD 分层实现；需要时读 `.kimi/skills/ddd-go-backend/SKILL.md`，不把技能全文复制进本文件。
- 结构变化先改迁移 DO `backend/internal/migration/do/schema_do.go`，复杂约束/修正落幂等 `migration.go`，再在已确认目标执行迁移；HTTP 启动不自动迁移。详见 `docs/runbooks/db-migration.md`。
- 非本地/线上库的迁移和数据写入必须有对应授权，新增字段也可能锁表或影响共享环境，不视为自动授权。已授权范围不重复问；先备份受影响范围、预览，执行后回读。
- 后端用 `pkg/logger`/slog：中文消息、英文字段，关键 handler/service 分支留摘要；不记请求体、token、密码和完整手机号。细则见 `docs/runbooks/logging.md`。
- 内容安全相关改动先核对现有异步保存/审核链路，不把外部审核失败新增为注册、资料或上传的同步阻塞；不削弱现有鉴权和违规处置。
- 排障按依赖逐层定位；卡住时读 `.agents/skills/jinhui-stack-debug/SKILL.md`。契约/E2E 说明见 `docs/runbooks/e2e.md`，压测仅在明确授权时使用现有 go-api-loadtest skill。
