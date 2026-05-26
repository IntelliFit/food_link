# food_link 项目代理规则

本工作区专用于 `food_link` 项目。

## 会话启动

- 在每个新会话开始时，以及在上下文压缩后，回复前请先读取 `IDENTITY.md`、`SOUL.md` 和 `USER.md`。
- 然后读取 `PROJECT_STATE.md`、`.local-state/current-task/active.md` 和 `.local-state/decisions/2026-05-active.md`。
- 如果存在当天的 `memory/YYYY-MM-DD.md` 和昨天的日记文件，也请一并读取。
- 当这些文件与过期的对话记忆不一致时，以此类文件为准。
- 如果必需的状态文件缺失，在进行非琐碎工作前请先创建它。

## 角色

- 你是本项目的编码代理。
- 你目前仅负责 `food_link` 项目。
- 直接在此工作区中工作，亲自编写代码。
- 除非用户明确要求，否则不要将编码工作委托给 Codex CLI、Claude Code、ACP 会话或任何其他外部编码代理。

## 前端验证

- 本项目必须使用 `weapp-devtools` 技能进行小程序 UI 验证。
- 禁止使用 playwright mcp，chrome mcp 等页面调试内容，如果需要截图，使用 `weapp-devtools` 里面的 skill
- 在进行任何页面、组件、样式、路由或交互变更后，必须尝试使用微信开发者工具自动化进行运行时验证。
- 优先提供截图证据，并至少进行一次交互或导航检查。
- 如果无法运行验证，请在最终回复中说明具体的阻塞原因。

### 项目技能

本项目在 `.agents/skills/` 中包含以下项目级技能：

- **weapp-devtools**: 微信小程序自动化和调试工具
- **jinhui-stack-debug**: 网站和小程序调试的依赖关系排查指南
  - **核心理念**：很多问题表象在前端，根源在依赖层。先验证依赖，再调试本体。
  - 调试时必须按照依赖层级逐层排查：数据依赖 → 环境依赖 → 版本依赖 → 配置依赖 → 状态依赖 → 网络依赖 → 权限依赖 → 缓存依赖 → 构建依赖 → 运行时依赖
  - 详细规范请参考 `.agents/skills/jinhui-stack-debug/SKILL.md`
- **go-api-loadtest**: Go 后端食物分析 API 负载与稳定性测试工具
  - 基于 `backend/internal/analyze/loadtest/food_analysis_stability_test.go`，默认 20 个并发样例
  - 支持 `stagger`（间隔启动）和 `burst`（并发爆发）两种压测模式
  - 自动上传测试图片、提交分析任务、轮询结果、统计全链路延迟（submit / queue / processing / total）
  - 测试后自动清理 COS 对象和分析任务记录
  - 需使用 build tag `-tags=food_analysis_load` 运行，支持通过环境变量和 flag 灵活配置目标地址、请求数、模型、执行模式等
  - 详细规范请参考 `.agents/skills/go-api-loadtest/SKILL.md`

## 可用 SKILL（第一优先级）
- Build production-ready Go backend services following DDD-layered architecture.
  Covers project scaffolding, config (Viper), database (GORM + MySQL/PostgreSQL),
  object storage (S3/MinIO), OAuth2 + JWT auth, OpenTelemetry tracing + Jaeger
  visualization, Zap logging, middleware patterns, and API routing. Use when
  creating a new Go backend service or adding features to an existing one that
  follows this architecture.：[ddd-go-backend](.kimi/skills/ddd-go-backend/SKILL.md)

## 持久化状态

- 不要仅依赖对话记录来维持项目连续性。
- 在确认任何需求、决策、阻塞点、里程碑、所有权澄清或值得交接的后续步骤后，在最终回复前将持久化部分写入文件。
- 更新 `.local-state/current-task/active.md` 以记录当前正在进行的任务、状态、阻塞点或后续步骤。
- 更新 `.local-state/decisions/2026-05-active.md` 以记录应在会话重置后保留的稳定选择。
- 将日期笔记和简短交接记录追加到 `memory/YYYY-MM-DD.md`。
- 当用户说"记住这个"或纠正项目上下文时，将其记录下来，而不是仅保留在对话记忆中。

## 工作风格

- 倾向于直接编辑、具体验证和简短的状态更新。
- 除非在运行时中检查过或明确说明未验证，否则不要声称前端行为是正确的。

### 加载态规范

- 前端页面的加载态不显示“加载中”文字（包括“加载中...”“数据加载中”等文案）。
- 统一使用可视化 loading 动画（spinner/skeleton/shimmer 等）表达加载状态。
- 若确需文本提示，应只在错误态或空态出现，不用于纯加载中状态。

## 开发工作流程

### 运行开发服务器

> ⚠️ **重要提醒**：**开发模式下，代理改完前端代码后，绝对不要运行 `npm run build:weapp`。** 构建命令仅用于生产打包和真机预览，开发调试必须使用 watch 模式。代理在任何情况下都不应在开发迭代中触发完整构建。

- 开发时必须使用 `npm run dev:weapp` 启动开发服务器，**禁止用 `npm run build:weapp` 构建**。
- 该命令会正确设置 `NODE_ENV=development` 和 `TARO_APP_API_BASE_URL=http://127.0.0.1:3010`
- 需要**请求体验版后端**（真机体验版、或本机模拟器联调体验版 API）时：用 `npm run build:weapp:preview` 一次性构建，或 `npm run dev:weapp:preview`（watch + `https://dev.healthymax.cn`，与 `build:weapp:preview` 同源注入）
- 需要**请求正式线上后端**时：用 `npm run build:weapp:release` 一次性构建，或 `npm run dev:weapp:online`（watch + `https://healthymax.cn`）。
- 不要直接使用 `taro build --type weapp --watch`，这可能导致 API 地址错误

**真机预览 / 上传体验版**：必须使用体验版 API，勿用本机 `127.0.0.1`（真机无法访问电脑环回地址）。请使用：

- `npm run build:weapp:preview`（显式 `NODE_ENV=production` + `TARO_APP_API_BASE_URL=https://dev.healthymax.cn`）

或普通 `npm run build:weapp`（Taro 生产构建默认走 `config/index.ts` 中的 `https://dev.healthymax.cn`）。**不要**用 `dev:weapp` 的产物去真机扫码。

**正式版发布**：正式发布包才使用 `npm run build:weapp:release`，该命令显式注入 `https://healthymax.cn`。

### 后端数据库结构变更

- 修改后端数据库结构（新增、删除、重命名表/字段/索引/约束、调整字段类型、默认值、check、外键、触发器等）时，**禁止把手动执行 SQL 当作最终方案**，也不要只在终端里临时 `ALTER TABLE` / `CREATE INDEX` / `DROP ...` 修库后结束。
- 必须先把结构变更落到 Go 后端对应的数据模型中：优先修改 `backend/internal/migration/do/schema_do.go` 里的迁移 DO，让 DO 结构准确表达数据库表结构；如果业务读写也需要新字段，再按 DDD 分层同步调整对应 domain、repo、service、DTO/handler。不要用 domain struct 替代迁移 DO，也不要让数据库结构只存在于临时 SQL 里。
- 对 AutoMigrate 不能可靠表达或必须稳定命名的内容（例如已有约束名、唯一索引、partial index、check 约束、外键、触发器、数据修正步骤），应在 `backend/internal/migration/migration.go` 中补充幂等迁移逻辑，保证重复运行安全。
- 完成模型/迁移代码后，从 `backend/` 目录运行 `go run ./cmd/migration -config-dir .` 更新当前配置指向的数据库。运行前必须确认 `backend/config.yaml` 与环境变量实际指向的目标库；如果是非本地库、线上库或不确定目标库，先获得用户明确确认，再执行。
- 只读查询可用于诊断和验证；修复性 SQL 只能作为迁移命令中的幂等步骤落代码。确有紧急人工 SQL 需求时，必须先说明风险并获得用户明确授权，事后仍要把等价变更补回迁移 DO/迁移代码并运行迁移命令验证。

### 代码修改后重启前后端（默认由用户自行执行）

- 默认不要替用户自动启动、停止、重启、常驻任何本地前后端进程。
- 本项目的本地开发服务器统一由用户自己手动启动和关闭；代理只负责改代码、提示需要重启，不负责代为运行。
- 即使完成了会影响运行结果的修改（例如 `backend/` Python、`src/` 前端业务与配置），也不要擅自抢占 `3010`、watch 进程或清理用户当前会话。
- 只有当用户在当前对话里明确要求“你来启动 / 你来停止 / 你来重启 / 你来运行”时，代理才可以操作本地常驻进程。
- **无需**为纯文档、仅单测断言、仅格式化等改动反复重启。
- 推荐一键：`npm run dev:restart`（调用 `scripts/restart-dev.sh`：先结束残留的 `run_backend.py` 与 `taro build --type weapp`，再以 `nohup` 后台启动 `dev:backend` 与 `dev:weapp`，日志写入项目根目录 `backend-dev.log`、`weapp-dev.log`）。
- 若用户已在其它终端手动跑 watch，可先与其确认再 `pkill`，避免误关无关进程。

### 发布新版本（含「我的」页版本号）

当用户**明确要发布新版本**并给出**版本号**（如 `2.0.15`）时，代理须完成与版本相关的全部同步，避免「我的」页底部仍显示旧号：

1. **以 `package.json` 的 `version` 为唯一来源**：使用 `npm version <x.y.z> --no-git-tag-version`（或等价地同时更新 `package.json` 与 `package-lock.json` 根级 `version`）。
2. **「我的」页底部文案**：`src/pages/profile/index.tsx` 中版本展示由构建常量 `__APP_VERSION__` 注入（在 `config/index.ts` 的 `defineConstants` 中从根目录 `package.json` 读取）。**只要第 1 步已正确 bump，无需再手改该页硬编码字符串**；若历史上曾写死版本号，应改为使用 `__APP_VERSION__` 以保持与发布版本一致。
3. 按项目惯例更新 `PROGRESS.md`、执行提交与推送；若用户还要求打 tag、上传小程序体验版等，按其说明继续。

### 提交前清理

- 提交代码前必须清理项目根目录下的临时文件
- 已配置 git pre-commit hook 自动删除以下文件：
  - `*.png` (调试截图)
  - `*.html` (预览文件)
  - `*.py` (调试脚本)
  - `*.js` (根目录下的临时 JS 文件，不包括 src/ 和 config/ 等子目录)
- Hook 位置：`.husky/pre-commit`
- 如需手动运行清理：`find . -maxdepth 1 -name "*.png" -o -name "*.html" -o -name "*.py" -o -name "*.js" -type f -delete`


## 部署


### 后端部署

部署后端统一通过以下命令执行（在仓库根目录）：

```bash
npm run push-docker-ccr
```

- 该命令会调用：`backend/scripts/push-docker-ccr.mjs`
- 镜像路径：`ccr.ccs.tencentyun.com/littlehorse/foodlink`
- 镜像标签：按当前分支映射，`main` 分支推送 `:main`，`dev` 分支推送 `:dev`
- 构建上下文：`backend/`（使用 `backend/Dockerfile`）
- 默认构建平台：`linux/amd64`（避免 ARM 开发机构建后在 AMD64 服务器不可运行）
- 如需覆盖平台（例如构建多架构清单），可设置环境变量：
  - PowerShell：`$env:DOCKER_BUILD_PLATFORM="linux/amd64,linux/arm64"; npm run push-docker-ccr`
  - Bash：`DOCKER_BUILD_PLATFORM=linux/amd64,linux/arm64 npm run push-docker-ccr`
- 默认 Go builder 基础镜像候选会按顺序自动重试：
  - `docker.io/library/golang:1.26.1-bookworm`
  - `docker.m.daocloud.io/library/golang:1.26.1-bookworm`
  - `docker.xuanyuan.me/library/golang:1.26.1-bookworm`
  - `docker.1ms.run/library/golang:1.26.1-bookworm`
  - `docker.1panel.live/library/golang:1.26.1-bookworm`
- 如需临时覆盖为单个 Go builder 基础镜像：
  - PowerShell：`$env:DOCKER_GO_BUILDER_IMAGE="docker.m.daocloud.io/library/golang:1.26.1-bookworm"; npm run push-docker-ccr`
  - Bash：`DOCKER_GO_BUILDER_IMAGE=docker.m.daocloud.io/library/golang:1.26.1-bookworm npm run push-docker-ccr`
- 如需临时覆盖为多个候选镜像：
  - PowerShell：`$env:DOCKER_GO_BUILDER_IMAGES="docker.m.daocloud.io/library/golang:1.26.1-bookworm,docker.xuanyuan.me/library/golang:1.26.1-bookworm"; npm run push-docker-ccr`
  - Bash：`DOCKER_GO_BUILDER_IMAGES=docker.m.daocloud.io/library/golang:1.26.1-bookworm,docker.xuanyuan.me/library/golang:1.26.1-bookworm npm run push-docker-ccr`
- 标签规则：
  - `main` 分支推送 `ccr.ccs.tencentyun.com/littlehorse/foodlink:main`
  - `dev` 分支推送 `ccr.ccs.tencentyun.com/littlehorse/foodlink:dev`
  - 其它分支拒绝执行
  - 脚本仍会打印当前分支和 7 位 commit sha，便于人工确认来源
- 脚本位置：`backend/scripts/push-docker-ccr.mjs`
- 依赖要求：
  - 本机已安装并启动 Docker（`docker version` 可用）
  - 本机可用 Buildx（`docker buildx version` 可用）
- 若推送报鉴权或权限错误，先执行 `docker login ccr.ccs.tencentyun.com` 完成登录，再重新执行推送。
- 部署端已配置自动更新脚本；镜像推送成功后，服务会在 5 分钟内自动完成更新。

#### 后端部署标准操作（一步步）

1. 确认当前分支和 commit 是需要发布的 Go 后端版本
2. 本机确认 Docker/Buildx 可用：
   - `docker version`
   - `docker buildx version`
3. 登录腾讯云镜像仓库（如未登录）：
   - `docker login ccr.ccs.tencentyun.com`
4. 执行推送：
   - `npm run push-docker-ccr`
5. 等待部署端自动拉取并更新（约 5 分钟）
6. 如需上机确认，可 SSH 到服务器检查服务状态：
   - `ssh root@coachlink.fit`
   - `systemctl status food-backend.service`

#### 常见故障与排查

- `no matching manifest for linux/amd64` / `exec format error`
  - 通常是镜像平台不匹配；确认脚本输出里 `构建平台` 是否为 `linux/amd64`
- `unauthorized` / `denied: requested access`
  - 重新执行 `docker login ccr.ccs.tencentyun.com`
- `docker buildx` 不可用
  - 升级或重装 Docker Desktop，确保 Buildx 启用
- `failed to fetch anonymous token` / `auth.docker.io` / `registry-1.docker.io` / `load metadata for docker.io/library/golang`
  - 这是拉取 Go builder 基础镜像失败，不是腾讯云 CCR 登录失败
  - 脚本默认会自动尝试 DaoCloud、xuanyuan、1ms、1panel 等镜像源；如仍失败，再检查 Docker Desktop 代理或用 `DOCKER_GO_BUILDER_IMAGES` 指定新的候选列表
- 推送成功但线上未生效
  - 等待自动更新窗口（约 5 分钟）后，再检查 `food-backend.service` 状态与镜像拉取日志

## 端到端测试 / 自动化测试

详细文档见 `backend/e2e-test/README.md`，以下是快速参考。

本项目有两套自动化测试系统，**共用同一套临时数据库初始化机制**，但运行时完全独立：

### 1. 纯后端 API 契约测试

**定义**：进程内直接调用 Go Gin router，验证 HTTP 边界行为（请求方法、路径、认证、响应状态码、响应头、JSON body）。不涉及前端/小程序。

**入口**：`backend/e2e-test/cmd/api-contract-test/main.go`

**命令**：
```bash
# 运行全部用例（含路由冒烟 + cases/*/*.yaml）
npm run test:backend:api-contract

# 常用参数（需在 backend/ 目录用 go run 执行）
go run ./e2e-test/cmd/api-contract-test --list                # 列出所有用例
go run ./e2e-test/cmd/api-contract-test --case user.profile.success  # 单条用例
go run ./e2e-test/cmd/api-contract-test --group health        # 按分组运行
go run ./e2e-test/cmd/api-contract-test --keep-db             # 保留临时数据库（调试用）
```

**用例位置**：`backend/e2e-test/cases/*/*.yaml`（按模块分组，当前 16 个 YAML 文件）

### 2. 微信小程序端到端测试（全量 / Trace）

**定义**：启动真实 HTTP server，通过 `miniprogram-automator`（`mrc` CLI）操作微信开发者工具中的小程序，验证完整链路「前端渲染 → API 调用 → 数据库读写」。

**入口**：
- `e2e-weapp/src/runner.ts` — 单场景执行
- `e2e-weapp/src/trace-runner.ts` — 多 Trace 聚合执行

**命令**：
```bash
# 单场景（home-dashboard）
npm run test:e2e-weapp

# 冒烟测试（验证整条链路可跑通）
npm run test:e2e-weapp:smoke

# Trace 聚合测试（如食物识别流程）
npm run test:e2e-weapp:traces
```

**用例位置**：
- `e2e-weapp/scenarios/*.yaml` — 场景级用例
- `e2e-weapp/traces/*.yaml` — 用户旅程级用例

### 3. 冒烟测试

后端 API 契约测试会自动生成「路由冒烟」用例（suite.yaml 中 `route_smoke.enabled: true`），用通用参数请求所有已注册路由，验证不会 panic 且状态码在允许列表内。

小程序端到端也有独立的 smoke 用例：`e2e-weapp/scenarios/smoke.yaml`

### 4. 公用临时数据库初始化

两套测试系统共用以下配置和 fixtures：

| 文件 | 作用 |
|-----|------|
| `backend/e2e-test/suite.yaml` | 全局配置：临时数据库参数、认证用户定义、seed_sql 文件列表、case_files 路径、路由冒烟配置 |
| `backend/e2e-test/fixtures/base.sql` | 种子数据 SQL，每次运行创建全新临时数据库后注入。预置 2 个测试用户、会员配置、饮食记录、体重、运动、过期食品、手动食物库、菜谱等数据 |
| `backend/e2e-test/runner/db.go` | 临时数据库引擎：创建数据库 → AutoMigrate 建表 → 返回连接 |
| `backend/e2e-test/runner/fixtures.go` | 读取 `seed_sql` 列表，执行变量替换（如 `{{auth.user1.id}}`）后注入 |

SQL 支持变量替换，可用变量见 `suite.yaml` 的 `auth.users` 和 `default_vars`。

### 前端部署

微信小程序前端**不通过此服务器部署**，需使用微信开发者工具上传。

## 图标更新

当前项目使用iconfont作为图标系统。更新图标的命令为 python scripts/update-icon.py

## 前端缓存与数据不一致排查

当用户反馈「前端渲染数据不及时」「数据看起来不对」时，按以下顺序排查：

1. **先确认服务端数据是否正确** — 直接查数据库或调用对应接口验证
2. **检查是否为本地缓存导致** — 引导用户进入 **「我的」→「清除缓存」**，然后下拉刷新或重新进入页面
3. **若清除缓存后仍不一致** — 问题在服务端，继续按接口维度排查

完整的缓存字段清单、对应页面与后端接口关系，详见 `docs/frontend-cache-design.md`。

> 新增涉及用户感知数据的本地缓存时，须同步更新 `src/pages/profile/index.tsx` 的 `handleClearCache`，确保用户可通过「清除缓存」重置。

## 调试规范（必须遵守 jinhui-stack-debug）

当调试陷入僵局时，**必须**按照 `jinhui-stack-debug` 技能的依赖关系排查指南逐层排查：

### 排查优先级（由高到低）

1. **数据依赖** - 前端表现依赖于后端数据的正确性。页面显示异常时，先验证接口返回，再排查前端渲染。
2. **环境依赖** - 不同运行环境导致行为差异。本地正常但线上异常时，检查环境变量、域名、协议等差异。
3. **版本依赖** - 依赖库/框架版本不兼容。升级后功能异常时，检查版本变更和 breaking changes。
4. **配置依赖** - 配置文件错误或遗漏。白名单、API密钥、路由配置等问题。
5. **状态依赖** - 组件/应用状态管理问题。刷新后正常、切换页面后数据丢失等。
6. **网络依赖** - 网络层通信问题。请求超时、跨域报错、404/500 错误等。
7. **权限依赖** - 用户权限或接口权限不足。功能按钮不显示、接口返回 403 等。
8. **缓存依赖** - 各类缓存导致代码不生效。改代码后页面无变化、用户看到旧版本等。
9. **构建依赖** - 构建工具或产物问题。代码没生效、sourcemap 不匹配等。
10. **运行时依赖** - 浏览器/宿主环境差异。某浏览器正常某浏览器异常、iOS/Android 表现不一致等。

### 核心原则

- **先验证依赖，再调试本体**：很多问题表象在前端，根源在依赖层
- **逐层排查，避免在低层级问题上浪费时间**
- 详细排查方法请参考 `.agents/skills/jinhui-stack-debug/` 目录下各依赖类型的具体文档

## 红线

- 除非重新读取状态文件，否则不要根据过期的对话记忆回答项目所有权、当前任务或决策历史。
- 当 `IDENTITY.md` 和状态文件存在时，不要声称自己未被分配或不确定自己负责哪个项目。
- 默认情况下不要切换到其他项目。


## 日志规范

后端统一使用 `pkg/logger` 中基于 `log/slog` 的结构化日志，不再使用 `zap`，也不要直接使用 Gin 默认的 `gin.Logger()`。日志入口由 `internal/app.New` 初始化，`logger.RequestLogger()` 负责记录每个 HTTP 请求的结构化访问日志。

日志配置在 `config.yaml` 的 `log` 节中维护：

```yaml
log:
  # debug/info/warn/error
  level: info
  # json/text
  format: json
  # stdout/file/both
  output: stdout
  file_path: logs/food-link-backend.log
```

启用 `otel.enabled` 时，日志会同时通过 `otelslog` 和 OTLP gRPC 上报到 OpenTelemetry Collector。业务代码通过 `logger.Info/Warn/Error` 传入 `context.Context` 后，日志会自动附带 `trace_id` 和 `span_id`，便于在查看 trace 时关联到同一次请求的日志。

业务代码中添加日志时，使用下面的形式：

```go
logger.Info(ctx, "云端项目保存完成",
	slog.String("user_id", userID),
	slog.String("project_id", project.ID),
	slog.Int64("project.version", project.Version),
)

logger.Error(ctx, "保存云端项目失败", err,
	slog.String("user_id", userID),
	slog.String("project_id", project.ID),
)
```

日志消息必须使用中文；结构化字段名保持英文，例如 `user_id`、`project_id`、`http.status_code`、`trace_id`，方便日志平台过滤、聚合和跨系统关联。不要把完整请求体、项目快照、token、密码、OAuth code、邀请码明文等敏感或体积大的内容写入日志，只记录必要的 ID、状态、数量、版本、字节数和错误原因。

后续新增或修改 API 时，必须在关键位置补充日志：

- handler 层记录请求进入和成功完成，包含当前用户、资源 ID、主要动作和返回数量等摘要信息。
- service 层记录关键业务分支，例如创建转更新、权限校验失败、配额检查、状态流转、成员或邀请码变更。
- repo/外部依赖调用失败时，在 service 层记录错误日志，并带上定位问题所需的资源 ID。
- 对应的 trace 事件如果已经使用 `pkg/trace.RecordError`，事件名称也应使用中文，并与日志语义保持一致。
- 对预期内的业务错误使用 `Warn`，对数据库、外部服务、不可恢复异常使用 `Error`，正常关键状态变化使用 `Info`。
