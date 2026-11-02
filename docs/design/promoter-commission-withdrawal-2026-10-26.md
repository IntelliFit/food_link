# 推广佣金与提现：后端方案（草案）

2026-10-26 · 状态：第 3 节规则已按推荐值定下（第 13 节 1–5 条）；P0 建表迁移已于 2026-10-26 14:04 在生产库 food-link（public）执行，4 张表均为空表，约束和索引已核对

### 已定规则（2026-10-26）

- 推广员申请 + 人工审核制；新用户注册时按推广码绑定，终身只绑一次，老用户不改绑。
- 绑定后 365 天内的付费订单都计佣，含自动续费；虚拟支付订单 v1 不计佣。
- 默认比例 20%（2000 bps），可按人覆盖；冻结期 7 天；满 10 元可提，单笔 ≤ 200 元，每人每天 1 次。
- 打款主体和个税口径（第 13 节 6、7 条）待财务确认，不影响 P0。

### P0 建表与方案的差异

- 先建 4 张表：`promoters`、`promoter_bindings`、`promoter_commissions`、`promoter_withdrawals`。`wechat_transfer_bills` 推迟到 P1，等对照微信官方文档核对完字段再建。
- `promoters.status` 增加 `rejected`（申请被驳回）。
- `promoter_withdrawals` 增加 `payout_method`（`manual` / `wechat_transfer`），P0 阶段人工打款；增加部分唯一索引，同一推广员同时只能有一笔进行中的提现。
- 不加外键，和现有表的做法一致，关联完整性由服务层和对账保证。
- 迁移命令：`go run ./cmd/migration -only-promoter-commission`（只建新表，不改已有表）。

### P0 服务代码（2026-10-26，`backend/internal/promoter`）

- **开关**：`promoter.enabled` 默认 `false`。关闭时申请返回「暂未开放」，绑定静默返回 `disabled`，同步任务不启动，对现有功能没有影响。
- **计佣不挂支付回调**：改为后台同步任务每 10 分钟对一次账，按订单表补记佣金、冲正退款、到期结算，第 6 节第 3–5 步都在这里完成。这样不用改会员支付代码，回调漏掉或实例重启也会在下一轮补上。所有语句幂等，6 个副本都会跑，用 `pg_try_advisory_xact_lock` 保证同一时间只有一个副本执行。
- **绑定接口**：`POST /api/promoter/bind`，小程序登录后带推广码调用（和 `marketing-qr/:code/bind` 同样的做法），不改登录流程。账号注册超过 24 小时或已有付费订单的，返回 `not_new_user`，不绑定。
- **退款识别的已知缺口**：订单表里退款只体现为 `status` 改成 `refunded` / `closed` / `revoked`，或者 `refunded_at` 有值。2026-10-26 查生产库，还没有任何退款记录；在微信商户平台手工退款**不会**回写订单表，所以这类退款要运营在订单表手工标记，否则 7 天后佣金照常转为可提现。P1 接退款回调前需要补上。
- **虚拟支付不计佣的影响**：2026-10-26 生产库已付订单中，小程序支付 45 笔、虚拟支付 32 笔、后台手工 1 笔。按现在的规则，虚拟支付渠道约四成订单不产生佣金。

- **计佣口径**：看订单的**支付时间**是否在绑定之后（绑定前下单、绑定后才付款的也算）。佣金比例和推广员状态取的是**同步生成佣金那一刻**的值；后台改比例或终止推广员时，最多 10 分钟内已付款但还没同步的订单会按新值处理。
- **晚到的订单**：冻结期从「支付时间」和「被同步发现的时间」中较晚的那个开始算，所以同步停了很久或订单被晚确认时，仍然有完整 7 天退款窗口。
- **卡住的佣金**：订单从「已支付」变成规则不认识的状态时（例如下面提到的 `expired`），佣金会一直停在冻结中；同步任务每轮会记一条警告日志「推广佣金有到期未结算的记录」，需要人工核对。

开启功能（P1 打款）前必须解决：

1. 微信支付 / 自动续费订单的退款不会写回订单表（见上），需要退款回调或后台「标记退款」入口。
2. 现有会员代码 `ExpirePendingMembershipOrders`（`internal/membership/repo/membership_repo.go`）先读出待支付订单、再按单号改成 `expired`，更新时没有再判断状态。如果中间刚好收到微信支付回调，已支付的订单会被改回 `expired`。这会影响会员本身，和推广无关，需要单独修。
3. P1 发起提现时，余额要在插入提现单的同一个事务里用一条语句重新计算，不能用推广员中心展示用的汇总值。

接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/promoter/me` | 推广员状态、推广码（通过后才返回）、比例、余额汇总 |
| POST | `/api/promoter/apply` | 申请 / 被驳回后重新申请，需带 `agreement_version`、`agreement_accepted` |
| POST | `/api/promoter/bind` | 新用户绑定推广码，返回 `bound` / `reason` |
| GET | `/api/promoter/commissions?page=&limit=` | 佣金明细，被推广用户昵称打码 |
| GET | `/api/admin/promoters?status=&page=&limit=` | 后台列表，含每人余额汇总 |
| POST | `/api/admin/promoters/:id/review` | 通过（需 `real_name_confirmed`）/ 驳回（需填原因） |
| POST | `/api/admin/promoters/:id/status` | 停用、恢复、终止 |
| PUT | `/api/admin/promoters/:id/rate` | 调整个人佣金比例，`null` 恢复默认；只影响之后的订单 |

### P1a 提现申请 + 人工打款（2026-10-27）

先不接微信商家转账，用已有的 `promoter_withdrawals` 表（`payout_method = manual`），不需要新迁移。

- **发起**：推广员在小程序点「提现」，金额为全部可提现余额，超过单笔上限按上限。满 10 元可提、单笔 ≤ 200 元、每个北京时间自然日 1 次（被驳回、打款失败的不算），暂停中的推广员不能提。
- **防超提**：先 `SELECT … FOR UPDATE` 锁推广员行，再用**单独一条语句**重新计算余额和当天次数（READ COMMITTED 下新语句拿新快照，能看到并发请求刚提交的提现），校验通过才插入。加上同一时间只能有一笔进行中提现的唯一索引，并发点多次只会成功一笔（有测试覆盖）。前端每次提现带 `request_key`，网络失败后用同一个 key 重试，后端返回第一次的结果。
- **审核**：运营在 admin「推广佣金 → 提现审核」通过或驳回（驳回必填原因，推广员可见）。通过时在锁住推广员行的事务里再校验一次：推广员必须是正常状态，余额不能为负（有退款扣回时）。
- **打款**：通过后运营在商户平台或微信转账，回到后台「标记已打款」（需勾选已核对）或「标记失败」（必填原因，金额退回余额）。标记只记录已经发生的事，不再拦截；推广员已暂停或余额为负时，后台弹窗会先标红提醒。标记人和备注（如转账单号）追加到 `review_note`，`reviewed_by` 保留审核人。微信转账的单子不能手工标记。
- **手工扣回佣金**：admin「推广员 → 佣金明细」可按订单号扣回单笔佣金（冻结中 → 取消，已结算 → 扣回），必填原因，记为 `admin: 原因`。用于商户平台手工退款不回写订单表的情况（见上文缺口 1）。手工扣回也先锁推广员行，和审核串行；同步任务不会改回。同步任务自动冲正时不加这把锁，极少数情况下审核通过后余额才变负，按第 4.6 节由之后的佣金抵扣。
- **后台推广员管理**：同一页面可以审核申请（通过需勾选已核实实名）、暂停 / 恢复 / 终止、改个人比例。
- 新增配置 `promoter.withdraw_min_cents`（1000）、`withdraw_max_cents`（20000）、`withdraw_daily_limit`（1），不配置时用默认值。

新增接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/promoter/withdrawals` | 发起提现，带 `amount_cents`、`request_key` |
| GET | `/api/promoter/withdrawals?page=&limit=` | 提现记录，`note` 为驳回或失败原因 |
| GET | `/api/admin/promoter-withdrawals?status=&page=&limit=` | 提现列表，含推广员当前可提现余额 |
| POST | `/api/admin/promoter-withdrawals/:id/review` | `approve` + `note`，驳回必填 `note` |
| POST | `/api/admin/promoter-withdrawals/:id/payout` | 人工打款结果：`succeeded` + `note`，失败必填 `note` |
| GET | `/api/admin/promoters/:id/commissions?status=&page=&limit=` | 佣金明细，含订单号、订单状态 |
| POST | `/api/admin/promoter-commissions/:id/reverse` | 手工扣回佣金，必填 `reason` |

### P1b 商家转账单表（2026-10-27 按微信官方文档核对）

核对的文档（pay.weixin.qq.com/doc/v3/merchant）：发起转账 4012716434、商户单号查询 4012716437、撤销转账 4012716458、回调通知 4012712115、JSAPI 调起确认收款 4012716430、佣金报酬报备字段 4013774590。

和第 4.5 节草案相比的变化：

- `state` 增加本地状态 `CREATED`：先落库拿到 `out_bill_no`，再调微信；调用超时或返回结果不明时保持 `CREATED`，由补偿任务按 `out_bill_no` 查单。官方要求非 200 或遇到新错误码时**不能换单号重试**，只有查单明确 `FAIL` 后才能换新单号。
- 其余状态和微信一致：`ACCEPTED`、`PROCESSING`、`WAIT_USER_CONFIRM`、`TRANSFERING`、`SUCCESS`、`FAIL`、`CANCELING`、`CANCELLED`；终态是 `SUCCESS`、`FAIL`、`CANCELLED`。用户 24 小时内不确认收款，单据会被关闭。
- 字段长度按文档加约束：`out_bill_no` 只能是数字和大小写字母、最长 32 位；`transfer_remark` 最多 32 个字符（用户收款时可见）；`openid` 最长 64 位。
- 佣金报酬（1005）的 `transfer_scene_report_infos` 必须正好两条：`岗位类型`、`报酬说明`，内容各最多 32 个字符，例如 `推广员` / `2026年10月推广佣金`。`user_recv_perception` 只能是 `劳务报酬`（默认）、`报销款`、`企业补贴`、`开工利是`，我们不传，用默认的劳务报酬。
- 不存 `user_name`：只有单笔 ≥ 2000 元才必须传实名，我们单笔上限 200 元。
- `package_info` 只在 `WAIT_USER_CONFIRM` 时返回，小程序 `wx.requestMerchantTransfer` 用它拉起确认收款页；返回成功只代表页面展示过，不代表到账。
- 回调事件类型 `MCHTRANSFER.BILL.FINISHED`，只在终态时发；解密后有 `out_bill_no`、`transfer_bill_no`、`state`、`mch_id`、`transfer_amount`、`openid`、`fail_reason`、`create_time`、`update_time`。处理前要核对金额、openid、商户号和本地一致。
- 查单接口只能查最近 30 天的单据。
- 迁移命令：`go run ./cmd/migration -only-wechat-transfer`，只新建 `wechat_transfer_bills` 一张表，不改已有表。`promoter_withdrawals` 已有 `transfer_bill_id`、`payout_method = wechat_transfer` 和 `transferring` 状态，不需要改。2026-10-28 已在生产库执行。

### P1b 微信转账打款（2026-10-28）

- 代码：`pkg/wechatpay/transfer.go`（发起、查单），`internal/wechattransfer`（转账单、补偿查单、回调），`internal/promoter/service/withdrawal_transfer.go`（提现接入）。
- 后台「通过并转账」：同一个事务里锁推广员、复核状态和余额、按推广员小程序 openid 建 `CREATED` 转账单，提现改为 `transferring`；提交后立即调微信。调用失败不影响审核结果，单据留在 `CREATED`，由查单任务处理。
- 查单任务每 `query_interval_seconds`（默认 60 秒）扫未结束的单据；等待收款的单据每 10 分钟查一次。每张单据查询前先占 45 秒租约（`last_queried_at`），多个副本不会同时对一张单据发请求。
- 查单返回「不存在」时用同一个 `out_bill_no` 重新发起；连续 5 次不存在且建单超过 30 分钟，按失败关闭（`fail_reason = CREATE_FAILED`），金额退回推广员余额。
- 转账单到 `SUCCESS` 时提现改为 `succeeded`；`FAIL`、`CANCELLED` 时提现改为 `failed`，常见失败原因转成推广员能看懂的话，金额退回余额。两者在同一个事务里改。
- 回调 `POST /api/payment/wechat/transfer/notify`：验签（微信支付公钥）、时间戳 5 分钟内、APIv3 密钥解密，核对单号、金额、openid、商户号后再更新；重复通知不重复处理；不认识的单号直接确认。
- 小程序提现记录里，等待收款的提现显示「收款」按钮，调 `wx.requestMerchantTransfer`；关掉收款页后调 `POST /api/promoter/withdrawals/:id/refresh` 让后端查一次单。
- 后台：「通过并转账」/「线下打款」二选一；转账中的提现显示微信状态、单号、最近一次错误，可点「查单」（`POST /api/admin/promoter-withdrawals/:id/sync-transfer`）。
- 开关：Apollo 加 `wechat_transfer.enabled: true` 才生效；`app_id` 默认小程序 AppID，`notify_url` 默认按 `app.env` 取 `https://(dev.)api.healthymax.cn/api/payment/wechat/transfer/notify`。商户号和密钥沿用 `wechat.pay`。关闭时后台只有线下打款。

## 1. 目标和范围

推广员用专属码拉新，被推广用户付费购买会员后，推广员按比例拿佣金；佣金过了冻结期变为可提现，推广员在小程序里发起提现，通过微信支付「商家转账」（佣金报酬，场景 ID 1005）转到本人微信零钱。

v1 只做 FoodLink 小程序。CoachLink 是另一套代码和主体，等这套跑通后照搬表结构。

不做：多级分佣、团队业绩、推广员入门费、充值或互转（避免传销和资金池风险）。

## 2. 现有基础（已核对代码）

| 现状 | 位置 | 对方案的影响 |
|---|---|---|
| 收款商户号 1105991965，API v3 证书、私钥、APIv3 密钥、微信支付公钥已配置 | `wechat.pay.*`，`backend/pkg/wechatpay` | 转账直接复用这套凭证和签名代码，不用申请新证书 |
| 会员订单表 `pro_membership_payment_records`，`pay_channel` 取值：`wechat_mini_program`(JSAPI)、`wechat_app`、`alipay_app`、`wechat_virtual_payment`(虚拟支付)、`wechat_papay`(自动续费) | `internal/membership` | 佣金按订单生成，订单 `paid` 是触发点，`refunded_at` / 退款回调是冲正触发点 |
| 已有免费邀请奖励 `user_invite_referrals`（邀请送 7 天会员，每月上限 10） | `internal/membership` | **保持独立**，不改。现金佣金是另一套规则、另一类人，混在一起会把两种激励搅乱 |
| 线下二维码归因 `marketing_qr_attributions` | `internal/marketingqr` | 可借鉴「访客 → 注册后绑定用户」的归因方式 |
| 食堂采集员收益账本 `canteen_collector_ledger`，提现目前是人工打款后由运营标记 paid | `internal/campuscatalog` | 转账层做成通用的，采集员提现以后可以接同一套 |
| `weapp_users.openid` 是小程序 openid；`app_openid` 是 App 端 openid | `weapp_users` | 转账必须用**商户号绑定的小程序 AppID 下的 openid**，所以提现只能在小程序里发起 |

## 3. 需要先定的业务规则（括号内是推荐值）

1. **谁能当推广员**：申请 + 审核制（推荐），不是人人自动开通。审核时签电子推广协议、确认实名，方便财务按劳务报酬处理。
2. **归因方式**：新用户首次通过推广码进入并注册时绑定，一个用户终身只绑一个推广员；老用户扫码不改绑（推荐）。
3. **佣金期限**：绑定后 N 天内的付费订单都算（推荐 N = 365），还是只算首单？
4. **佣金比例**：全局默认（例如 20%），允许单个推广员覆盖。比例在生成佣金时快照进记录，之后改比例不影响历史。
5. **计佣基数**：按实收金额。虚拟支付订单（`wechat_virtual_payment`）钱进的是另一个商户号，还要扣平台分成，**v1 推荐不计佣**，或者按扣费后金额计佣，需要你们定。
6. **自动续费订单**：在佣金期限内的续费也计佣（推荐），还是只算首次开通？
7. **冻结期**：订单支付后 7 天（推荐，和退款窗口一致）才转为可提现。
8. **提现门槛**：满 10 元可提，单笔不超过 200 元（微信默认单笔上限），每人每天 1 次。
9. **自购和刷单**：推广员不能给自己下单计佣（同 user_id / openid / unionid 都算自购）。
10. **税务**：v1 记录应付金额和代扣税额两个字段，实际怎么算税由财务定（见第 9 节）。

## 4. 数据表

全部新表，不改已有表。金额统一用 `bigint` 分。迁移按现有惯例新增 `-only-promoter-commission` 开关，执行前单独确认。

### 4.1 `promoters` 推广员

| 字段 | 说明 |
|---|---|
| `id` uuid PK | |
| `user_id` uuid UNIQUE | 对应 `weapp_users.id` |
| `promo_code` text UNIQUE | 专属推广码，短码，可印在海报上 |
| `status` | `pending_review` / `active` / `suspended` / `terminated` |
| `commission_rate_bps` int NULL | 个人覆盖比例，万分比；NULL 用全局默认 |
| `real_name_verified_at` timestamptz | 实名确认时间 |
| `agreement_version` text, `agreement_signed_at` | 推广协议版本 |
| `review_note`, `reviewed_by`, `reviewed_at` | |
| `created_at`, `updated_at` | |

### 4.2 `promoter_bindings` 推广归因

| 字段 | 说明 |
|---|---|
| `id` uuid PK | |
| `invitee_user_id` uuid UNIQUE | 被推广用户，一人只能绑一次 |
| `promoter_id` uuid | |
| `source` | `promo_code` / `share_link` / `qr` |
| `bound_at` | |
| `expires_at` | `bound_at + N 天`；NULL 表示不过期 |
| `status` | `active` / `revoked`（发现作弊时运营撤销） |

约束：`invitee_user_id` 不能等于该推广员自己的 `user_id`（写入时校验）。

### 4.3 `promoter_commissions` 佣金明细（一笔订单一条）

| 字段 | 说明 |
|---|---|
| `id` uuid PK | |
| `promoter_id` uuid | |
| `payment_id` uuid UNIQUE | 对应 `pro_membership_payment_records.id`，保证一单只计一次 |
| `invitee_user_id` uuid | 冗余，方便查询 |
| `order_amount_cents` bigint | 计佣基数快照 |
| `rate_bps` int | 比例快照 |
| `commission_cents` bigint | `floor(order_amount × rate / 10000)` |
| `status` | 见 5.1 |
| `settle_at` | 预计转可提现时间（支付时间 + 冻结期） |
| `settled_at`, `reversed_at`, `reverse_reason` | |
| `created_at`, `updated_at` | |

索引：`(promoter_id, status)`、`(status, settle_at)`（结算任务扫描用）。

### 4.4 `promoter_withdrawals` 提现申请（业务层）

| 字段 | 说明 |
|---|---|
| `id` uuid PK | |
| `promoter_id` uuid | |
| `request_key` text | 前端生成的幂等键，`UNIQUE(promoter_id, request_key)` |
| `amount_cents` bigint | 申请金额（应付） |
| `tax_withheld_cents` bigint default 0 | 代扣税额，由财务规则决定 |
| `net_amount_cents` bigint | 实际转账金额 = amount − tax |
| `status` | 见 5.2 |
| `transfer_bill_id` uuid NULL | 关联 4.5 |
| `review_note`, `reviewed_by`, `reviewed_at` | |
| `created_at`, `updated_at` | |

### 4.5 `wechat_transfer_bills` 商家转账单（通用转账层）

推广提现、采集员提现都走这张表，业务表只存外键。

| 字段 | 说明 |
|---|---|
| `id` uuid PK | |
| `biz_type` | `promoter_withdrawal` / `canteen_collector_withdrawal` |
| `biz_id` uuid | 业务单 id，`UNIQUE(biz_type, biz_id)` |
| `out_bill_no` text UNIQUE | 商户单号，只含字母数字，≤32 位；**一旦生成永不更换** |
| `mchid`, `appid`, `openid` | 发起时快照 |
| `transfer_scene_id` | `1005` |
| `amount_cents` bigint | |
| `transfer_remark` | 用户零钱明细里看到的说明 |
| `report_infos` jsonb | 岗位类型、报酬说明 |
| `state` | 微信状态原样存，见 5.3 |
| `transfer_bill_no` | 微信单号 |
| `package_info` text | 拉起确认收款页用 |
| `fail_reason` | |
| `last_queried_at`, `query_attempts` | 补偿查询用 |
| `notify_payload` jsonb | 最近一次回调解密后的内容 |
| `created_at`, `updated_at`, `finished_at` | |

索引：`(state, updated_at)`（补偿任务扫描非终态单）。

### 4.6 余额怎么算

不单独存余额字段，按明细实时汇总（和采集员账本同一做法），避免两份数据对不上：

```
可提现 = Σ commission(status = available)
       − Σ withdrawal(status ∈ reviewing, approved, transferring, succeeded)
待结算 = Σ commission(status = pending)
累计收益 = Σ commission(status ∈ available)  // 已冲正的不计
```

退款发生在佣金已提现之后时，佣金改为 `reversed`，可提现余额会变成负数，后续佣金先抵扣，不向推广员追款（推荐；金额大时运营人工处理）。

并发：发起提现时对 `promoters` 行加 `SELECT … FOR UPDATE`，在同一事务里算余额并插入提现单，防止同时点两次超提。

## 5. 状态流转

### 5.1 佣金 `promoter_commissions.status`

```
订单 paid ──► pending ──(到达 settle_at 且订单仍有效)──► available
                │                                         │
                └──(冻结期内退款/关单)──► cancelled        └──(冻结期后退款)──► reversed
```

- `pending`：订单已付，冻结中。
- `available`：计入可提现余额。
- `cancelled`：冻结期内失效，从未进入余额。
- `reversed`：已进入余额后被冲回（可能导致余额为负）。

### 5.2 提现申请 `promoter_withdrawals.status`

```
reviewing ──(通过)──► approved ──(创建转账单)──► transferring ──► succeeded
    │                                               │
    └──(驳回)──► rejected                          └──► failed（钱回到余额）
```

- v1 所有提现都过人工审核（`reviewing`），稳定后改为「小额自动通过，大额或异常人工」。
- `rejected`、`failed` 都不再占用余额，金额自动回到可提现。
- `failed` 后推广员可以重新发起一次新的提现，**不复用旧的 out_bill_no**。

### 5.3 转账单 `wechat_transfer_bills.state`（微信状态原样存）

```
(本地新建) ─调用发起转账─► ACCEPTED / PROCESSING ─► WAIT_USER_CONFIRM ─(用户确认)─► TRANSFERING ─► SUCCESS
                                                        │                                        │
                                                        ├─(超时未确认 / 撤销)─► CANCELING ─► CANCELLED
                                                        └───────────────────────────────────────► FAIL
```

- 终态：`SUCCESS`、`FAIL`、`CANCELLED`。只有终态才回写业务单：`SUCCESS` → 提现 `succeeded`；`FAIL` / `CANCELLED` → 提现 `failed`。
- 调用发起转账接口**超时或网络错误时不能判定失败**，单子保持「未知」，由补偿任务按 `out_bill_no` 查询后再决定。重试一律用原 `out_bill_no`，这是防止重复打款的关键。
- 用户在小程序拉起确认页后返回成功，只代表用户点了确认，**不代表到账**，以回调或查询结果为准。

## 6. 主流程

1. **成为推广员**：用户在小程序提交申请 → 运营审核 → 生成 `promo_code`，状态 `active`。
2. **归因**：分享链接 / 海报带 `promo=<code>`；新用户注册时若带推广码且该码有效，写 `promoter_bindings`（与现有邀请码解析放在同一入口，两套互不影响）。
3. **计佣**：会员订单 `paid` 的处理逻辑末尾（`markPaymentPaidFromWechatState`、自动续费扣款回调等）调用 `PromoterService.OnPaymentPaid(paymentID)`：查绑定 → 判断渠道、期限、自购 → 插入 `pending` 佣金（`payment_id` 唯一，重复回调安全）。计佣失败只记日志和告警，**不能影响会员开通**。
4. **冲正**：订单退款 / 关单时调用 `OnPaymentRefunded(paymentID)`，按 5.1 改为 `cancelled` 或 `reversed`。
5. **结算任务**：每小时扫描 `status = pending AND settle_at <= now()`，逐条复核订单仍为已付后改为 `available`。
6. **提现**：推广员在小程序发起 → 事务内校验余额、门槛、每日次数 → 写 `reviewing`。
7. **审核通过后打款**：创建 `wechat_transfer_bills`（先落库拿到 `out_bill_no`）→ 调用 `POST /v3/fund-app/mch-transfer/transfer-bills` → 存 `state`、`package_info`。
8. **用户确认收款**：小程序「提现记录」里待确认的单子显示「去收款」，调用 `wx.requestMerchantTransfer` 拉起微信确认页。
9. **结果**：回调 `notify_url` 验签解密 → 更新转账单 → 回写提现单。回调和补偿查询走同一个更新函数，状态只往终态走，不倒退。
10. **补偿任务**：每 10 分钟查非终态且超过 5 分钟未更新的转账单；对 `WAIT_USER_CONFIRM` 超过约 24 小时的单子按微信结果收尾，并给用户发消息提醒。

## 7. 对账

分三层，每天跑一次，结果写入对账报告并在异常时告警（飞书）。

**第一层：内部账平**

- 每个推广员：`Σ available 佣金 − Σ 占用中/成功提现 = 可提现余额`，且不出现非预期负数（只有冲正才允许负）。
- 每个 `succeeded` 提现都有一张 `SUCCESS` 转账单，金额一致；反之每张 `SUCCESS` 转账单都对应一个提现。
- 每条佣金对应的会员订单仍存在，且订单状态与佣金状态一致（订单已退款但佣金还是 `available` 即为异常）。

**第二层：与微信逐单核对**

- 所有非终态转账单按 `out_bill_no` 查询一遍，状态以微信为准。
- 抽检前一天全部 `SUCCESS` 单子的金额、openid 与本地一致。

**第三层：资金总额核对**

- 下载前一天运营账户资金账单（资金账单接口，账户类型选运营账户），转出合计 = 本地前一天 `SUCCESS` 转账合计。
- 查询运营账户余额，低于阈值（例如未来 3 天平均出款量）提前告警，避免转账因余额不足失败。

运营后台提供：待审核提现列表、推广员明细、对账报告下载、按月导出应付佣金（给财务报税用）。

## 8. 风控和限额

- 单笔 ≤ 200 元、单人单日 ≤ 2000 元、商户单日 ≤ 5 万元，以商户后台额度为准；本地配置一份同样的上限，先在自己这边拦住。
- 单日提现次数、推广员每日新增绑定数量设上限；同一设备或同一支付账户大量注册且只买最低档会员的，标记待人工复核。
- 推广员 `suspended` 时，新佣金照常记录但不能提现；`terminated` 时停止计佣。
- 所有审核、撤销、手工调整都记录操作人。

## 9. 合规和税务（需财务确认）

- 只做一级返佣，按真实付费订单结算，不奖励「分享」动作本身（微信诱导分享规则）。
- 打款主体就是商户号 1105991965 的主体（智健启能）。如果希望由食序科技承担佣金，需要换成食序科技的商户号，主体要和合同、发票、报税保持一致。
- 推广员佣金一般按劳务报酬由公司代扣代缴个税；2025 年起的互联网平台从业人员涉税新规可能适用累计预扣法。v1 先记录 `amount_cents`（应付）和 `tax_withheld_cents`（代扣），默认代扣为 0，由财务按月导出后决定算法，再接入自动计算。

## 10. 配置项（新增，真实值只放 Apollo）

```yaml
wechat_transfer:
  enabled: false                # 总开关，默认关
  app_id: ""                    # 留空用小程序 AppID
  notify_url: ""                # 留空按 app.env 推导
  query_interval_seconds: 60
promoter:
  default_rate_bps: 2000
  settle_delay_hours: 168
  binding_valid_days: 365
  withdraw_min_cents: 1000
  withdraw_daily_limit: 1
```

上线前还需要在商户平台完成：接口 IP 白名单（后端出口 IP）、运营账户充值。

## 11. 接口清单（v1）

小程序（需登录）：

- `POST /api/promoter/apply` 申请成为推广员
- `GET  /api/promoter/me` 推广员信息、推广码、余额汇总
- `GET  /api/promoter/commissions` 佣金明细（分页）
- `POST /api/promoter/withdrawals` 发起提现（带 `request_key`）
- `GET  /api/promoter/withdrawals` 提现记录，含待确认收款的 `package_info`

回调：

- `POST /api/payment/wechat/transfer/notify` 商家转账结果通知（验签、解密、幂等）

运营后台：

- 推广员审核 / 停用、提现审核、撤销绑定、对账报告

## 12. 分期

| 阶段 | 内容 | 涉及资金 |
|---|---|---|
| P0 | 建表；推广员申请审核；推广码归因；订单付费计佣、退款冲正、冻结期结算；推广员中心只读展示 | 否 |
| P1 | 提现申请 + 人工审核；`wechat_transfer_bills` + 发起转账 + 回调 + 补偿查询；小程序确认收款；每日对账 | 是，先用少量测试账号、单笔 0.1 元验证 |
| P2 | 小额自动审核；免确认收款授权；采集员提现迁到同一转账层；税额自动计算；CoachLink 复用 | 是 |

P0 上线后可以先人工打款（像采集员提现现在这样），同时积累真实订单数据，再开 P1。

## 13. 待你们拍板

1. 推广员申请审核制，还是所有用户自动拥有推广码？
2. 佣金期限：绑定后 365 天内所有订单，还是只算首单？
3. 虚拟支付订单是否计佣、怎么计？
4. 自动续费是否持续计佣？
5. 佣金比例和冻结天数。
6. 打款主体用智健启能（现有商户号）还是食序科技？
7. 个税由谁、按什么口径代扣？
