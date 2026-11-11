# 食物数量单位

2026-11-10 本地实现，尚未迁移共享数据库、提交或发布。微信开发者工具此前连接失败，本轮没有新的真机或目标视口截图验收。

## 数据约定

食物及录餐条目新增可选 `measurement`，保存数量 `amount`、单位 `unit`、营养对应数量 `basis_amount`、营养对应单位 `basis_unit` 和 `nutrients_per_basis`。单位为 `g`、`ml`、`piece`、`serving`。

`unit_conversions` 的值表示一个指定单位等于多少个 `basis_unit`。没有明确关系时禁止跨单位换算，不假定 1ml 等于 1g，也不推算一个/一份的克重。

| 输入 | 营养结果 | 克重 |
| --- | --- | --- |
| 250ml，每100ml为60kcal | 150kcal | 未知 |
| 2个，每1个为80kcal | 160kcal | 未知 |
| 1份，明确每份150g，每100g为200kcal | 300kcal | 150g |

旧的 `weight`、`intake`、`default_weight_grams` 只保存有依据的克重，未知时为0。`nutrients_per_100g` 只有能明确换算成克时才提供。录餐快照的 `amount` 和营养数值对应整份，实际摄入再乘 `ratio / 100`；修改快照不修改公共食物。

旧数据缺少 `measurement` 时沿用旧逻辑，不回填或改写历史记录。旧客户端丢失新版非克单位时，保存/编辑会返回409，防止自动当克记录。

## 涉及入口

自定义手录、包装识别导入、食物库卡片/详情/选择、拍照结果的食物库替换与数量调整、录餐保存/编辑、录餐详情和圈子记录详情。营养口径不明的包装不会根据容器容量猜测口径；结果页需确认包装规格。

计算入口：前端 `apps/wechat/src/utils/food-measure.ts`；后端 `backend/internal/foodmeasure/measurement.go`。定向用例见同名单位测试及 `meal-record-native-units.test.tsx`、`foodrecord/service/food_measurement_test.go`、`utility/repo/manual_food_measurement_test.go`。

## 发布依赖

仅新增 `user_custom_foods.measurement JSONB NULL`；录餐原有JSON快照无需新增列。专项入口 `backend/cmd/food-measurement-migration` 默认只读预检；写入需 `-apply`，并精确提供 `-expected-host`、`-expected-database`、`-expected-schema`。

执行共享库迁移必须另获授权并按数据库迁移runbook核对目标、备份及回读。本地已验证专项迁移重复执行和旧克重记录保留。上线顺序为迁移、后端、小程序配套发布；不能只上传小程序。

## 验证与临时文件

106条前端定向用例、微信全项目类型检查和20个业务文件lint通过。Go原生单位计算、公共自定义保存/读取、录餐持久化/修改及旧客户端兼容、隔离PG的重复迁移/旧数据保留、实验关闭仍输出包装单位元数据的定向用例通过。微信运行验收尚缺。

本任务临时目录为 `D:/cache/agent-tests/food-units-records-20261110`（约6.05MB）、`food-units-wechat-20261110`（同一父目录，约4.32MB）、`food-units-backend-20261110`（同一父目录，约0.80MB），不含复用的共享Go缓存与PG二进制。临时PG均已停止。自动审批以 `blocked by policy` 拒绝清理，未绕过限制；后续可清理前两目录的 `jest-cache`、`node-compile-cache`，以及第三目录 `result/` 下同名两缓存。保留日志；不要沿 `embedded-postgres-go/bin` 链接删除共享二进制。

## 2026-11-12：用户定义每份大小与导入列表

每份设置从照片设置独立出来。用户可直接填写“1份/个相当于多少g/ml”，也可用整包总量除以份数，设为默认1份。比如90g÷15份=6g；保存仍保留原标签每100g营养，录2份时按12g计算。不从包装照片猜测未标注的小份重量。

“自定义”页面同时汇总自己的手动新建和包装导入。包装来源由本人 `reward_task_uploads` 的包装记录、以及已完成 `packaged_product_extract` 的实际入库ID关联，按公共包装ID去重，不以是否获得奖励判断是否显示。下架/待审核包装不展示；公共包装继续保留 `packaged_food` 来源及纠错权限，导入不获得公共条目的修改/删除权。

新版微信显式请求 `/api/manual-food/custom?include_imports=1`，完整读取分页；本机缓存仍最多120条，不再截断当前列表。旧客户端省略此参数时仍只返回原来的自定义列表。不同ID的同名包装不会合并；最近记录恢复失败不影响已同步列表；分页失败保留已有数据并提供重试，迟到的同步不覆盖刚保存/删除的食物。未新增缓存键或数据库字段。

本轮仅只读核对实际账号和来源数量，未修改线上记录；共享库的11/10单位字段迁移及配套发布仍未执行。微信自动化当前无可连接端口，未冒充完成运行截图验收；复用的watch属于其他任务，未重启或关闭。

贡献榜后续已按用户指定的两个位置在本地实现：晒餐页原排行榜区上方、贡献食物数据库页顶部。两边的“食物贡献榜”使用同一入口组件和同一榜单；不新增页面路由，复用 `checkin-leaderboard?section=user&ranking=contribution`。保留原有记录/健康/食物营养榜；支持本月、总榜、个人排名、无贡献状态和失败重试。尚未提交或发布。

本轮44条前端定向用例及Go归属/跨来源去重/分页/匿名与旧接口兼容、handler显式汇总用例通过；微信类型、4个业务TS/TSX lint、SCSS解析通过。测试目录 `D:/cache/agent-tests/custom-food-portions-20261112` 约2.6MB，主要为Jest转换缓存；未新建服务，临时PG已停并清理数据。后续可仅清理该任务的 `jest/` 缓存，保留各检查日志；`embedded-postgres-go/bin` 为复用共享二进制的链接，不沿链接删除。

## 食物贡献榜计数与验证

接口 `/api/community/food-contribution-leaderboard?period=month|all` 需要登录。包装食品依据实际创建的识别任务或新增贡献奖励记录归属，标准食物仅计审核通过的 `approve_new`，公开餐食只计 `published`，自定义只计有效且公开的条目。同一个公共ID去重，明确关联到标准/餐食的旧自定义不重复计数；重复导入、修改条目和合并已有标准食物不增加新增数量，是否领取奖励不影响有效新增。独立但无关联ID的资料不按名称强行合并。

月榜按北京时间自然月计算，先确定首次贡献再过滤月份，旧商品重传不能进入新月；标准食物以审核通过时间、其他条目以创建时间为依据。只统计公开食品资料，不读取私人饮食记录或健康分；双向屏蔽、缺失作者及已启用注销机制中的注销账号排除。删除检查失败返回错误，不将其当作没有注销记录。本轮没有新增数据库结构或用户缓存。

8条前端定向用例、Go计数/月份边界/注销兼容/屏蔽及旧榜单相关用例、微信全项目类型和5个业务文件lint、两份SCSS解析通过。实际库只读验证聚合语义通过，未写线上数据或发布HTTP接口。开发进程检查发现多份项目watch，未启动/重启/关闭任一实例；自动化端口未监听，未完成微信目标视口截图验收。

本轮测试目录 `D:/cache/agent-tests/food-contribution-rank-20261112` 约0.27MB（不含共享Go缓存和PG二进制），临时PG已停止并清理数据。可清理该任务 `jest/`，保留日志；同目录的 `embedded-postgres-go/bin` 为共享链接，不能沿链接删除。
