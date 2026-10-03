# APP 业务提醒（首轮）

基线：origin/dev 383737b7。代码尚未迁移、部署或接入线上数据库。

## 用户侧

在「我的 → 消息提醒」主动开启并保存，默认不开启。全局偏好按账号保存，设备按安装实例绑定，最多保留五个活跃实例。

| 类别 | 默认时间（Asia/Shanghai） | 发送前再次检查 | 点击后 |
| --- | --- | --- | --- |
| 用餐 | 08:00 / 12:00 / 18:30 | 该日该餐未记录 | 免费真实餐食建议 |
| 当天漏记 | 21:00，独立开关默认关闭 | 当日完全没有饮食记录 | 当天饮食记录 |
| 临期食物 | 09:00 | 今日至后两日标注到期、状态 active；合并一条 | 食物保质期 |

可修改时间、IANA 时区和免打扰（默认22:00–07:00）。推送文案不包含私人食物名或健康指标；不自动调用付费 AI、不扣积分。餐食建议复用小程序 `POST /api/diet/recommendations/preview`，当前 APP 未接实时定位，展示历史/符合档案的校园选项，明确提示历史记录不是当前有售证明。「聊聊这餐」仅预填问题，不自动发送。

## 服务端启用顺序（待确认目标环境后执行）

本次 APP 同步还接入学生身份/学校/校区偏好（共用健康档案，不等同于校园准入资格）及按日起床日期的睡眠记录（共用 sleep-records API）。保留旧 APP 的营养目标、公共食物地图、采集资格、补剂按份剂量和圈子时间展示改动；没有覆盖旧工作树未提交内容。GPS 附近检索和小程序首页全部布局并未声称完全一致。

1. 审查、合并代码，并确认当前实际配置源（本地 app-config.yaml 或 Apollo app-config.yaml）及数据库 host/name/schema。非本地库必须先获用户明确确认。
2. 从 `backend/` 运行 `go run ./cmd/migration -config-dir .`。结构位于 migration DO 和幂等约束代码，不用临时 SQL 代替。此命令是全仓现有迁移，执行前同时审查其他待迁移内容。HTTP 服务启动不迁移数据库。
3. 在选定环境的私有配置中启用：

   ```yaml
   push:
     enabled: true
     expo_project_id: "454db191-c9ba-42f1-a486-f42535774c3b"
     expo_access_token: ""
   ```

   如 Expo 开启 enhanced push security，access token 必须由服务端私有配置提供。FCM V1/APNs 密钥保留在 Expo；不得放入 APP、Git 或报告。本地配置支持 PUSH_ENABLED / PUSH_EXPO_PROJECT_ID / PUSH_EXPO_ACCESS_TOKEN，Apollo 模式遵循现有配置优先级，推荐显式配置上述节。
4. 部署/重启对应环境后端，再安装同一 Expo project ID 的独立 APP 包。Spark Firebase 项目与未上架安装包不影响现有 Expo 基础链路。普通无 Google 服务的国内 Android 手机覆盖没有在本轮解决。
5. 使用专用测试账号进入设置 → 开启 → 保存；选免打扰外的近期时间。核对设备绑定、发送、系统显示、点击、已记录跳过、关闭、退出解绑及失效 token 回执。不得把 ticket/receipt 的服务商接受状态当作设备实际送达。

## API 和队列

JWT 保护：GET/PUT `/api/push/preferences`、PUT/DELETE `/api/push/devices/:installation_id`。GET 返回 preferences 与 push_available。后端总开关关闭时不能开启用户设置或新增设备；已绑定设备仍可解绑。

后台每分钟扫描；账号/安装/类别/餐次/本地日期唯一键防止正常重复入队。数据库 planner advisory lock + SKIP LOCKED claim 支持多副本；两分钟租约、最多三次发送尝试。只补过去十分钟触发，三十分钟后取消，配置变更/已记录/食物状态变更/设备换账号或换 token 都取消过时任务。Expo tag/collapseId 降低重试重复展示；外部网络的模糊失败不具备严格 exactly-once 保证。

十五分钟后查 receipt，未准备好则五分钟后再查，二十三小时后记 receipt_unknown。DeviceNotRegistered 停用对应 token；不记录原始 provider 错误、token 或凭据。设备三十天不活跃清理，发送元数据保留三十天。

APP 只有主动开启时申请系统通知权限；启动/前台与 token 变化仅在既有授权且已开启时续绑。退出先解绑，再清登录；已知绑定解绑失败时保留登录并提示重试。点击只允许 MealSuggestions / DayRecord / Expiry，核对当前账号，不接受任意 URL。

## 验证范围

遵守用户选择，不新增测试文件。复用现有 API-client、配置和餐食业务测试，以及 Go 编译/vet、APP TypeScript、Metro 打包和 Android 页面检查。新队列的真实数据库与真实业务推送联调尚需确认目标环境、执行迁移并部署后完成。微信工具3001未开启时无法取得小程序运行证据；不得以 APP 检查代替微信验收。

2026-10-03：APP TypeScript 通过，现有 API-client 49/49 通过，配置及餐食/睡眠校验相关现有测试通过，push 模块编译/vet 通过。已有数据库测试因 embedded PostgreSQL initdb 的 Windows 0xc0000135 失败；未连接远程库补跑。Pixel_7/emulator-5560 安装保留原登录数据，实际进入提醒页得到 dev API 404（尚未部署），失败路径展示与重试可检查，不能据此声称设置保存或业务推送送达已验证。

预览 APK 复用原已验签 native 壳，只替换由本工作树重新生成的 Hermes bundle（smoke=0）；30项静态资源逐一与原 native 输入比对一致，再用既有 debug keystore 验签。不用于商店发布或替代完整原生 release 构建。

Pixel_7 v3运行证据（tmp/reminder-preview-v3/）：提醒页未部署中文错误及点击重试返回同一错误；首页进入餐食建议，切换早餐后标题/检索更新（当前测试账号返回空候选而非伪造餐食）；进入校园偏好，点击学生显出学校选择区（没有保存）；首页进入睡眠表单，读取该日并切换前一日起床日期（没有保存/删除）。截图 settings-unavailable.png / meal-suggestions.png / campus-settings.png / sleep-record.png，对应窗口XML保留。未验证新提醒保存成功、业务定时投递、receipt或点击通知全链路。

### 合入开发分支前的补充检查（2026-10-03）

已同步后续官网提交至 `origin/dev@4e3c33b7`，没有覆盖主工作区的其他未提交修改。APP/小程序类型检查、共享 API-client 49 项测试、小程序 85 个套件共 281 项测试，以及 push/app/config 的现有 Go 检查通过。Windows PostgreSQL 缓存缺失 DLL/share 的问题用本机完整 PostgreSQL 17 的只读二进制路径和独立测试目录解决；三个既有 SQLite 用例以进程级 CGO 编译工具补跑，完整 migration/user service 包通过，没有修改或新增测试文件。

使用正常 `cmd/migration` 对唯一的本地临时验证库连续运行两次成功，验证新表、索引与约束可重复安装。此结果不代表 development/production 已迁移；远程目标的迁移、启用推送与部署仍须确认。

官网 Android 发布沿用现有约定：`dev` 对应 beta/development API，`main` 对应 stable/production API。发布前的独立 TLS 检查发现下载域名 `download.healthymax.cn` 证书于 2026-09-14 13:59:59 UTC 到期；主页 `healthymax.cn` HTTPS 正常。Apollo 发布配置指定的 `foodlink-release.keystore` 本机未找到。不得关闭证书验证、覆盖正式下载通道或把 debug 签名体验包冒称正式发布包。
