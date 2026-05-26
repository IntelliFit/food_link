# AI Studio 能力边界测试包 — 保质期管理子系统

> 这份文档是给 Google AI Studio（Build mode，Android Kotlin + Jetpack Compose 模式）的完整上下文，目的是**测试它能否在仅凭这份说明书的情况下，复刻一个业务行为正确、边缘 case 处理到位的 Android 子系统**。
>
> 使用方式：
>
> 1. 在 AI Studio Build 模式选择 "Build an Android app"
> 2. 把本文件「§0 给 AI Studio 的指令」到「§9 验收标准」之间的内容**整份**贴入 prompt 输入框
> 3. 让它生成；然后用「§9 验收标准」逐条核对
> 4. 如果有错，记录在最后的「实际产出对照表」里，作为它的能力边界证据

---

## §0 给 AI Studio 的指令（请严格按本节执行）

你将为一款已上线的健康饮食 WeChat 小程序「食探」复刻它的「保质期管理」子系统到原生 Android。

**你的任务**：

1. 用 Kotlin + Jetpack Compose + Material 3 实现一个可独立编译运行的 Android app
2. 包含 4 个屏幕：Dashboard、列表、编辑/新增、拍照识别
3. 后端 API 我用 mock 实现（见 §5 mock 数据），你不要尝试连真实服务器；用一个 `FakeExpiryRepository` 在内存中实现 §4 全部 API 行为
4. 网络层用 Retrofit 接口定义出来（即使指向 fake repo），方便后续接真后端
5. 状态管理用 ViewModel + StateFlow
6. **业务规则必须严格按 §6 实现**，不要按你自己的理解发挥
7. **UI 风格按 §7**，主色 `#00BC7D`

**你不要做的事**：

- 不要写后端代码
- 不要发明 §4 没有的 API 端点
- 不要改 §3 的字段名（包括 snake_case 字段名，Kotlin 用 `@SerializedName` 映射）
- 不要把 loading 状态显示成「加载中…」文字，只允许用 spinner / skeleton
- 不要在用户能看到的地方暴露任何上游异常原文（"connection reset"、"EOF"、URL、stack trace 等）
- 不要用本地系统时区做任何日期计算 —— 所有日期/天数计算必须按 `Asia/Shanghai` 时区
- 不要在 UI 上把 status (active/consumed/discarded) 和 urgency (expired/today/soon/fresh) 混为一谈，它们是两个独立维度

**生成完成后，请在 README 里写一段「我对这些边缘 case 的处理」自查，逐条对应 §9 列表说明你做了什么。**

---

## §1 产品背景（极简）

「食探」是一个 AI 驱动的食物营养记录小程序，已有 Go 后端 + 微信小程序前端。

「保质期管理」是其中一个独立子系统，用户用它来：

- 把家里冰箱/橱柜里的食物登记进 app
- 拍包装照片让 AI 自动识别保质期、品名、储存方式
- 在临近过期时收到推送提醒
- 标记「已吃完」/「已丢弃」做收纳
- 看一个 Dashboard 知道哪些食物快过期了

它是一个**完整、自洽**的子系统：除了用户身份认证，不依赖产品其它部分。这就是为什么我们选它来做能力边界测试。

---

## §2 用户角色与功能边界

**用户角色**：单一普通用户，已登录（你不需要实现登录，假设已经有 `userId` 和 `authToken`）。

**包含**：

- Dashboard 看板（4 个统计数字 + 即将到期预览）
- 食物条目列表（按状态分组）
- 单条食物的新增 / 编辑 / 删除（删除 = 软删，状态改为 discarded）
- 状态流转（active ↔ consumed ↔ discarded）
- 拍照识别（OCR）→ 用户确认 → 批量保存
- 推送提醒登记（Android 上用本地通知 `NotificationManager` 模拟，不需要真实服务端推送）

**不包含**：

- 用户登录、注册、找回密码（外部已处理）
- 食物营养、卡路里、菜谱（不属于本子系统）
- 社交 / 分享 / 评论

---

## §3 数据模型（Postgres 真实表，你需要在 Kotlin 端建对应 data class）

### 3.1 `food_expiry_items`

```text
id            string   主键 UUID
user_id       string   外键
food_name     string   必填，非空，最长 64
category      string   可空，例如 "乳制品" / "水果" / "剩菜"
storage_type  enum     room_temp | refrigerated | frozen   存储方式
quantity_note string?  可空，例如 "1 盒" / "500g"，纯字符串
expire_date   date     必填，仅日期（不带时间），按 Asia/Shanghai 解读
opened_date   date?    可空，仅日期
note          string?  可空，用户备注
source_type   enum     manual | ocr | ai   这条记录怎么产生的
status        enum     active | consumed | discarded   默认 active
created_at    timestamp
updated_at    timestamp
```

### 3.2 `food_expiry_notification_jobs`（仅供你理解推送语义；Android 端用本地 AlarmManager 模拟）

```text
id              string   主键 UUID
user_id         string
expiry_item_id  string   外键 → food_expiry_items.id
template_id     string   微信订阅消息模板 ID（Android 上用通知 channel ID 替代）
status          enum     pending | sent | cancelled | failed
scheduled_at    timestamp UTC，但语义上是 "expire_date 09:00 Asia/Shanghai"
sent_at         timestamp?
last_error      string?
retry_count     int      0..max_retry_count
max_retry_count int      默认 3
payload_snapshot json    推送内容快照
```

### 3.3 Kotlin 端建议建模

- 用 `kotlinx.datetime.LocalDate` 表示 expire_date / opened_date
- 用 `kotlinx.datetime.Instant` 表示 created_at / updated_at
- enum 用 sealed interface 或 enum class，并提供 `fromString()` 容错（**遇到未知值不要崩，落到默认 active / refrigerated / manual / fresh**）

---

## §4 API 契约（精确，这就是你必须实现的接口表面）

所有接口：

- 前缀：`/api/expiry`
- 鉴权：`Authorization: Bearer <token>`
- 响应外层包一层 `{ "code": 0, "data": { ... }, "message": "..." }`，`code != 0` 视为错误
- 业务错误码：`10002`=参数错误（HTTP 400）；`10000`=服务未配置（HTTP 500）；其他视为通用错误

### 4.1 `GET /api/expiry/dashboard`

**响应 data**：

```json
{
  "active_count": 12,
  "expired_count": 2,
  "today_count": 1,
  "soon_count": 4,
  "processed_count": 30,
  "preview_items": [ /* FoodExpiryItem[]，最多 50 条，按 expire_date 升序 */ ]
}
```

### 4.2 `GET /api/expiry/items?status=active|consumed|discarded`

`status` 缺省时返回全部。最多 200 条，按 `expire_date ASC, id DESC`。

**响应 data**：

```json
{ "items": [ /* FoodExpiryItem[] */ ] }
```

### 4.3 `POST /api/expiry/items`（新增）

**请求 body**：

```json
{
  "food_name": "牛奶",          // 必填
  "category": "乳制品",         // 可选
  "storage_type": "refrigerated", // 可选，缺省 refrigerated
  "quantity_note": "1 盒",      // 可选
  "expire_date": "2026-06-01",  // 必填，YYYY-MM-DD
  "opened_date": null,          // 可选
  "note": null,                 // 可选
  "source_type": "manual",      // 可选，缺省 manual
  "status": "active"            // 可选，缺省 active
}
```

### 4.4 `GET /api/expiry/items/:id` → `{ item: FoodExpiryItem }`

### 4.5 `PUT /api/expiry/items/:id`（编辑）— body 同 4.3 但全部字段可选

### 4.6 `POST /api/expiry/items/:id/status`

**请求**：`{ "status": "consumed" }`（合法值：`active | consumed | discarded`）

### 4.7 `POST /api/expiry/items/:id/subscribe`（登记推送提醒；Android 上 = 注册本地通知）

**请求**：`{ "subscribe_status": "accept", "err_msg": "" }`

合法 `subscribe_status`：`accept | acceptWithAlert | acceptWithAudio`，其它值表示用户拒绝。

**响应 data**：

```json
{
  "subscribed": true,
  "schedule_created": true,
  "status": "accept",
  "scheduled_at": "2026-06-01T01:00:00Z",  // UTC，对应 expire_date 09:00 Asia/Shanghai
  "message": "提醒任务已登记"
}
```

### 4.8 `POST /api/expiry/recognize`（OCR）

**请求**：

```json
{
  "image_urls": ["https://cdn.../a.jpg"], // 1..3 张
  "additional_context": "冰箱里的剩饭"      // 可选
}
```

**响应 data**：

```json
{
  "task_id": "uuid",
  "credits_cost": 2,
  "items": [
    {
      "food_name": "牛奶",
      "category": "乳制品",
      "storage_type": "refrigerated",
      "quantity_note": "1 盒",
      "expire_date": "2026-06-01",
      "opened_date": null,
      "note": null,
      "source_type": "ocr",
      "suggested_days": null,
      "expire_date_is_estimated": false,
      "confidence": 0.92,
      "recognition_basis": "包装上印有生产日期 2026-04-01 + 保质期 60 天",
      "missing_fields": []
    }
  ],
  "message": "已识别 1 项食物，可继续补充后保存"
}
```

**Android 端必须做的事**：拿到这个响应后，把 `items` 变成可编辑的 draft 列表，让用户修改/删除/再补充，然后逐条调用 `POST /api/expiry/items` 保存（不是一次保存全部）。每条保存成功后从 draft 里移除。

---

## §5 Mock 数据（直接放进 `FakeExpiryRepository`，让 app 能跑）

```kotlin
// 当前模拟"今天" = 2026-05-26 (Asia/Shanghai)
val seedItems = listOf(
    // 已过期 2 天
    Item("a1", "酸奶", "乳制品", "refrigerated", "1 盒", "2026-05-24", null, "active", "manual"),
    // 今天到期
    Item("a2", "牛奶", "乳制品", "refrigerated", "500ml", "2026-05-26", "2026-05-23", "active", "ocr"),
    // 3 天后
    Item("a3", "西兰花", "蔬菜", "refrigerated", null, "2026-05-29", null, "active", "manual"),
    // 7 天后
    Item("a4", "面包", "面包", "room_temp", "半袋", "2026-06-02", null, "active", "manual"),
    // 30 天后
    Item("a5", "速冻饺子", "冷冻食品", "frozen", "一袋", "2026-06-25", null, "active", "ai"),
    // 已吃完
    Item("a6", "草莓", "水果", "refrigerated", null, "2026-05-20", null, "consumed", "manual"),
    // 已丢弃
    Item("a7", "剩饭", "剩菜", "refrigerated", null, "2026-05-22", null, "discarded", "manual"),
)
```

OCR mock：随机选 `seedItems` 里 1-2 条返回，confidence 在 0.6-0.95 之间随机。

---

## §6 业务规则与状态机（**这一节是测试重点，必须严格实现**）

### 6.1 urgency（紧迫度）计算 — 仅对 active 条目

```text
days = floor( (expireDate.atStartOfDay(Asia/Shanghai) - now.atStartOfDay(Asia/Shanghai)) / 24h )

if status != "active":
    urgency = null   // 非 active 不显示 urgency，只显示 status_label
else:
    days < 0   → "expired"   (label: "已过期", color: 红 #ef4444)
    days == 0  → "today"     (label: "今天到期", color: 橙 #f97316)
    days <=3   → "soon"      (label: "即将到期", color: 黄 #eab308)
    days > 3   → "fresh"     (label: "新鲜", color: 绿 #00bc7d)
```

**陷阱**：不要用设备本地时区，必须显式 `ZoneId.of("Asia/Shanghai")`。中国用户在国外旅游时，app 的"今天到期"必须仍按北京时间。

### 6.2 状态机

```text
            consumed ←─┐
             ↑         │
             │   "已吃完"
             │
[NEW] → active           ←→  恢复
             │
             │   "已丢弃"
             ↓         │
            discarded ─┘
```

- 新建条目默认 `status=active`
- active → consumed / discarded：用户主动操作
- consumed / discarded → active：列表项点击"恢复提醒"
- 任何状态都允许编辑其它字段
- **当且仅当 status=active 时**，才计算 urgency、登记推送、计入 dashboard 的 active_count
- status 不是 active 时，必须**取消该条目已登记的所有推送任务**

### 6.3 Dashboard 计数规则（不要自己发挥，按这个算）

```text
active_count    = items.count { it.status == "active" }
processed_count = items.count { it.status == "consumed" || it.status == "discarded" }
expired_count   = items.count { it.status == "active" && days < 0 }
today_count     = items.count { it.status == "active" && days == 0 }
soon_count      = items.count { it.status == "active" && days in 1..3 }
preview_items   = items.filter { it.status == "active" && days in -∞..7 }
                       .sortedBy { it.expire_date }
                       .take(50)
```

### 6.4 推送提醒规则

- 只对 `status=active` 的条目允许登记
- 调度时间：`expire_date 当天 09:00 Asia/Shanghai`
- 如果到期日已经过去（days < 0），**不登记**，返回 `schedule_created=false, message="..."`
- 如果是今天到期且当前已过 09:00，调度时间设为 `now + 1min`
- 用户切到非 active 状态时，**必须立即取消该条目所有 pending 通知**
- 用户编辑 expire_date 后，**必须重新计算调度时间**（旧的 cancel，新的重建）
- Android 端用 `AlarmManager.setExactAndAllowWhileIdle` + `BroadcastReceiver` 触发本地通知

### 6.5 输入校验

- food_name 必填，trim 后非空，最长 64
- expire_date 必填，格式 YYYY-MM-DD
- storage_type 缺省 refrigerated；不在枚举内时报参数错误
- 编辑接口不传任何字段时报 "没有需要更新的字段"

### 6.6 错误清洗（**重要边缘 case**）

任何来自 OCR / 网络 / 上游服务的错误信息，**必须**在显示给用户之前清洗：

- 包含 `EOF`、`connection reset`、`socket hang up`、`unexpected EOF` → 显示 `"AI 识别服务连接中断，请稍后重试"`
- 包含 URL（`https://...`、`api.xxx`）、API 路径（`/v1/...`）→ 整段替换为 `"识别服务暂时不可用，请稍后重试"`
- 包含 stack trace 关键词（`at com.`、`Exception`、`null pointer`）→ 替换为 `"识别失败，请稍后重试"`
- HTTP 4xx 但有 message 字段 → 用 message
- HTTP 5xx → 显示 `"服务器繁忙，请稍后重试"`

### 6.7 加载态规范

- **不允许**显示「加载中…」文字
- 使用 CircularProgressIndicator (spinner) 或 shimmer placeholder
- 列表初次加载用 shimmer 占位骨架（3-5 条假卡片）
- 二次刷新用顶部细 LinearProgressIndicator
- 提交按钮加载时，按钮内部 spinner，按钮文字保持原文（"保存中" 也不允许，用 "保存" + spinner）

---

## §7 UI 设计要点

### 7.1 设计语言

- Material 3，浅色为主
- 主色 `#00BC7D`（绿）
- 表面色 `#F6F8FA`，卡片背景 `#FFFFFF` 94% 透明度
- 危险色 `#EF4444`，警告色 `#F97316`，注意色 `#EAB308`
- 圆角：卡片 24dp，按钮 999dp（pill）
- 阴影：轻微 elevation 2-3dp

### 7.2 Dashboard 屏

```
┌────────────────────────────────┐
│ 我的食物管理                     │
│ 保质期提醒          [+ 新增]    │
├────────────────────────────────┤
│ ┌──────┐ ┌──────┐              │
│ │  1   │ │  4   │              │
│ │今天  │ │即将  │              │
│ │优先吃│ │过期  │              │
│ └──────┘ └──────┘              │
│ ┌──────┐ ┌──────┐              │
│ │  2   │ │  12  │              │
│ │已过期│ │保鲜中│              │
│ └──────┘ └──────┘              │
├────────────────────────────────┤
│ 最需要先处理                     │
│ • 酸奶          已过期 2 天      │
│ • 牛奶          今天到期         │
│ • 西兰花        3 天后到期       │
│            [查看全部 →]          │
└────────────────────────────────┘
```

底部固定按钮：`[拍照识别]` `[手动添加]`

### 7.3 列表屏

按状态分三组（折叠展开）：

1. **需要关注**（active && urgency != fresh）— 默认展开
2. **保鲜中**（active && urgency == fresh）— 默认展开
3. **已处理**（consumed | discarded）— 默认折叠，显示数量

每张卡：

- 第一行：食物名（粗体）+ 分类（淡色） + 右上角紧迫度 badge（颜色按 §6.1）
- 第二行：到期日 / 储存方式 / 数量备注
- 第三行：紧迫度文字（"已过期 2 天" / "今天到期" / "3 天后到期"）
- 第四行：可选备注
- 底部 actions：active 显示 `[已吃完] [已丢弃] [编辑]`；非 active 显示 `[恢复提醒] [编辑]`

### 7.4 编辑/新增屏

- 顶部 input：食物名（必填，红星）
- Picker：分类（16 个预设）
- Picker：储存方式（常温/冷藏/冷冻）
- DatePicker：到期日（必填）
- DatePicker：开封日（可选）
- Input：数量备注（可选）
- Textarea：备注（可选）
- Switch：保存后立即登记提醒（默认开）
- 底部：`[保存]` 按钮（pill，主色）

新增模式额外：顶部预设食物快速选择 chips（牛奶/酸奶/水果/面包/剩菜/熟食），点击自动填默认值（食物名+分类+存储方式+到期日=今天+预设天数）。

### 7.5 OCR 屏

- 顶部：选图区（最多 3 张），每张可删除
- 中间：`[开始识别]` 按钮
- 识别中：spinner + "正在识别 X 张图片"（这条文字允许，因为不是 loading 而是 progress）
- 识别后：每张识别结果一张卡，每张卡内是一个可编辑的 mini 表单（同 §7.4 但更紧凑）
  - 卡上显示 `confidence` 圆环（>0.85 绿，0.7-0.85 黄，<0.7 红）
  - 如果 `expire_date_is_estimated=true`，到期日字段右侧加 `(估算)` 灰色标签
  - 如果 `missing_fields` 非空，对应字段加红色边框 + "请补充" 提示
- 卡底部：`[保存]` `[删除]`
- 全部底部：`[全部保存]`（逐条保存，逐条从 draft 移除，保存失败的留下并显示错误）

---

## §8 项目结构建议（你也可以自己组织，但要清晰分层）

```
app/
├── data/
│   ├── model/         # data class: ExpiryItem, Dashboard, ...
│   ├── api/           # Retrofit interface ExpiryApi
│   ├── fake/          # FakeExpiryRepository (内存实现 §4 全部行为 + §5 seed)
│   └── repository/    # ExpiryRepository (interface) + ExpiryRepositoryImpl
├── domain/
│   ├── usecase/       # CalculateUrgency, BuildDashboardCounts, BuildSchedule, ...
│   └── error/         # ErrorMessageSanitizer (§6.6)
├── ui/
│   ├── dashboard/     # DashboardScreen + ViewModel
│   ├── list/          # ListScreen + ViewModel
│   ├── edit/          # EditScreen + ViewModel
│   ├── ocr/           # OcrScreen + ViewModel
│   ├── theme/         # Material 3 theme + 颜色常量
│   └── components/    # UrgencyBadge, ExpiryCard, ConfidenceRing, ...
├── notification/      # NotificationScheduler (AlarmManager + Receiver)
└── MainActivity.kt    # NavHost
```

依赖建议：

- Compose BOM 最新稳定版
- Material 3
- Navigation Compose
- ViewModel + Lifecycle
- Retrofit 2 + OkHttp + Moshi 或 kotlinx.serialization
- kotlinx.datetime
- Coil（图片）

---

## §9 验收标准（**这就是测试 AI Studio 能力边界的核心**）

完成后，请逐条自查并写入 README。我会用同样的清单检查它的产出。

### A. 业务规则正确性（必答）

- [ ] A1：把"今天" mock 成 `2026-05-26 23:00 (UTC+8)`，dashboard 应显示 `today=1, expired=1, soon=2`（按 §5 数据）—— **测时区**
- [ ] A2：用户编辑 a4(面包) 的 expire_date 从 `2026-06-02` 改为 `2026-05-25`（已过期），保存后该条目 urgency=expired，且原本登记的提醒被取消 —— **测推送同步**
- [ ] A3：把 a2(牛奶) 状态切到 consumed，dashboard 的 today_count 立即从 1 → 0，processed_count +1 —— **测计数同步**
- [ ] A4：a6(草莓) 已 consumed，列表点"恢复提醒"后回到 active，按 expire_date=2026-05-20 应立即变为 expired urgency
- [ ] A5：a2(牛奶) 今天到期，登记提醒。如果当前是上午 8:00，scheduled_at = 当天 09:00；如果当前是 10:00，scheduled_at = now+1min
- [ ] A6：试图给 a1(酸奶，已过期) 登记提醒，schedule_created=false 且 message 说明原因
- [ ] A7：编辑提交时 food_name 留空，前端拦截，不发请求；后端报错时也能优雅显示 "请填写食物名"
- [ ] A8：拍照识别返回 2 条，用户保存第 1 条成功、第 2 条失败（mock 一个错误），第 1 条从 draft 消失，第 2 条留下并显示错误

### B. 错误清洗（必答）

- [ ] B1：mock OCR 抛出 `IOException("Read error: ssl=0x... : I/O error during system call, Connection reset by peer")`，UI 上**只能**看到 "AI 识别服务连接中断，请稍后重试"
- [ ] B2：mock 抛出 `RuntimeException("at com.foo.Bar.baz(Bar.kt:42)")`，UI 上看不到任何 `at com.` 字样
- [ ] B3：mock 返回 HTTP 500 + body `{"detail":"upstream timeout: api.openai.com"}`，UI 上不能出现 `api.openai.com`

### C. UI 规范（必答）

- [ ] C1：列表初次加载，屏幕上**不出现**"加载中"三个字（搜索整个 UI 树）
- [ ] C2：保存按钮加载时，按钮内是 spinner + "保存"，不允许出现 "保存中"
- [ ] C3：active 条目右上角 badge 颜色严格对应 §6.1 四个色值
- [ ] C4：consumed/discarded 条目不显示 urgency badge，只显示 status badge（灰色）
- [ ] C5：dashboard 4 个卡片的数字与 §5 mock 数据手算结果一致

### D. 反模式禁区（必答 — 这些都做错就失败）

- [ ] D1：**没有**把 status 和 urgency 揉成一个 enum
- [ ] D2：**没有**在任何地方用 `LocalDate.now()` 不指定时区（必须 `LocalDate.now(ZoneId.of("Asia/Shanghai"))`）
- [ ] D3：**没有**把 `days_until_expire` 计算成 `(expireDate - today).days`（应该是按天起点对齐后再相减，否则 23:59 和 00:01 会差 1 天）
- [ ] D4：**没有**直接把后端返回的 `urgency` 字段透传，而是前端用 `expire_date + status` 自行计算（前后端口径必须可独立验证）
- [ ] D5：**没有**在 active → consumed 状态切换后忘了取消 pending 通知

### E. 加分项（不做也行，但做了说明能力强）

- [ ] E1：日期跨越夏令时 / 月末 / 闰年的边界情况测试用例
- [ ] E2：列表使用 LazyColumn + key 优化重组
- [ ] E3：Compose Preview 覆盖每个屏的空态/有数据/错误态
- [ ] E4：Mock 一个 OCR 慢响应（5 秒），期间用户可以取消，cancel 时不写入数据库
- [ ] E5：dark theme 适配

---

## §10 实际产出对照表（你拿到 AI Studio 输出后填，作为能力边界证据）

| 验收项 | 期望 | AI Studio 实际 | 差距 |
|--------|------|---------------|------|
| A1 时区 |  |  |  |
| A2 推送同步 |  |  |  |
| A3 计数同步 |  |  |  |
| ... |  |  |  |
| B1 错误清洗 |  |  |  |
| ... |  |  |  |
| C1 无"加载中"文字 |  |  |  |
| ... |  |  |  |
| D1 status/urgency 分离 |  |  |  |
| ... |  |  |  |

**总分**：__ / 22（A=8 + B=3 + C=5 + D=5 + E=5 加分）

**结论**：

- ≥ 18：AI Studio 能拿来做产线起点（仍需 review，但骨架可信）
- 12-17：能做 PoC / demo，不能做产线
- < 12：只能当快速 vibe inspiration，业务复刻能力不可信
