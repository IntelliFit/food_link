# food_link 项目代理规则

本工作区专用于 `food_link` 项目。

## 会话启动

- 在每个新会话开始时，以及在上下文压缩后，回复前请先读取 `IDENTITY.md`、`SOUL.md` 和 `USER.md`。
- 然后读取 `PROJECT_STATE.md`、`CURRENT_TASK.md` 和 `DECISIONS.md`。
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

## 持久化状态

- 不要仅依赖对话记录来维持项目连续性。
- 在确认任何需求、决策、阻塞点、里程碑、所有权澄清或值得交接的后续步骤后，在最终回复前将持久化部分写入文件。
- 更新 `CURRENT_TASK.md` 以记录当前正在进行的任务、状态、阻塞点或后续步骤。
- 更新 `DECISIONS.md` 以记录应在会话重置后保留的稳定选择。
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

- 开发时必须使用 `npm run dev:weapp` 启动开发服务器，禁止用 `npm run build:weapp` 构建。
- 该命令会正确设置 `NODE_ENV=development` 和 `TARO_APP_API_BASE_URL=http://127.0.0.1:3010`
- 需要**请求线上后端**（真机、或本机模拟器联调生产 API）时：用 `npm run build:weapp:preview` 一次性构建，或 `npm run dev:weapp:online`（watch + `https://healthymax.cn`，与 `build:weapp:preview` 同源注入）
- 不要直接使用 `taro build --type weapp --watch`，这可能导致 API 地址错误

**真机预览 / 上传体验版**：必须使用生产 API，勿用本机 `127.0.0.1`（真机无法访问电脑环回地址）。请使用：

- `npm run build:weapp:preview`（显式 `NODE_ENV=production` + `TARO_APP_API_BASE_URL=https://healthymax.cn`）

或普通 `npm run build:weapp`（Taro 生产构建默认走 `config/index.ts` 中的 `https://healthymax.cn`）。**不要**用 `dev:weapp` 的产物去真机扫码。

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
- 构建上下文：`backend/`（使用 `backend/Dockerfile`）
- 默认构建平台：`linux/amd64`（避免 ARM 开发机构建后在 AMD64 服务器不可运行）
- 如需覆盖平台（例如构建多架构清单），可设置环境变量：
  - PowerShell：`$env:DOCKER_BUILD_PLATFORM="linux/amd64,linux/arm64"; npm run push-docker-ccr`
  - Bash：`DOCKER_BUILD_PLATFORM=linux/amd64,linux/arm64 npm run push-docker-ccr`
- 分支与标签映射：
  - `main` → `:latest`、`:main`、`:<7位 commit sha>`
  - `dev` → `:dev`、`:<7位 commit sha>`
  - 其他分支 → 脚本会提示先切换到 `main` 或 `dev`
- 脚本位置：`backend/scripts/push-docker-ccr.mjs`
- 依赖要求：
  - 本机已安装并启动 Docker（`docker version` 可用）
  - 本机可用 Buildx（`docker buildx version` 可用）
- 若推送报鉴权或权限错误，先执行 `docker login ccr.ccs.tencentyun.com` 完成登录，再重新执行推送。
- 部署端已配置自动更新脚本；镜像推送成功后，服务会在 5 分钟内自动完成更新。

#### 后端部署标准操作（一步步）

1. 确认当前分支为 `main` 或 `dev`，并完成需要发布的提交
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
- 推送成功但线上未生效
  - 等待自动更新窗口（约 5 分钟）后，再检查 `food-backend.service` 状态与镜像拉取日志

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
