# AI Studio 能力边界测试包 — 整个食探产品复刻

> 这是给 Google AI Studio（Build mode，建议先用 "Build an Android app" 模式，也可以用 web 模式做对照）的**完整产品打包**。
>
> 它包含：产品全貌 / 信息架构 / 全部数据模型 / 全部 API 清单 / 全部核心业务流程 / 80+ 业务规则 / UI 设计语言 / 验收标准。
>
> **使用方式**：
>
> 1. 通读一遍这份文档，确认没有要修改的产品决策
> 2. 在 AI Studio Build 模式开新项目
> 3. 把 §0 到 §10（不含 §11 自评模板）整份贴入
> 4. 让它生成；它会在 README.md 里输出一份"实现矩阵"自评（§9.4 强制要求）
> 5. 你拿 §10 的验收维度去打分，把结果填回 §11

---

## 目录

- §0 给 AI Studio 的指令（必读，含禁区）
- §1 产品全貌
- §2 用户角色与权限矩阵
- §3 信息架构（4 tab + 全部子页地图）
- §4 数据模型全集（按业务域分组）
- §5 完整 API 清单（120+ 路由）
- §6 核心业务流程与状态机
- §7 业务规则全集（80+ 条决策）
- §8 设计语言与 UI 规范
- §9 给 AI 的输出要求（含必须交付物）
- §10 验收维度与打分
- §11 实际产出对照表（你拿到 AI Studio 输出后填）

---

## §0 给 AI Studio 的指令

### 0.1 你的目标

为一款已上线的健康饮食 WeChat 小程序「食探」复刻它的**完整产品**到原生 Android（Kotlin + Jetpack Compose + Material 3）。

这是已经迭代了一年多的成熟产品，不是从 0 设计的新产品。你的任务是**忠实复刻**，不是发挥创意。

### 0.2 你必须做到的事

1. 用 Kotlin + Jetpack Compose + Material 3 实现一个可独立编译运行的 Android app
2. 实现 §3 列出的全部 4 个 tab 主页和**至少 20 个**核心子页面（次要子页可以用占位 + 路由打通即可，但必须有路由项）
3. 网络层用 Retrofit 接口定义出 §5 列出的**全部 120+ API**（接口必须存在，方法签名要对，但实现可以指向 mock）
4. 用 `FakeApiClient` 在内存里实现核心接口的真实行为（至少覆盖：登录/首页/分析提交/食物记录/圈子 feed/会员/积分/保质期/健康档案/统计），让 app 能脱网跑通主链路
5. 用 ViewModel + StateFlow 做状态管理；导航用 Navigation Compose
6. 严格按 §7 业务规则实现，不要按你自己的理解发挥；如果某条规则你"看不懂为什么这样"，按字面照搬，不要"优化"
7. 严格按 §8 UI 设计语言，主色 `#00BC7D`
8. 在 README.md 里输出 §9.4 要求的"实现矩阵自评表"

### 0.3 你不要做的事（红线）

| 红线 | 理由 |
|------|------|
| 不要发明 §5 没有的 API 路径 | 后端契约是已知的，发明新路径会让真后端接不上 |
| 不要改 snake_case 字段名 | 后端返回的 JSON 字段是 snake_case，Kotlin 端用 `@SerializedName` 映射 |
| 不要用本地系统时区做日期计算 | 全部按 `Asia/Shanghai`，§7 多次强调 |
| 不要在 loading 状态显示"加载中"文字 | 项目硬规定，只允许 spinner / skeleton / shimmer |
| 不要把上游错误原文展示给用户 | "EOF"/"connection reset"/URL/stack trace 必须清洗，§7.AI 错误处理 有清洗规则 |
| 不要把 status 和 urgency 揉成一个 enum | §7 保质期 / 食物记录 多处依赖二维分离 |
| 不要把"运动记录"塞进"饮食宏量字段" | 圈子 feed 是多类型的，运动是独立 target_type，§7 圈子 决策 |
| 不要让 AI 推断重量计算公式 | 重量公式是确定性的：`estimatedWeight = grossWeight * ediblePortionRatio`，§7 食物分析 |
| 不要在新用户试用资格上依赖 created_at | 必须用 unionid 做稳定身份键，§7 会员 决策 |
| 不要让 dashboard 因为某张次要表缺失而整页 500 | 次要数据降级为空数组，§7 统计 决策 |

### 0.4 你被允许做的简化（必须在自评矩阵里标注）

- 视觉资产（图标、宠物形象、首页插画）可以用 Compose 几何图形或 Material Icons 替代
- 微信原生能力（小程序登录、订阅消息、微信支付、`wx.chooseImage`）替换为 Android 等价物：
  - 登录 → 邮箱/手机号 + Apple ID + Google ID（实现一个就行，其它占位）
  - 订阅消息 → Android `NotificationManager` + `AlarmManager`
  - 微信支付 → 占位"模拟支付成功" + Toast，不要接真实支付 SDK
  - 选图 → `ActivityResultContracts.PickVisualMedia`
- AI 生成接口（`/api/analyze`、`/api/stats/insight/generate` 等）的真实模型调用可以 mock，返回结构化假数据
- 试运营、批量、内部测试相关路由（`/api/test-backend/*`、`/api/test/*`）可以全部跳过
- 表情符号、动画、转场可以简化

但是 **§9.4 自评矩阵必须如实标出哪些是"做了"、哪些是"简化了"、哪些是"跳过了"、哪些是"猜了"**。

---

## §1 产品全貌

### 1.1 一句话定位

「食探」是一款 AI 驱动的**健康饮食记录与分析**应用，主要面向有减脂、控糖、健康管理需求的中文用户。

### 1.2 核心价值

1. **拍照即分析**：用户拍一张餐食照片，AI 在 5-30 秒内识别每种食物、估算重量、回算营养（卡路里/蛋白质/脂肪/碳水/纤维等），自动写入饮食日记
2. **多模式分析**：4 种识别模式（普通/精准/普通+联网/精准+联网），用积分结算，让用户根据情境选择
3. **结构化健康追踪**：饮食 + 运动 + 体重 + 饮水 + 体检报告 → 综合健康指数 + AI 风险解读 + 行动建议
4. **保质期管理**：拍包装识别保质期，临期推送提醒
5. **轻社交**：圈子 feed（饮食/运动打卡）、好友、检入排行、自有宠物陪伴

### 1.3 商业模式（你不需要实现真实支付，但 UI 要展现）

- **免费层**：每日少量基础积分，可以做有限次普通模式分析
- **试用**：新用户注册后获得一次性试用积分（每微信身份只能领一次，§7 会员）
- **会员**（标准版/进阶版）：包月/包年订阅，每月赠送积分，进阶版多解锁"精准模式"
- **奖励积分**：通过分享打卡、上传公共食物库、上传预包装零食获得，单独账户

### 1.4 关键技术信息（你只需要消化，不需要实现后端）

- 后端：Go + Gin + Postgres + 腾讯云 COS + CDN
- 前端：Taro 4 + React 18 + TypeScript（你做的是这个的 Android 版）
- AI：DeepSeek（文本/营养判定）+ 豆包（视觉/OCR）+ Gemini（保质期）
- 异步任务：`analysis_tasks` 表 + worker poll + websocket

---

## §2 用户角色与权限矩阵

只有一种"用户"角色，但有 4 个会员状态，决定能做什么：

| 状态 | 试用积分 | 每日基础积分 | 普通模式 (2 积分) | 精准模式 (4 积分) | 联网模式 |
|------|---------|------------|----------------|----------------|---------|
| 未登录 | - | - | 不可用 | 不可用 | 不可用 |
| 免费用户 | - | 少量 | 可用，凭积分 | 不可用 | 凭积分 |
| 试用用户（首次注册） | 一次性发放 | 少量 | 可用 | 可用（试用期内） | 可用 |
| 标准版会员 | - | 中量 | 可用 | 不可用 | 可用 |
| 进阶版会员 | - | 大量 | 可用 | 可用 | 可用 |

**奖励积分**（earned_credits）和**系统积分**（system_credits）是两套独立账户：

- 系统积分：日重置，会员每日发放，主要用于食物分析
- 奖励积分：永久累计，通过分享打卡 / 上传食物库 / 上传零食获得，主要用于"我的宠物"换外观和支付分析积分超额

---

## §3 信息架构

### 3.1 4 个 tab 主页

| Tab | 路由 | 核心内容 |
|-----|------|---------|
| 首页 | `/home` | 今日饮食概览 + 热量目标进度 + 今日餐食列表 + 悬浮宠物 + 「今天吃什么」推荐入口 + 公告 |
| 分析 | `/stats` | 营养分析 + 健康指数 + AI 风险解读 + 自定义关注卡片 + 体重/饮水/运动趋势入口 |
| 圈子 | `/community` | 好友 feed + 公开 feed + 检入排行 + 互动通知入口 |
| 我的 | `/profile` | 头像 + 会员状态 + 积分 + 入口列表（健康档案、宠物、好友、保质期、记录历史、赚积分、清缓存、关于、注销） |

底部 tab 颜色：未选中 `#6A7282`，选中 `#00BC7D`，背景 `#F9FAFB`，自定义渲染（不用系统默认 BottomNavigation）。

### 3.2 全部子页路由清单（必须存在的路由项）

按重要性分组。**核心页**必须实现真实交互；**次要页**至少要有路由项 + 最小 UI（可以是占位页，但要从主页能跳进去）。

#### 核心页（必须实现）

```
/login                            # 登录页（手机号/邮箱）
/record/photo                     # 拍照记录（拍照 → 选择分析模式 → 提交）
/record/text                      # 文字记录（输入文字描述 → 提交）
/record/manual                    # 手动记录（搜索食物库 → 调整重量 → 保存）
/analyze/loading                  # 分析中（轮询任务状态）
/analyze/result/{recordId}        # 分析结果页（食物清单 + 滑块调整摄入比例 + 保存/重新识别）
/analyze/history                  # 分析历史
/expiry                           # 保质期 dashboard
/expiry/edit?id=                  # 保质期新增/编辑（含拍照识别）
/health-profile                   # 健康档案问卷
/health-profile/view              # 健康档案查看
/membership                       # 会员中心（套餐 + 续费 + 权益）
/reward-center                    # 赚积分中心
/pet-home                         # 我的宠物
/community/feed/{recordId}        # 圈子动态详情
/community/notifications          # 互动通知
/checkin-leaderboard              # 检入排行
/friends                          # 好友列表
/friends/invite                   # 邀请好友
/recipes                          # 我的菜谱
/food-library                     # 公共食物库
/food-library/{itemId}            # 公共食物库详情
/profile-settings                 # 资料编辑
```

#### 次要页（至少要有路由项 + 最小 UI）

```
/day-record/{date}                # 某天的全部饮食
/record-detail/{recordId}         # 单条记录详情
/recipe-edit?id=                  # 菜谱新增/编辑
/food-library/share               # 食物库分享页
/packaged-food-edit               # 预包装零食上传
/packaged-food-task-detail/{id}   # 零食上传任务详情
/weight-record                    # 体重记录
/weight-trend                     # 体重趋势
/water-record                     # 饮水记录
/water-trend                      # 饮水趋势
/exercise-record                  # 运动记录
/exercise-trend                   # 运动趋势
/body-trends                      # 身体综合趋势
/stats-metabolic                  # 代谢分析
/location-search                  # 位置搜索（用于上传公共食物库时选店）
/privacy-settings                 # 隐私设置
/agreement                        # 用户协议
/membership-agreement             # 会员协议
/about                            # 关于
/user-group                       # 用户群（QR 码展示页）
```

---

## §4 数据模型全集

### 4.1 用户与认证

```text
weapp_user
  id                 string PK
  openid             string  unique  微信 openid（Android 端可改 device_id）
  unionid            string  unique  微信 unionid（稳定身份键，Android 端可改 stable_user_id）
  phone              string?
  email              string?
  nickname           string
  avatar             string?  (COS key, 拼接 CDN 后展示)
  gender             enum male|female|unknown
  age                int?
  height_cm          int?
  weight_kg          float?
  is_member          bool
  member_plan        enum free|trial|standard|pro
  member_expires_at  timestamp?
  system_credits        int   日重置，用于分析
  earned_credits        int   永久累计，用于宠物/超额支付
  trial_claimed_at      timestamp?  试用是否已领，写入独立表，注销账号不重置
  onboarding_completed  bool
  health_disclaimer_acknowledged  bool
  created_at  timestamp
  updated_at  timestamp

user_trial_eligibility (独立表，不随注销账号删除)
  id                  string PK
  identity_key        string unique  优先 unionid，缺失退化 openid 或 device_id
  trial_claimed_at    timestamp
  created_at          timestamp

user_health_profile
  user_id              string PK
  goal                 enum lose_weight|maintain|gain_weight|...
  daily_calorie_target int
  daily_protein_target int
  daily_carbs_target   int
  daily_fat_target     int
  diet_preferences     string[]   素食 / 低碳 / 生酮 / ...
  allergies            string[]   牛奶 / 鸡蛋 / 海鲜 / 自定义...
  medical_history      string[]   高血压 / 糖尿病 / 自定义...
  custom_health_focuses jsonb     [{id, label, query, created_at}]
  bmr                  float
  tdee                 float
  activity_level       enum sedentary|light|moderate|active|very_active
  created_at  timestamp
  updated_at  timestamp

user_health_documents (体检报告 OCR 结果)
  id        string PK
  user_id   string
  image_url string  (COS key)
  status    enum pending|processing|done|failed
  extract_payload jsonb   { _status, _image_urls, _error, indicators[] }
  created_at  timestamp
```

### 4.2 食物分析与记录

```text
analysis_tasks (异步分析任务表)
  id              string PK
  user_id         string
  task_type       enum food_analysis|food_text|packaged_nutrition_label|packaged_product_extract|food_expiry|health_report|stats_insight
  execution_mode  enum standard|strict|standard_web_search|strict_web_search
  image_paths     string[] (COS keys)
  image_url       string?  兼容字段
  text_prompt     string?
  additional_context string?
  status          enum pending|processing|done|failed
  result_payload  jsonb
  error_message   string?  (展示给用户前必须清洗)
  credit_group_id string
  credits_cost    int
  created_at      timestamp
  updated_at      timestamp

user_food_records (饮食记录主表)
  id              string PK
  user_id         string
  recorded_on     date              记录归属日期 (Asia/Shanghai)
  meal_slot       enum breakfast|lunch|dinner|snack
  source          enum photo|text|manual|recipe
  image_paths     string[]
  food_items      jsonb  [{
                          name, weight, intake, ratio, gross_weight_grams,
                          edible_portion_ratio, suggested_ratio, suggested_ratio_reason,
                          nutrients: {calories, protein, fat, carbs, fiber, ...},
                          source_food_id, manual_source, manual_source_id,
                          original_weight_grams, ...
                        }]
  total_calories  float
  total_protein   float
  total_fat       float
  total_carbs     float
  total_fiber     float
  ai_insight      jsonb   { insight, pfc_ratio_comment, absorption_notes, context_advice }
  task_id         string?
  is_corrected    bool
  created_at      timestamp
  updated_at      timestamp

food_nutrition_library (通用食物营养基准，每 100g)
  id          string PK
  name        string unique (normalized)
  category    string
  per_100g    jsonb { calories, protein, fat, carbs, fiber, sodium, ... }
  source      enum verified|community|ai
  created_at  timestamp

food_nutrition_aliases (别名)
  id            string PK
  alias         string unique
  food_id       string FK
  alias_source  enum llm|manual|user

packaged_food_library (预包装零食/饮品库)
  id                string PK
  product_key       string unique  规则: normalize(brand + name + spec_text or net_weight_g)
  brand             string?
  product_name      string
  spec_text         string?
  net_weight_g      float?
  per_100g          jsonb
  per_serving       jsonb?
  serving_size_g    float?
  conversion_status enum pending|converted|failed
  ingredients_text  string?
  barcode           string?
  source_image_urls string[] (COS keys)
  raw_label_payload jsonb
  field_confidence  jsonb
  created_at  timestamp
  updated_at  timestamp

packaged_food_aliases (零食别名)
  id           string PK
  alias        string unique
  packaged_food_id string FK
```

### 4.3 公共食物库与菜谱

```text
public_food_library (用户上传的真实餐食)
  id           string PK
  user_id      string
  food_name    string
  category     string
  image_paths  string[]
  province     string
  city         string
  district     string
  latitude     float
  longitude    float
  store_name   string?
  store_address string?
  per_100g     jsonb
  serving_g    float?
  approve_status enum pending|approved|rejected
  like_count   int
  collect_count int
  comment_count int
  created_at  timestamp

user_recipes (用户菜谱)
  id          string PK
  user_id     string
  name        string
  cover_image string?  (COS key)
  ingredients jsonb [{name, weight_g, ...}]
  per_serving jsonb
  steps       string[]
  use_count   int
  created_at  timestamp
  updated_at  timestamp
```

### 4.4 圈子社交

```text
feed_likes_comments (统一社交事件表，圈子互动)
  id            string PK
  user_id       string  操作者
  target_type   enum food_record|exercise_log
  target_id     string
  target_owner  string  目标条目所有者
  action_type   enum like|comment|hide
  comment_text  string?
  parent_comment_id string?
  status        enum active|deleted|hidden
  created_at    timestamp

interaction_notifications (互动通知)
  id           string PK
  user_id      string  接收者
  actor_id     string  动作发起者
  target_type  string
  target_id    string
  action_type  enum like|comment|reply
  read_at      timestamp?
  created_at   timestamp

user_friends
  id          string PK
  user_a      string
  user_b      string  (always sorted)
  status      enum pending|accepted|blocked
  created_at  timestamp

user_friend_requests
  id              string PK
  from_user       string
  to_user         string
  invite_code     string?
  status          enum pending|accepted|rejected|cancelled
  message         string?
  created_at      timestamp
```

### 4.5 体重 / 饮水 / 运动

```text
user_body_metrics
  id                  string PK
  user_id             string
  recorded_on         date
  weight_kg           float?
  body_fat_percent    float?
  waist_cm            float?
  hip_cm              float?
  notes               string?
  created_at  timestamp

user_water_logs
  id           string PK
  user_id      string
  recorded_on  date
  amount_ml    int
  recorded_at  timestamp
  created_at   timestamp

user_exercise_logs
  id              string PK
  user_id         string
  recorded_on     date
  raw_input       string             用户原始文字/语音转写
  exercise_title  string             AI 识别后的标题
  exercise_type   string             跑步/瑜伽/力量/...
  duration_min    int?
  estimated_kcal  int                AI 估算消耗
  estimation_basis string            AI 估算理由
  image_paths     string[]?
  created_at  timestamp
```

### 4.6 保质期管理

```text
food_expiry_items
  id            string PK
  user_id       string
  food_name     string
  category      string
  storage_type  enum room_temp|refrigerated|frozen
  quantity_note string?
  expire_date   date
  opened_date   date?
  note          string?
  source_type   enum manual|ocr|ai
  status        enum active|consumed|discarded
  created_at  timestamp
  updated_at  timestamp

food_expiry_notification_jobs
  id              string PK
  user_id         string
  expiry_item_id  string FK
  template_id     string
  openid          string
  status          enum pending|sent|cancelled|failed
  scheduled_at    timestamp UTC (语义 expire_date 09:00 Asia/Shanghai)
  sent_at         timestamp?
  retry_count     int
  max_retry_count int
  payload_snapshot jsonb
  created_at  timestamp
```

### 4.7 会员 / 积分 / 宠物

```text
membership_plan_config
  plan_code         string PK   free|trial|standard|pro
  display_name      string
  monthly_credits   int
  daily_credit_cap  int
  price_yuan        int
  duration_days     int
  features          jsonb
  active            bool

pro_membership_payment_records
  order_no          string PK
  user_id           string
  plan_code         string
  amount            int
  status            enum pending|paid|failed|cancelled|refunded
  notify_payload    jsonb
  extra             jsonb
  created_at  timestamp
  paid_at     timestamp?

user_credit_transactions (积分流水)
  id            string PK
  user_id       string
  account_type  enum system|earned
  amount        int (正进负出)
  reason_code   string  food_analysis_reward_spend|food_analysis_reward_refund|share_poster|...
  source_key    string  幂等键 (user+date+source_key 唯一)
  meta          jsonb
  created_at    timestamp

user_share_rewards (分享奖励去重表)
  id           string PK
  user_id      string
  reward_date  date
  source_key   string  meal_record:<id> | daily_food:<date> | daily_summary:<date>
  reward_count int
  created_at   timestamp

user_pets
  user_id        string PK
  pet_seed       string  外观随机种子
  variant        string  cat|bunny|bear|fox|hamster
  reroll_count   int
  intimacy_level int     亲密度 (来自 record_count, share_count)
  last_reroll_at timestamp?

ai_stats_insights (AI 风险解读缓存)
  id              string PK
  user_id         string
  period_start    date
  period_end      date
  analysis_summary text   清洗后的正文 (650-900 字)
  risk_cards      jsonb
  top_issues      jsonb
  action_list     jsonb
  has_enough_data bool
  finish_reason   string  来自 LLM, length 表示被截断不可用
  created_at  timestamp

ai_custom_focus_cards (用户自定义关注 AI 卡片)
  id        string PK
  user_id   string
  focus_id  string  对应 user_health_profile.custom_health_focuses[i].id
  card      jsonb
  created_at  timestamp
  updated_at  timestamp
```

---

## §5 完整 API 清单

所有路由前缀 `/api`，外层响应 `{ "code": 0, "data": {...}, "message": "..." }`，`code != 0` 视为错误。鉴权用 `Authorization: Bearer <token>`，OptionalJWT 标记的接口可以匿名访问。

### 5.1 认证

```
POST  /api/login                                      微信登录（Android 端可改邮箱/手机号登录）
GET   /api/health                                     健康检查
GET   /api                                            根路由
```

### 5.2 用户档案

```
GET    /api/user/profile                              当前用户信息
PUT    /api/user/profile                              更新昵称/头像/性别/年龄/身高
POST   /api/user/bind-phone                           绑定手机号
POST   /api/user/upload-avatar                        上传头像 (multipart)
DELETE /api/user/account                              注销账号 (只删业务数据，不重置 trial_eligibility)

GET    /api/user/dashboard-targets                    获取首页热量目标
PUT    /api/user/dashboard-targets                    更新首页热量目标 (含 14 天校准)

GET    /api/user/health-profile                       获取健康档案
PUT    /api/user/health-profile                       更新健康档案
GET    /api/user/health-focuses                       获取自定义关注项
PUT    /api/user/health-focuses                       覆盖式更新
POST   /api/user/health-focuses                       新增一项
DELETE /api/user/health-focuses/:focus_id             删除一项

POST   /api/user/health-profile/ocr                   体检报告 OCR (同步)
POST   /api/user/health-profile/ocr-extract           体检报告字段提取
POST   /api/user/health-profile/submit-report-extraction-task    提交异步 OCR 任务
POST   /api/user/health-profile/upload-report-image   上传体检报告图片

GET    /api/user/record-days                          有饮食记录的日期列表 (用于日历)
POST   /api/user/last-seen-analyze-history            标记已查看分析历史
POST   /api/user/acknowledge-health-disclaimer        勾选健康声明
```

### 5.3 首页

```
GET    /api/home/dashboard                            首页 dashboard (今日饮食+目标+宠物状态+保质期 preview)
GET    /api/food-record/:record_id/poster-calorie-compare    分享海报数据
```

### 5.4 食物分析

```
POST   /api/analyze                                   同步分析（拍照）
POST   /api/analyze-text                              同步分析（文字）
POST   /api/analyze-compare                           对比模式
POST   /api/analyze-compare-engines                   多引擎对比
POST   /api/analyze/batch                             批量分析
POST   /api/analyze/submit                            提交异步分析任务（主用）
POST   /api/analyze-text/submit                       提交异步文字分析任务

GET    /api/analyze/tasks                             任务列表
GET    /api/analyze/tasks/count                       任务数量
GET    /api/analyze/tasks/status-count                按状态分组计数
GET    /api/analyze/tasks/:task_id                    任务详情（轮询用）
PATCH  /api/analyze/tasks/:task_id/result             更新任务结果（用户编辑）
DELETE /api/analyze/tasks/:task_id                    删除任务
POST   /api/analyze/tasks/cleanup-timeout             清理超时任务（系统）

POST   /api/precision-sessions/:session_id/continue   精准模式多步会话续接
```

### 5.5 食物记录

```
POST   /api/food-record/save                          保存饮食记录
GET    /api/food-record/list                          列表（按日期分组）
GET    /api/food-record/share/:record_id              分享页 (匿名可访问)
GET    /api/food-record/:record_id                    单条详情
PUT    /api/food-record/:record_id                    更新（用户调整后）
DELETE /api/food-record/:record_id                    删除

POST   /api/upload-analyze-image                      上传图片到 COS（base64）
POST   /api/upload-analyze-image-file                 上传图片到 COS（文件）

GET    /api/food-nutrition/search                     通用食物库搜索
GET    /api/food-nutrition/unresolved/top             未解析食物 Top（运营用）

POST   /api/packaged-food                             创建预包装食物
POST   /api/packaged-food/extract/submit              提交预包装识别任务（多图）
POST   /api/packaged-food/nutrition-label/recognize   营养表识别（同步）
POST   /api/packaged-food/nutrition-label/submit      营养表异步任务
```

### 5.6 公共食物库

```
GET    /api/public-food-library                       列表（分页，支持地理筛选）
POST   /api/public-food-library                       上传新条目
GET    /api/public-food-library/mine                  我上传的
GET    /api/public-food-library/collections           我收藏的
POST   /api/public-food-library/feedback              反馈
GET    /api/public-food-library/:item_id              详情
POST   /api/public-food-library/:item_id/like         点赞
DELETE /api/public-food-library/:item_id/like         取消赞
POST   /api/public-food-library/:item_id/collect      收藏
DELETE /api/public-food-library/:item_id/collect      取消收藏
DELETE /api/public-food-library/:item_id              删除（仅本人）
GET    /api/public-food-library/:item_id/comments     评论列表
POST   /api/public-food-library/:item_id/comments     发评论
```

### 5.7 菜谱

```
GET    /api/recipes                                   列表
POST   /api/recipes                                   创建
GET    /api/recipes/count                             数量
GET    /api/recipes/:recipe_id                        详情
PUT    /api/recipes/:recipe_id                        更新
DELETE /api/recipes/:recipe_id                        删除
POST   /api/recipes/:recipe_id/use                    使用菜谱（生成饮食记录）
```

### 5.8 圈子

```
GET    /api/community/public-feed                     公开 feed（匿名可访问）
GET    /api/community/feed                            好友 feed（要求登录）
GET    /api/community/checkin-leaderboard             检入排行
POST   /api/community/feed/:record_id/like            点赞
DELETE /api/community/feed/:record_id/like            取消点赞
POST   /api/community/feed/:record_id/hide            隐藏
GET    /api/community/feed/:record_id/comments        评论列表
GET    /api/community/feed/:record_id/context         feed 上下文（详情页用）
POST   /api/community/feed/:record_id/comments        发评论
DELETE /api/community/feed/:record_id/comments/:comment_id    删除评论
GET    /api/community/comment-tasks                   评论任务（运营）
GET    /api/community/notifications                   互动通知列表
POST   /api/community/notifications/read              标记已读
```

> **注意**：上面 `:record_id` 实际语义是 `target_id`，target_type 通过 query 或 body 传递（首批支持 `food_record` 与 `exercise_log`）。

### 5.9 好友

```
GET    /api/friend/search                             搜索用户
POST   /api/friend/request                            发起好友请求
GET    /api/friend/requests                           我收到的请求
POST   /api/friend/request/:request_id/respond        接受/拒绝
DELETE /api/friend/request/:request_id                取消请求
GET    /api/friend/list                               好友列表
GET    /api/friend/count                              好友数
DELETE /api/friend/:friend_id                         删除好友
GET    /api/friend/requests/all                       所有请求（含历史）
POST   /api/friend/cleanup-duplicates                 清理重复（系统）
GET    /api/friend/invite/profile/:user_id            邀请人资料
GET    /api/friend/invite/profile-by-code             凭邀请码看邀请人
GET    /api/friend/invite/resolve                     解析邀请链接
POST   /api/friend/invite/accept                      接受邀请
```

### 5.10 体重 / 饮水 / 运动

```
GET    /api/body-metrics/summary                      综合摘要
POST   /api/body-metrics/sync-local                   同步本地缓存
POST   /api/body-metrics/water                        记录饮水
POST   /api/body-metrics/water/reset                  重置当日饮水
DELETE /api/body-metrics/water/:log_id                删除某条饮水
POST   /api/body-metrics/weight                       记录体重
DELETE /api/body-metrics/weight/:record_id            删除某条体重

GET    /api/exercise-calories/daily                   今日运动消耗汇总
GET    /api/exercise-logs                             运动记录列表
POST   /api/exercise-logs                             记录运动（含 AI 估算）
POST   /api/exercise-logs/estimate-calories           只估算不保存
DELETE /api/exercise-logs/:log_id                     删除
```

### 5.11 统计与 AI 洞察

```
GET    /api/stats/summary                             统计页主数据（指标/健康指数/卡片/动作建议）
POST   /api/stats/custom-focus/generate               生成自定义关注 AI 卡片
POST   /api/stats/insight/generate                    生成 AI 风险解读（650-900 字）
POST   /api/stats/insight/save                        保存 AI 解读
POST   /api/diet/recommendations                      生成"今天吃什么"
GET    /ws/stats/insight                              WebSocket 流式生成（可选）
```

### 5.12 会员与积分

```
GET    /api/membership/plans                          套餐列表（匿名可访问）
GET    /api/membership/me                             我的会员状态（匿名可访问）
GET    /api/membership/reward-center                  赚积分中心（任务列表）
POST   /api/membership/pay/create                     创建支付订单
POST   /api/payment/wechat/notify/membership          微信支付回调
POST   /api/membership/rewards/share-poster/claim     领取分享奖励（幂等键 source_key）
```

### 5.13 宠物

```
GET    /api/pet/summary                               宠物状态（外观+亲密度+待领奖励）
POST   /api/pet/events/:event_id/claim                领取宠物事件奖励
POST   /api/pet/reroll-appearance                     花 5 奖励积分换外观
```

### 5.14 保质期

```
GET    /api/expiry/dashboard                          dashboard
GET    /api/expiry/items                              列表（可按 status 过滤）
POST   /api/expiry/items                              新增
GET    /api/expiry/items/:item_id                     详情
PUT    /api/expiry/items/:item_id                     编辑
POST   /api/expiry/items/:item_id/status              切换状态
POST   /api/expiry/items/:item_id/subscribe           登记推送
POST   /api/expiry/recognize                          拍照识别
```

### 5.15 工具与位置

```
POST   /api/location/reverse                          逆地理编码
POST   /api/location/search                           POI 搜索
POST   /api/qrcode                                    生成小程序码
GET    /api/manual-food/browse                        手动记录浏览（OptionalJWT）
GET    /api/manual-food/catalog                       手动记录分类（OptionalJWT）
GET    /api/manual-food/search                        手动记录搜索（OptionalJWT）
```

### 5.16 内部测试（你可以全部跳过实现）

```
POST   /api/test-backend/*                            内部测试后台
GET    /api/prompts*                                  Prompt 管理
POST   /api/test/batch-upload                         批量测试
POST   /api/test/single-image                         单图测试
GET    /test-backend                                  测试后台 HTML
GET    /test-backend/login                            测试后台登录
GET    /map-picker                                    地图选点 HTML
```

---

## §6 核心业务流程与状态机

### 6.1 注册 + onboarding 流程

```
启动 app
  ↓
未登录 → 显示首页骨架（部分匿名内容可见，比如 public-feed）
  ↓ 用户点登录
进入 /login
  ↓ 手机号/邮箱/Apple ID 登录
后端发 JWT，缓存到本地
  ↓
判断 onboarding_completed?
  否 → 强制跳 /health-profile （新用户问卷）
       ↓ 完成
       后端 PUT /api/user/health-profile, 返回 onboarding_completed=true
       同时计算并写入 BMR/TDEE/daily_calorie_target
       ↓
       领取试用积分（一次性）：调 /api/user/profile 返回的 trial_claimed_at
       ↓
  是 → 进入首页
```

**关键陷阱**：注销账号 → 同一身份重新登录时，**不能重新发试用积分**。判断依据是独立表 `user_trial_eligibility`（按 `unionid` / 稳定身份键查）。

### 6.2 拍照分析主流程

```
首页 / Record tab → "+" 拍照按钮
  ↓
进入 /record/photo
  ↓
拍照 / 选图（最多 4 张）
  ↓
选择分析模式（4 选 1）：
   - standard          普通模式      2 积分
   - strict            精准模式      4 积分（仅试用/进阶版）
   - standard_web_search  普通+联网  2 积分
   - strict_web_search    精准+联网  4 积分（仅试用/进阶版）
  ↓
积分校验：调 ValidateFoodAnalysisCredits 检查够不够，不够 → 引导进 /reward-center
  ↓
上传图片到 COS：POST /api/upload-analyze-image-file → 返回 image_paths (COS keys)
  ↓
提交任务：POST /api/analyze/submit { image_paths, execution_mode, additional_context }
  → 返回 task_id
  → 同时立即扣减积分（ConsumeEarnedCreditsOnTaskCreated）
  ↓
进入 /analyze/loading 页 + spinner
  ↓
轮询 GET /api/analyze/tasks/:task_id 每 2 秒一次（或用 WebSocket 也行）
  ↓
status=done → 跳 /analyze/result/{recordId}
status=failed → 显示清洗后的错误信息 + "重新拍照" 按钮，并退还积分
                （RefundEarnedCreditsAfterTaskFailure）
  ↓
结果页展示：
  - 图片 thumbnails（可切换主图）
  - 食物清单：每条 { name, gross_weight_grams, edible_portion_ratio, estimated_weight_grams,
                     suggested_ratio, suggested_ratio_reason, nutrients }
  - 用户可用滑块调整每条 "实际摄入比例"（默认 100%，不是 suggested_ratio！）
  - 用户可点击"应用建议"将摄入比例设为 suggested_ratio
  - AI 饮食分析卡片（含进食顺序建议）
  - 餐次选择（早/中/晚/加餐，按当前时间智能默认）
  - 底部：[二次纠错] [保存]
  ↓
保存：POST /api/food-record/save → 写入 user_food_records，触发圈子刷新事件
```

### 6.3 二次纠错子流程

```
结果页点 "二次纠错"
  ↓
打开纠错抽屉
  - 列出当前 correctionItems（结构化食物列表）
  - 用户可：增/删/改 列表项，或在底部 textarea 写自由说明
  ↓
点 "重新分析"
  ↓
POST /api/analyze/submit { 重提，附带 correctionItems + additionalContext }
  ↓
后端 worker：
  1. 解析 additionalContext 中与食物名相邻的明确数值（"60克"、"532千焦" 等）
  2. 自由文本明确值 > 旧 correctionItems > AI 自由理解
  3. 用 1 kcal = 4.184 kJ 转换 kJ
  ↓
返回新 result_payload，前端覆盖结果页
```

### 6.4 圈子 feed 主流程

```
进入 /community
  ↓
顶部 Tabs：[好友] [公开]
  ↓
内容类型 chips：[全部] [饮食] [运动]
  ↓
GET /api/community/feed 或 /api/community/public-feed
  ?type=all|food_record|exercise_log
  &cursor=xxx
  ↓
返回每条 feed 包含：
  - target_type + target_id
  - 用户头像/昵称
  - 餐次（仅饮食） / 运动类型（仅运动）
  - 图片
  - 文字描述
  - 营养总览（仅饮食） / 估算消耗 + 估算理由（仅运动）
  - 互动数据 like_count, comment_count
  - 已点赞标记
  ↓
分页加载（onScrollToLower）：
  - 必须用 ref 锁防并发（onScroll 兜底和 onScrollToLower 会同时触发）
  - 必须按 record.id 去重
  - 必须用查询 generation 失效旧请求
  - 后端按 created_at DESC, id DESC 稳定排序
  ↓
点赞 / 评论 / 隐藏：POST /api/community/feed/:target_id/like 等
  ↓
点击 feed 卡片 → /community/feed/{id}（详情）
```

### 6.5 健康指数 + AI 风险解读流程

```
进入 /stats
  ↓
GET /api/stats/summary
  → 即使 ai_custom_focus_cards 表缺失也必须返回主数据，custom_risk_cards 降级为空数组
  → 0 天饮食记录时 has_enough_data=false，清空 risk_cards/top_issues/action_list
  ↓
显示：
  - 营养结构卡（蛋白/脂肪/碳水/纤维 占比）
  - 健康指数（has_enough_data=false 时显示 "记录引导"，不显示分数）
  - AI 风险解读卡（点 "更新" 触发生成）
  - 自定义关注卡片列表
  - 体重/饮水/运动趋势入口
  ↓
点 "更新风险解读":
  POST /api/stats/insight/generate { period }
    超时 90s
  ↓
  loading 时按钮内 spinner，正文区蒙层 + skeleton
  ↓
  返回 analysis_summary（清洗过的 markdown 痕迹文本）
  写入 ai_stats_insights 缓存（finish_reason != length 才写入）
```

### 6.6 保质期 OCR + 推送流程

```
/expiry → 点 "拍照识别"
  ↓
拍 1-3 张包装照
  ↓
POST /api/upload-analyze-image-file（每张）
  ↓
POST /api/expiry/recognize { image_urls, additional_context }
  ↓
返回 items: 每条 { food_name, expire_date, confidence, missing_fields, expire_date_is_estimated }
  ↓
进入编辑页，每条变可编辑卡片
  ↓
用户调整后逐条 POST /api/expiry/items 保存
  ↓
保存成功且 status=active → 弹窗询问"是否登记到期提醒"
  ↓
用户同意：调 POST /api/expiry/items/:id/subscribe
  - 调度时间 = expire_date 09:00 Asia/Shanghai
  - 已过期 → schedule_created=false
  - 今天到期但已过 09:00 → now+1min
  - Android 端用 AlarmManager + BroadcastReceiver 兑现
  ↓
后续编辑 expire_date 或切到非 active → 必须取消 pending 通知
```

### 6.7 食物分析积分双账户结算

```
积分模型：
  系统积分 (system_credits)：日重置，会员每日发放
  奖励积分 (earned_credits)：永久累计，分享/上传赚取

分析模式价格：
  standard / standard_web_search → 2 积分
  strict / strict_web_search    → 4 积分（仅试用/进阶版）

结算顺序：
  1. ValidateFoodAnalysisCredits (user, mode, recorded_on, units)
     - 检查 system_credits + earned_credits 是否够
     - 返回 credit_spend_plan { from_system, from_earned, credit_cost, credit_group_id }
  2. ConsumeEarnedCreditsOnTaskCreated (任务创建瞬间扣)
     - reason_code: food_analysis_reward_spend
     - source_key: food_analysis:<credit_group_id>  (幂等)
  3. 任务失败 → RefundEarnedCreditsAfterTaskFailure
     - reason_code: food_analysis_reward_refund
     - source_key: food_analysis_refund:<credit_group_id>  (幂等)

幂等键设计：
  user_id + reward_date + source_key 是唯一键
  source_key 格式：
    food_analysis:<credit_group_id>          扣分
    food_analysis_refund:<credit_group_id>   退分
    meal_record:<record_id>                  单餐分享奖励
    daily_food:<YYYY-MM-DD>                  全天分享奖励
    daily_summary:<YYYY-MM-DD>               今日小结分享奖励
```

---

## §7 业务规则全集

> 这一节是产品的"灵魂"。每一条规则都来自真实迭代中踩过的坑或商业决策。**逐条照做，不要二次发挥**。

### 7.1 时间与日期

- **TZ 锁定**：所有"今天/明天/到期日/记录归属日"等概念基于 `Asia/Shanghai`，不要用设备本地时区
- **日期取整**：到期紧急度 = `floor((expire_date 00:00 Asia/Shanghai - now)/86400)`
  - 今天到期 = 0 天
  - 明天到期 = 1 天
  - 昨天 = -1 天（已过期）
- **餐次智能默认**：保存饮食记录时，根据用户提交时刻（Asia/Shanghai）默认 meal_slot：
  - 04:00–10:30 早餐
  - 10:30–14:30 午餐
  - 14:30–17:30 加餐
  - 17:30–22:00 晚餐
  - 22:00–04:00 加餐

### 7.2 食物分析（核心，规则最多）

- **重量四元语义不能混淆**：
  - `grossWeight` (毛重) — 包括皮、骨、壳的总重
  - `ediblePortionRatio` — 可食部比例 0~1
  - `estimatedWeightGrams` = grossWeight × ediblePortionRatio — 可食部分总重，**这就是图里这份食物的真实重量**
  - `suggestedRatio` — 仅用于结果页"实际摄入比例"滑块的建议值，**不能反向影响 estimatedWeightGrams 或营养回算**
- **不许根据健康目标下调 estimated_weight_grams**：减脂、剩余热量不足、饮食偏好等 reason 都**不允许**修改 estimated_weight_grams。AI 应该如实估算图里的重量，让用户自己决定吃多少（用 suggestedRatio 引导，不替用户决定）
- **`weight` 与 `intake` 字段语义**：
  - `weight` = `estimatedWeightGrams`（展示在"估算重量"位置）
  - `intake` = 实际摄入克数（= weight × ratio），仅展示在"实际摄入"或保存到 records
  - **凡标"估算重量"的 UI 位置必须用 weight，不能用 intake**
- **图片传输**：默认上原图，只在过大时压缩到 90% JPEG，避免 OCR/堆积线索丢失
- **二次纠错合并优先级**：自由文本明确值 > 用户编辑过的 correctionItems > 旧 correctionItems > AI 推断
- **能量单位换算**：1 kcal = 4.184 kJ，识别 "千焦/kJ/千卡/大卡/kcal" 都要支持
- **联网模式的额外提示**：模式名展示加 "(联网)" 后缀，结果页显示"分析时引用了联网数据"标签

### 7.3 圈子 feed

- **feed 是多类型的**：用 `target_type + target_id` 而非 `record_id`
  - 首批支持 `food_record`、`exercise_log`
  - 旧饮食动态稳定键 `food_record:<record_id>`，新运动动态 `exercise_log:<log_id>`
- **运动 feed 必须展示**：原始运动描述/语音文字、用户上传图片、AI 识别后的标题/类型、估算消耗、估算理由。**禁止把运动伪装成饮食或塞进饮食宏量字段**
- **内容类型筛选**：[全部] [饮食] [运动]；饮食专属筛选（餐次/营养均衡）只对饮食动态生效，运动动态出现在"全部"和"运动"
- **分页防并发**：必须用 ref 锁；onScrollToLower 与 onScroll 兜底会同时触发
- **去重**：append 必须按 `record.id` 去重
- **请求失效**：刷新/筛选/删除/分页交错时，旧请求回包必须被 generation 失效
- **后端排序兜底**：`created_at DESC, id DESC`，避免相同时间戳分页边界换位

### 7.4 健康分析（stats）

- **dashboard 不能因辅助表缺失而 500**：
  - `/api/stats/summary` 是核心链路；`ai_custom_focus_cards` 等次要表缺失时，service 层降级为空数组而不是 500
  - SQLSTATE 42P01 (relation does not exist) 必须被吃掉
- **0 天饮食记录的门禁**：
  - 前端不展示 AI 风险解读旧缓存、营养结构 0 值卡、风险卡、行动建议
  - 后端不返回历史 AI 缓存、不生成新洞察、不扣积分
  - 健康指数 has_enough_data=false 时清空 risk_cards/top_issues/action_list
- **AI 风险解读字数门禁**：
  - statsInsightMaxTokens=4096
  - finish_reason=length 视为不可用，走兜底文案，不写入 ai_stats_insights
  - 端到端超时 90s（前端、HTTP server WriteTimeout、WS context 统一）
- **本地缓存按 user_id 隔离**：切换账号或新账号不能读旧账号 stats_page_bundle_v1
- **markdown 痕迹清洗**：前后端都清理 `**`、`#`、`-`，不要原样暴露
- **手动刷新明确反馈**：按钮内 spinner + 正文区 skeleton，不能仅按钮微变
- **自定义关注双向同步**：
  - 新增/刷新自定义 AI 卡时，必须同步更新 `custom_risk_cards` 和 `all_risk_options`
  - addHealthFocus 成功后先合并服务端 focuses，再生成 AI 卡，AI 失败也要保留关注项
  - 兼容旧缓存：渲染允许从 custom_risk_cards 反推缺失的 RiskOption

### 7.5 保质期管理

- **状态二维分离**：status (active/consumed/discarded) 和 urgency (overdue/today/tomorrow/within_week/within_month/longer) 是两个独立维度
- **dashboard 计数**：只计 status=active 的 items；urgency 是从 expire_date 实时计算的派生量
- **OCR 流程**：先 upload-analyze-image-file 拿到 image_urls，再调 recognize；返回 items 进入编辑页逐条确认后保存
- **推送调度**：scheduled_at 锁定 expire_date 09:00 Asia/Shanghai；过期 → 不调度；当天但过 09:00 → now+1min
- **状态机操作**：编辑 expire_date 或切非 active → 取消所有 pending notification jobs
- **错误清洗**：拍照识别失败时，不要原样展示 "EOF/connection reset/AI 模型 URL"，统一清洗为"识别失败，请检查网络后重试"

### 7.6 会员与积分

- **试用资格稳定身份键**：优先 unionid，缺失退化 openid 或 device_id；写入独立表 `user_trial_eligibility`，注销账号不删此表
- **奖励积分 / 系统积分 双账户**：见 §6.7
- **食物分析扣减时机**：任务创建瞬间扣（不是等结果），失败退还，幂等键 source_key
- **分享奖励幂等**：source_key 见 §6.7；同 user + reward_date + source_key 仅可发一次
- **会员套餐显示**：trial > free，进阶 > 标准；价格保留 ¥ 符号，整数

### 7.7 预包装零食上传

- **快速入队**：用户提交后立即进入任务列表，后台慢慢分析，不让用户在页面等待
- **图片数**：1 张就够（包装正面常含净含量+营养表），多图也支持
- **奖励发放条件**：结构化成功 + 规则换算闭合 + 入库 packaged_food_library + 该商品是新建（首次）
- **同商品已存在**：允许幂等更新正式库，**不重复发奖励**
- **任务上限**：零食上传**不限**每日次数；公共食物库每日上限 3 次
- **任务列表数据源**：必须以后端任务为主，本地缓存只作刚提交后乐观补充
- **任务详情可见**：AI 结构化结果、入库商品 ID、奖励状态、失败原因
- **奖励页主层级**：只能是"添加任务"+ "查看任务/结果"；手动表单只在异常时兜底显示

### 7.8 手动记录食物单位

- **不建完整单位系统**：后端继续以克重 + 每 100g 营养为基准，schema 不动
- **轻量显示单位**：`/api/manual-food/catalog` 和 `/search` 追加 `display_unit/display_unit_label/serving_presets`，前端要本地推断兜底
- **默认单位**：
  - 鸡蛋类 → "个"，1个=55g
  - 咖啡/饮品/汤饮 → "ml"，咖啡优先 350/450/590ml
  - 公共食物库/收藏真实餐食 → "份"
  - 普通标准食物 → "g"
- **分类顺序**：常见 → 最近 → 收藏 → 主食 → 肉蛋奶 → 蔬菜 → 水果 → 乳品 → 饮品 → 汤饮 → 零食 → 菜肴 → 其他
- **分类关键词避免误伤**：不要用单字"茶"，要用 咖啡/奶茶/茶饮/绿茶/红茶 等明确词

### 7.9 我的宠物

- **首页悬浮版小尺寸**：避免脸部横线、深色划痕、碎片装饰，用户会误读为伤疤/脏乱
- **动物特征**：用耳朵、尾巴、轮廓、柔和配饰表达；脸部保持圆眼高光、腮红、简单嘴巴、低对比鼻口
- **新外观种子准则**：不引入像伤痕/裂纹/污渍的脸部花纹
- **换外观成本**：5 奖励积分 / 次（reroll-appearance），不消耗系统积分
- **首页 vs 详情页**：首页悬浮陪伴轻量；养成完整信息放 `/pet-home`
- **亲密度计算**：reroll_count + 记录数 + 分享数 综合，不暴露具体公式给用户

### 7.10 错误处理与展示

- **展示前必须清洗**：上游错误中 `EOF/connection reset by peer/timeout/无法连接到 AI 服务/HTTP/2/grpc/socket/Internal Server Error 500/任何 URL/任何文件路径/任何 stack trace` 都禁止原样给用户
- **统一错误文案模板**：
  - 网络类 → "网络繁忙，请稍后重试"
  - AI 服务类 → "AI 分析服务暂时不可用，请稍后重试"
  - 鉴权类 → "登录已过期，请重新登录"
  - 业务类 → 后端 message 字段（已是友好文案）
- **加载态**：**禁止显示"加载中"文字**；只用 spinner / skeleton / shimmer；如果一定要文案，只在错误态或空态出现
- **退出登录文案**：错误兜底不能是"未知错误"，要给可操作下一步

### 7.11 隐私与权限

- **WeChat chooseImage**：在小程序后台"用户隐私保护指引"中已声明；Android 端用 PhotoPicker，权限被拒时给跳设置入口
- **getLocation**：声明在 `requiredPrivateInfos`；用于上传食物库时打店位置
- **拒绝授权**：`isPrivacyAuthorizeError` → 显示"请到隐私设置启用相册"提示并提供跳转设置入口

### 7.12 缓存与离线

- **本地缓存按 user_id 隔离**：所有 storage key 必须包含 user_id，账号切换不能读旧账号缓存
- **清缓存入口**：`我的 → 清除缓存`，会清掉的 key 在 src/pages/profile/index.tsx handleClearCache 列出（Android 端可对应实现一个 `cacheKeys.clearAll()`）
- **dashboard、stats、record list 等都有本地缓存**，刷新时优先展示缓存，再请求覆盖

### 7.13 14 天热量目标校准

- 用户填完健康档案后，前 14 天首页热量目标按 onboarding 计算的 `daily_calorie_target` 展示
- 14 天后用户的实际饮食 + 体重变化会触发自动校准，更新 `dashboard-targets`
- 校准过程对用户透明，不需要 confirm

---

## §8 设计语言与 UI 规范

### 8.1 主题色板

```
品牌主色 (绿) #00BC7D
品牌主色变体 (深) #00A36C
辅助色：
  红 #EF4444   (overdue / 警告)
  橙 #F97316   (today)
  琥珀 #F59E0B (tomorrow)
  浅绿 #10B981 (within_week)
  天蓝 #3B82F6 (within_month)
  紫 #8B5CF6   (longer / 进阶版会员)
  金 #EAB308   (奖励积分高亮)
中性：
  bg-page    #F9FAFB
  bg-card    #FFFFFF
  text-primary #111827
  text-secondary #4B5563
  text-tertiary #6B7280
  divider     #E5E7EB
餐次色（仅圈子和日记）：
  早餐 #FBBF24
  午餐 #F97316
  晚餐 #6366F1
  加餐 #10B981
```

### 8.2 排版

```
- 通用字体：sans-serif (Android 默认)
- 大标题 24sp Bold
- 标题 18sp SemiBold
- 副标题 16sp Medium
- 正文 14sp Regular
- 辅助 12sp Regular
- 数据数值 24-32sp Bold（首页热量、健康指数）
```

### 8.3 形状与间距

- 圆角：卡片 16dp，按钮 12dp，FAB 28dp，输入框 8dp
- 卡片阴影：极浅，elevation=1dp 或 0；视觉层次靠背景色对比，不靠重阴影
- 页面边距：左右 16dp
- 卡片之间 12dp 垂直间距
- tab bar 高度 56-64dp，自定义实现（不用系统 BottomNavigation）

### 8.4 加载态

| 场景 | 推荐 |
|------|------|
| 整页首次加载 | 内容区 skeleton（餐卡、列表项、卡片骨架） |
| 列表分页加载更多 | 底部 spinner（小，居中） |
| 按钮触发的异步操作 | 按钮内 CircularProgressIndicator(size=16dp) |
| WebSocket 流式生成 | 正文 shimmer 蒙层，逐字渐显 |

**禁止任何"加载中..."、"加载中"、"数据加载中"文字**。

### 8.5 各 tab 主页布局参考

#### 首页 `/home`

```
SystemBars: status bar 半透明白底
TopBar: 食探 + 头像（右）
Body (LazyColumn):
  1. 公告 banner（可关）
  2. 热量目标卡（圆环：今日已摄入 / 目标）
       右下角悬浮宠物
  3. 今日餐食 LazyColumn (按 meal_slot 分组)
       早 [+] [展开]
         - 食物记录卡 (image, name, weight, kcal)
       中 [+] ...
  4. 「今天吃什么」推荐入口（点击 → diet/recommendations）
  5. 保质期 preview（最多 3 条临期）
  6. 圈子 preview（好友最新 1-2 条）
FAB: "+" → 选择 拍照 / 文字 / 手动 / 运动 / 体重 / 饮水 / 保质期
BottomTabBar
```

#### 分析 `/stats`

```
TopBar: 分析 + 时间范围切换 (周/月/季/年)
Body:
  1. 营养结构卡（PFC 占比 + 纤维 + 钠/钾）
  2. 健康指数卡（圆环 0-100；has_enough_data=false → 引导记录）
  3. AI 风险解读卡（标题 + 5 段正文 + "刷新" 按钮）
  4. 自定义关注卡片 grid（点 + 弹窗加新关注）
  5. 趋势卡片：体重 / 饮水 / 运动（点击进各自 trend 页）
  6. 行动建议列表（diet recommendations）
```

#### 圈子 `/community`

```
TopBar: 圈子 + 通知图标（带未读 badge）
TopTabs: [好友] [公开] [排行]
ContentTypeChips (好友/公开 tab 下): [全部] [饮食] [运动]
Body (LazyColumn): feed 卡片
  - 用户头像 + 昵称 + 时间
  - 餐次徽标 (饮食) / 运动类型徽标 (运动)
  - 图片 (Pager)
  - 文字描述
  - 营养总览（饮食）/ 估算消耗+理由（运动）
  - [点赞] [评论] [更多 → 隐藏]
FAB: 无（圈子从其他入口产生 feed）
```

#### 我的 `/profile`

```
TopBar: 我的
Body:
  Hero 区: 头像 + 昵称 + 会员徽标 + 系统积分 / 奖励积分
  快捷网格 4x: 健康档案 / 我的宠物 / 邀请好友 / 赚积分
  入口列表:
    - 会员中心 →
    - 积分明细 →
    - 食物记录历史 →
    - 保质期管理 →
    - 我的菜谱 →
    - 食物库 →
    - 隐私设置 →
    - 用户协议 / 会员协议
    - 关于
    - 清除缓存
    - 注销账号
  底部 v2.0.x  (从 BuildConfig 读)
```

### 8.6 关键组件示例

**饮食记录卡**（首页 + 圈子）：

```
┌────────────────────────────────────────────────┐
│  [图片缩略图 64dp]   食物 1, 食物 2, 食物 3     │
│  120 dp 高           早餐  ·  450 kcal · 11:23  │
│                      P 24g · F 12g · C 56g     │
│                      [♡ 12]  [💬 3]            │
└────────────────────────────────────────────────┘
```

**保质期卡**（紧急度颜色映射 §8.1）：

```
┌────────────────────────────────────────────────┐
│ [图标] 牛奶 250ml          [冷藏] 已开封        │
│         明天到期 (2026-05-27)                  │
│         ⏰ 已订阅                              │
│         [继续保鲜] [已用完] [已丢弃] [编辑]     │
└────────────────────────────────────────────────┘
```

### 8.7 全局规则

- 所有空态：图标 + 主文案 + 副文案 + (可选) 主按钮
- 所有错误态：图标 + 清洗后的文案 + 重试按钮
- 所有 destructive 操作（删除、注销、丢弃保质期）：弹 AlertDialog 二次确认
- 所有 toast：用 SnackBar，不用阻塞性 Dialog

---

## §9 给 AI 的输出要求

### 9.1 工程结构（建议遵循）

```
app/
├── build.gradle.kts
├── src/main/
│   ├── AndroidManifest.xml
│   ├── kotlin/com/foodlink/
│   │   ├── App.kt
│   │   ├── MainActivity.kt
│   │   ├── di/                            # Koin or Hilt module
│   │   ├── data/
│   │   │   ├── api/                       # Retrofit interfaces, 一个域一个文件
│   │   │   │   ├── AuthApi.kt
│   │   │   │   ├── UserApi.kt
│   │   │   │   ├── HomeApi.kt
│   │   │   │   ├── AnalyzeApi.kt
│   │   │   │   ├── FoodRecordApi.kt
│   │   │   │   ├── CommunityApi.kt
│   │   │   │   ├── FriendApi.kt
│   │   │   │   ├── HealthApi.kt
│   │   │   │   ├── StatsApi.kt
│   │   │   │   ├── MembershipApi.kt
│   │   │   │   ├── PetApi.kt
│   │   │   │   ├── ExpiryApi.kt
│   │   │   │   ├── PublicFoodApi.kt
│   │   │   │   ├── RecipeApi.kt
│   │   │   │   ├── UtilityApi.kt
│   │   │   │   └── envelope/ApiResponse.kt
│   │   │   ├── fake/                      # FakeApiClient + 内存数据
│   │   │   │   ├── FakeAuthApi.kt
│   │   │   │   ├── FakeHomeApi.kt
│   │   │   │   ├── ...
│   │   │   │   └── FakeRepository.kt
│   │   │   ├── repo/                      # Repository (协调 Api + Cache + Mock)
│   │   │   ├── local/                     # Room (可选) / DataStore for cache
│   │   │   └── model/                     # Data classes
│   │   ├── domain/
│   │   │   ├── model/                     # Domain models
│   │   │   ├── usecase/                   # Use cases
│   │   │   └── credit/                    # 双账户积分结算
│   │   ├── ui/
│   │   │   ├── theme/                     # Material3 ColorScheme + Typography
│   │   │   ├── component/                 # 通用组件 (FoodRecordCard, ExpiryCard, ...)
│   │   │   ├── navigation/                # NavHost + 路由常量
│   │   │   ├── home/                      # 首页 + ViewModel
│   │   │   ├── stats/
│   │   │   ├── community/
│   │   │   ├── profile/
│   │   │   ├── record/                    # 拍照 / 文字 / 手动
│   │   │   ├── analyze/                   # loading / result
│   │   │   ├── expiry/
│   │   │   ├── health/
│   │   │   ├── membership/
│   │   │   ├── pet/
│   │   │   └── ...
│   │   └── util/
│   │       ├── DateUtil.kt                # Asia/Shanghai 处理
│   │       ├── ErrorSanitizer.kt          # §7.10
│   │       └── CreditCalculator.kt
│   └── res/                               # 主题、字符串、minimal assets
└── README.md                              # 必含 §9.4 实现矩阵
```

### 9.2 必须实现的"骨架"清单

| # | 组件 | 必须 | 说明 |
|---|------|------|------|
| 1 | App theme + ColorScheme | ✅ | 按 §8.1 严格映射 |
| 2 | Material3 自定义 BottomTabBar | ✅ | 不要用 NavigationBar 系统默认样式 |
| 3 | NavHost + 全部 §3.2 路由项 | ✅ | 次要页可占位 |
| 4 | Retrofit `*Api` interfaces 覆盖 §5 全部 API | ✅ | 方法签名与 path/verb 一致 |
| 5 | `FakeApi*Impl` 至少覆盖核心域 | ✅ | 离线可跑通主链路 |
| 6 | Auth + token 持久化 (DataStore) | ✅ | Bearer 注入到所有 Authorized 请求 |
| 7 | ApiResponse envelope unwrap | ✅ | code/data/message 三层 |
| 8 | ErrorSanitizer 单测 | ✅ | §7.10 清洗规则 |
| 9 | DateUtil (Asia/Shanghai 工具类) | ✅ | floor 天数差、餐次默认推断、09:00 调度时间生成 |
| 10 | CreditCalculator + 单测 | ✅ | §6.7 双账户结算 |
| 11 | 首页 dashboard 含圆环/餐卡/宠物悬浮 | ✅ | 真数据驱动 |
| 12 | 拍照分析主链路（含 loading 轮询） | ✅ | 提交 → loading → 结果页 → 保存 |
| 13 | 圈子 feed 分页 + 防并发 + 去重 | ✅ | §7.3 |
| 14 | 保质期 dashboard + OCR + 推送注册 | ✅ | §6.6 |
| 15 | AI 风险解读 90s 长生成 + finish_reason 拦截 | ✅ | §7.4 |
| 16 | 双账户积分扣减 + 退还（mock） | ✅ | §6.7 + §7.6 |
| 17 | 健康档案问卷 + onboarding 强制流程 | ✅ | §6.1 |
| 18 | 我的宠物外观 + 5 积分 reroll | ✅ | §7.9 |
| 19 | 14 天热量目标校准（mock 算法） | ⚠️ 可简化 | 至少展示状态 |
| 20 | 主链路至少 5 屏幕截图（README 嵌入） | ✅ | 给评审用 |

### 9.3 离线可跑通主链路验证脚本

`FakeRepository` 必须在内存里支持以下用户故事，全部不依赖后端：

```
故事 A：新用户首次进入
  1. 启动 app → 提示登录
  2. 进 /login → 输入手机号 + 验证码（mock 直接通过）
  3. 后端返 onboarding_completed=false → 自动跳 /health-profile
  4. 填表（目标=减脂、daily_calorie_target=1600）→ 保存
  5. 跳首页，热量目标圆环显示 0/1600
  6. (mock) 自动发放试用积分

故事 B：拍照分析
  1. 首页 + 按钮 → 拍照
  2. 选 standard 模式（2 积分）
  3. (mock) 直接返回成功结果，含 2 个食物：糙米饭 200g + 西兰花 100g
  4. 进结果页，总热量 282 kcal
  5. 调整西兰花 ratio = 80%
  6. 保存 → 跳回首页，今日餐食列表新增一条午餐

故事 C：圈子 feed
  1. 进 community/友 tab
  2. 显示 3 条混合 feed: 2 条饮食 + 1 条运动
  3. 切到"运动"chip，只剩 1 条
  4. 点赞那条 → 心形变红，count + 1
  5. 进详情页 → 评论列表 (mock 2 条) → 发新评论 → 列表新增

故事 D：保质期
  1. 进 expiry → "添加" → 手动新增"鸡蛋 一盒，保质期 后天"
  2. 保存 → dashboard 出现 today/明后天 的计数
  3. 弹窗"是否登记到期提醒" → 同意 → mock 注册了 09:00 AlarmManager
  4. 切到 status=consumed → dashboard 计数减 1，pending notification 标记 cancelled

故事 E：AI 风险解读
  1. 进 stats → 风险解读卡 → "刷新"
  2. 按钮内 spinner，正文 shimmer
  3. 8s 后 (mock) 返回 720 字解读 → 渐显
  4. 再点刷新但 mock 故意 finish_reason=length → 显示"AI 服务暂时不可用，请稍后重试"，不覆盖旧解读

故事 F：注销 + 重登
  1. 我的 → 注销账号 → 二次确认 → 退出
  2. 重新登录同一账号 → onboarding_completed=true（健康档案重建过）
  3. 试用积分**没有**重发
```

### 9.4 自评矩阵（必须放在 README.md）

请你（AI Studio）在 README.md 末尾用 markdown 表格输出"实现矩阵"。每一项必须如实标注下列状态之一：

- `✅ 完整实现` — 按规则做了，且能在 §9.3 故事中表现正确
- `🟡 简化实现` — 做了但简化了某些部分（必须说明简化点）
- `⚠️ 占位` — 路由/页面/接口存在但内部最小化（说明缺什么）
- `❌ 未实现` — 完全没做（说明为什么）
- `❓ 不确定` — 不确定规则含义（必须说明哪部分不懂）

每项后面跟一句话说明。模板：

```markdown
| 编号 | 模块 / 规则                         | 状态     | 说明 |
|-----|------------------------------------|----------|------|
| §3.1 | 4 个 tab 主页                       | ✅       | 都做了 |
| §3.2 | 25 个核心子页                        | 🟡 22/25 | 缺 weight-trend / water-trend / metabolic |
| §5    | 120+ API 全部 Retrofit interface    | 🟡       | 实现了 ~95，剩余测试后台跳过 |
| §6.7  | 双账户积分结算                        | ✅       | 含幂等键 |
| §7.1  | Asia/Shanghai 时区                  | ✅       | DateUtil 单测 |
| §7.2  | grossWeight × ediblePortionRatio   | ✅       | CreditCalculator + AnalyzeViewModel |
| §7.2  | 不许根据健康目标下调 estimated_weight | ❓       | 不太懂场景，按字面照做 |
| §7.3  | feed 多类型 (target_type)            | 🟡       | 实现了 food_record，exercise_log 用占位 |
| §7.4  | finish_reason=length 拦截           | ✅       | mock 故意触发 |
| ...   |                                    |          |      |
```

### 9.5 提交格式

把整个项目以 Android Studio 工程形式产出，要求：

1. `gradlew assembleDebug` 能成功（你不能真编译，但要保证语法/依赖/import 干净）
2. README.md 含：
   - 项目概览
   - 如何跑（含 mock 模式）
   - §9.3 6 个故事的运行步骤
   - §9.4 实现矩阵（强制）
   - "我没做的事 + 原因"清单
   - "我猜了的事"清单
3. 至少 5 张主链路截图（首页、拍照分析、结果页、圈子、保质期）

---

## §10 验收维度与打分

> 你拿到 AI Studio 的产物后，按下面 10 个维度打分，每项 0-10 分，总分 100。

### 维度 1：路由与信息架构覆盖（10 分）

- 4 个 tab 主页都存在 (3)
- 核心子页 ≥ 20 个（不限实现深度，路由能跳进去就行）(4)
- 次要子页路由项 ≥ 15 个 (3)

### 维度 2：API 接口骨架完整度（10 分）

- 120+ API 在 Retrofit interface 里都有定义 (6)
- 路径/方法/参数/返回类型与 §5 一致（snake_case 字段映射正确）(4)

### 维度 3：核心业务流程可演示（15 分）

§9.3 六个故事，每个 2.5 分：

- A 注册 + onboarding (2.5)
- B 拍照分析 (2.5)
- C 圈子 feed (2.5)
- D 保质期 (2.5)
- E AI 风险解读 (2.5)
- F 注销 + 重登（试用不重发）(2.5)

### 维度 4：业务规则保真度（20 分）

13 大类规则，每类 1.5 分（最高 20 上限）：

- 时区 / 日期 (1.5)
- 食物分析重量四元 (1.5)
- estimated_weight 不被健康目标下调 (1.5)
- 圈子多类型 feed (1.5)
- 圈子分页防并发 (1.5)
- stats 0 天门禁 (1.5)
- finish_reason=length 拦截 (1.5)
- 保质期状态二维分离 (1.5)
- 试用资格不随注销重置 (1.5)
- 双账户积分 + 幂等键 (1.5)
- 零食奖励仅新建发放 (1.5)
- 手动单位轻量方案 (1.5)
- 错误清洗规则 (1.5)

### 维度 5：UI 设计语言保真度（10 分）

- 主色 #00BC7D 全局正确 (2)
- Material 3 + 自定义 BottomTabBar (2)
- 加载态没有"加载中"文字 (2)
- 空态/错误态/destructive 二次确认（每项检查）(2)
- 餐次徽标颜色 / 紧急度颜色映射正确 (2)

### 维度 6：错误处理保真度（10 分）

- ErrorSanitizer 单测能正确清洗：EOF / connection reset / URL / stack trace（每项 1 分，4 分）
- AI 服务错误统一文案 (2)
- 鉴权失败统一跳登录 (2)
- 业务错误用后端 message (2)

### 维度 7：状态管理与架构（10 分）

- ViewModel + StateFlow 一致 (3)
- Repository 模式分离 Api / Cache / Mock (3)
- 路由用 Navigation Compose (2)
- DI（Hilt 或 Koin）(2)

### 维度 8：自评矩阵真实度（10 分）

- §9.4 矩阵存在且每项有状态 (3)
- 状态与代码实际情况一致（抽 10 项核对）(4)
- "我没做的事 / 我猜了的事" 清单存在 (3)

### 维度 9：陷阱抵抗（5 分）

随机抽测：

- 它是否在文档没说的地方"自创"了 API 路径？（- 1 分/处）
- 它是否把字段改成 camelCase？（- 1 分/处）
- 它是否在 loading 显示了"加载中"？（- 1 分/处）
- 它是否把 estimated_weight 和 intake 字段混用？（- 1 分/处）
- 它是否把 status 和 urgency 揉成一个 enum？（- 2 分）

满分 5 分，扣完为止。

### 维度 10：交付质量（10 分）

- README 完整、结构清晰 (3)
- 截图齐全 (2)
- 工程能 import 进 Android Studio 不报错 (3)
- 自评矩阵清晰 (2)

### 评级换算

| 总分 | 评级 | 推荐策略 |
|------|------|---------|
| 90-100 | A+ | AI Studio 在结构性产品上达到了"可参考"水平，可以拿它的输出作 RN/Flutter 重写的参考骨架 |
| 75-89  | A  | 主体能跑，业务规则有遗漏；适合做 demo / pitch deck，不适合直接生产 |
| 60-74  | B  | 信息架构对，但规则保真度不足；说明 AI Studio 适合"早期视觉验证"而非"完整复刻" |
| 40-59  | C  | 只能给方向感，每个细节都要重写 |
| < 40   | D  | 不能用 |

---

## §11 实际产出对照表（你拿到 AI Studio 输出后填）

### 11.1 评分汇总

| 维度 | 满分 | 实得 | 备注 |
|------|------|------|------|
| 1. 路由与信息架构覆盖 | 10 | _   |      |
| 2. API 接口骨架       | 10 | _   |      |
| 3. 核心业务流程       | 15 | _   |      |
| 4. 业务规则保真       | 20 | _   |      |
| 5. UI 设计语言        | 10 | _   |      |
| 6. 错误处理           | 10 | _   |      |
| 7. 状态管理与架构     | 10 | _   |      |
| 8. 自评矩阵真实度     | 10 | _   |      |
| 9. 陷阱抵抗           | 5  | _   |      |
| 10. 交付质量          | 10 | _   |      |
| **总分**             | 100| _   |      |
| 评级                  |    | _   |      |

### 11.2 关键发现

- AI Studio 主动简化了什么？
- AI Studio 主动补全了什么（你没要求但它做了）？
- AI Studio 错误理解了什么？
- 哪些业务规则它完全没 implement？
- 它的"实现矩阵"和实际代码差异有多大？

### 11.3 结论：是否值得用 AI Studio 启动 Android 端复刻？

- ☐ 是，作为 0 → 1 骨架，省下 X 天
- ☐ 是，但仅作 demo / pitch
- ☐ 否，业务规则丢失太严重，重写成本反而更高
- ☐ 否，技术债务难以接手

写理由 + 数据支撑：

---

## 附录 A：你给 AI Studio 的初始 prompt 模板

```
我有一个已上线的中文健康饮食 WeChat 小程序「食探」，要把它复刻成原生 Android app。

下面是这个产品的完整规格（§0 - §10）。请严格按 §0 的红线和约束执行，
按 §9 的工程结构和清单交付。每条业务规则按字面实现，不要发挥。

最重要的：你必须在 README.md 输出 §9.4 要求的"实现矩阵自评表"。

[把 §0 - §10 整体粘进来]
```

