---
name: release
description: 处理FoodLink的提交、分支同步、后端部署或小程序上传发布请求；根据用户指定范围完成链路并记录实际状态。
---

# FoodLink发布

先读根AGENTS.md、docs/STATE.md；具体部署、数据库、契约测试分别按需读 docs/runbooks/deploy.md、db-migration.md、e2e.md。

- 将用户要求映射到实际目标。只提交仅本地Git提交；推送、同步main、双后端、体验版、提审和正式发布各有范围。用户明确完整发版时盘点所需目标并在已授权范围内连续完成，不重复索要确认。
- 先确认Git根、dev、已有改动、remote和候选commit；git diff与敏感信息检查后只暂存具体路径。用户要求所有修改时审阅全量差异并列明排除项，不能把密钥、个人名单和临时产物提交。
- 必要检查在推送/部署前执行一次；文档修改只做文档检查。代码按需用现有 npm run typecheck、npm test -- --runInBand <相关测试路径>，Go只跑相关包。测试子进程临时目录在D:/cache/agent-tests下本任务目录，设置TEMP/TMP/TMPDIR/GOTMPDIR/FOODLINK_TEST_TMPDIR，不全局修改。
- 同步分支前核对远端最新引用和冲突，明确合并后的本地main确实包含dev；git push --atomic origin main:main dev:dev 只用于已准备且已授权的双引用推送，不负责合并。存在他人WIP时不强制切换、reset、stash或新建worktree。
- 后端命令为 npm run push-docker-ccr，会本机构建Docker；遵守磁盘与构建授权，优先既有产物。先核对主机/集群和回滚，按授权先dev后main，核验实际镜像、期望副本就绪与 /api/health；不能仅凭推送成功交付。
- 非本地迁移另核对授权与共享库，先备份受影响范围、实际可用预览/隔离验证，执行后回读。cmd/migration没有通用--dry-run，不编造参数。
- 需新小程序包时按用户版本执行 npm version <版本> --no-git-tag-version（真实修改package与lock），npm run build:weapp只构建一次生产包。已知有效包优先复用；新包路径/缓存输出须符合磁盘约束。
- 按现有 .agents/skills/weapp-devtools/SKILL.md 核对AppID、固定包并上传，验真实回执。后台设体验、提审和正式发布分别记录，未获对应授权时不执行。与上传版本相关的Git变更必须纳入所报commit，避免上传代码和Git版本脱节。
- 每一步失败停止依赖后续动作，报告实际完成步骤、阻塞和可恢复点，不自动重复推送/迁移/开窗。交付列本地commit、远端dev/main、双后端镜像/验证、体验上传/指向、审核/正式状态，未做和未验明确标记。仅提交任务按实际范围简写。
