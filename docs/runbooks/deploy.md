# FoodLink部署与本地进程

仅在任务要求相应操作时使用。以下脚本已静态核对存在，本轮没有执行构建、推送、登录、重启或部署。

## 当前发布边界

- `npm run push-docker-ccr` 会本机构建Docker并推送镜像，必须先满足用户的构建授权和磁盘约束；不能为验证文档运行它。
- 当前发布记录为CCR/K8s，镜像标签按main/dev映射。旧systemctl检查方法保存在原规则归档，不作为当前验收。自动更新机制与更新时间须在下次发布时只读核实，不能承诺“推完5分钟必定生效”。
- 发布先确认目标项目、主机、context、namespace、Deployment、当前镜像/副本、数据库与回滚版本；主机清单需读现有server-catalog，缺少时先补足目标信息，不猜SSH别名。
- Git同步与发布授权分开。固定候选commit、通过必要定向检查后才推；主分支同步必须真实包含dev，atomic push不会帮忙合并。
- 上机确认目标Deployment的实际imageID、全部期望副本Ready及健康路由 `/api/health`；需鉴权路径不应把401误判失败，更不能只以公共页面200声称全部业务正常。
- 共享生产数据库迁移见 `db-migration.md`，执行后再部署需要新结构的应用。先dev验证，再按授权处理main；某步失败停在该步，保留已完成结果和回滚证据。
- 小程序必须生产包并经现有weapp-devtools上传；上传成功、后台设体验、提审和正式发布分别记录。版本来自根package.json，不手改“我的”展示常量。

## 镜像脚本参数与排错资料

以下从原AGENTS搬入，与当前 `backend/scripts/push-docker-ccr.mjs` 的命令、镜像平台和候选列表核对一致；鉴权登录、重装软件等动作仍需任务授权。

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
- 旧记录曾描述部署端自动更新；本轮未连接服务器确认其机制或耗时。以发布时目标K8s实际镜像和就绪结果为准。

镜像拉取失败先区分基础Go镜像源、CCR鉴权和平台不匹配；重试已有候选前核对实际错误，不默认重装Docker或全局清缓存。推送成功但未更新时查目标K8s实际镜像和更新日志，不重复推相同内容。

## 本地调试资源

### 本地开发进程：跨对话复用与登记

- 用户已授权代理为本项目必要的开发调试和微信 UI 验收启动本地环境。此授权跨对话保留，不能每个对话重复询问、重复启动；生产部署仍按用户的发布指令执行。
- Windows 上统一通过 `scripts/dev-process.ps1` 管理本地 watch/后端。例如：`pwsh -NoProfile -File scripts/dev-process.ps1 -Action Start -Service weapp -TaskId <当前对话ID>`。开始前先用 `-Action Status` 查看共享登记和实际进程，禁止绕过管理器直接重复启动。
- 登记文件为 `.local-state/runtime/dev-processes.json`，启动/释放使用同目录文件锁。每个服务登记 PID、启动时间、命令、日志和使用它的对话；检查 PID 与启动时间，避免 PID 被复用后误认进程。只有拿到锁并重新检查实际状态后才可启动。
- 已有同项目进程必须复用；没有登记的人工进程仅识别和复用，不取得停止权限。`3010` 被其它进程占用、无法确定某个 watch 所属项目或登记与实际不一致时，先诊断，不抢占、不批量清理、不并行补开第二份。
- 微信开发者工具先读取目标项目运行时；已开则复用，未开才打开同一个 `apps/wechat` 项目。不要创建重复窗口或使用其它项目的默认运行时。
- 临时验收结束用 `-Action Release -Service weapp -TaskId <当前对话ID>` 释放本对话的使用登记。只有该进程由管理器启动、身份匹配且没有其他对话使用时才停止其进程树；不使用 `pkill`、全部 node/go 进程清理或无差别 `dev:restart`。
- 修改后默认利用现有 watch；后端需要重启时先确认所有使用者及配置目标。纯文档、测试断言和格式化无需重启。截图使用测试接口时明确标注，不为截图启动会写真实业务数据的任务 worker。
- 前端仍只运行 `npm run dev:weapp`，禁止在开发迭代运行 `build:weapp`。代理启动的后台窗口使用 Hidden；交付时说明复用/启动/释放结果与剩余进程。
