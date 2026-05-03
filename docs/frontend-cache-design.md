# 前端本地缓存设计总览

> 本文档供排查「前端渲染数据不及时 / 数据不一致」问题时参考。  
> 当用户反馈首页摄入目标、朋友圈 feed、统计页数据等看起来"对不上"时，可引导用户通过 **「我的」→「清除缓存」** 一键清理，再下拉刷新或重新进入页面即可重新拉取最新服务端数据。

---

## 一、为什么需要本地缓存

微信小程序的 `Taro.getStorageSync` / `Taro.setStorageSync` 被用于以下几类场景：

| 场景 | 目的 |
|------|------|
| **首屏加速** | 首页 dashboard、朋友圈 feed 先读本地缓存渲染，同时发请求更新，减少白屏时间 |
| **离线可用** | 体重记录、饮水记录允许用户先写本地，下次联网时同步 |
| **跨页面状态传递** | 识别结果页 → 记录详情页 → 首页，通过 storage 传递任务参数和结果 |
| **用户偏好记住** | 筛选条件、弹窗已展示标记等，避免每次重置 |
| **乐观更新** | 保存饮食记录后，先本地计算并更新 dashboard 快照，再异步刷新服务端数据 |

---

## 二、遇到数据不一致时的标准排查步骤

当用户报告「首页数据不对」「朋友圈显示旧内容」「统计数字和实际不符」时，按以下顺序排查：

1. **先确认服务端数据是否正确** — 让用户提供具体日期，直接查数据库验证
2. **检查是否为缓存导致** — 如果是，引导用户执行以下操作：
   - 进入 **「我的」页面 → 点击「清除缓存」**
   - 确认清除后，**下拉刷新页面**或**退出小程序重新进入**
   - 观察数据是否恢复正常
3. **若清除缓存后仍不一致** — 说明问题在服务端，继续按接口维度排查

> ⚠️ 「清除缓存」功能位于 `src/pages/profile/index.tsx` 中的 `handleClearCache`，当前清理范围覆盖首页与朋友圈相关的全部本地缓存（详见下方清单）。若后续新增其他模块缓存，应同步扩展该清理逻辑。

---

## 三、缓存字段详细清单

### 3.1 首页 Dashboard 模块

| 缓存 Key | 存储内容 | 使用页面 | 关联后端接口 | 说明 |
|---------|---------|---------|-------------|------|
| `home_dashboard_local_cache` | 当日/历史 dashboard 快照（摄入、餐次、运动消耗、成就等） | `pages/index` | `GET /api/user/dashboard` (`getHomeDashboard`) | 饮食记录保存成功后写入，回首页可立即看到更新，无需等整页重拉。上限保存 14 天。 |
| `body_metrics_storage` | 体重记录、饮水记录、饮水目标 | `pages/index` | `GET /api/user/body-metrics/summary` (`getBodyMetricsSummary`) | 与服务端数据合并存储。用户录入体重/饮水时先写本地，下次请求时带上同步。 |
| `food_link_dashboard_targets_v1` | 用户自定义摄入目标（卡路里、蛋白质、碳水、脂肪） | `pages/index` | `GET /api/user/dashboard-targets` / `PUT /api/user/dashboard-targets` (`getDashboardTargets` / `updateDashboardTargets`) | 服务端优先；若后端未部署独立接口（404），则 fallback 写入本地 storage，并回退到 `PUT /api/user/health-profile` 携带 `dashboard_targets`。 |
| `home_poster_modal_visible` | 首页弹窗海报是否已展示（标记值 `'1'`） | `pages/index` | 无（纯本地标记） | 首次进入首页展示海报后写入，避免重复弹窗。 |
| `showRecordMenuModal` | 首页记录菜单引导弹窗是否已展示 | `pages/index` | 无（纯本地标记） | 新用户首次进入首页后展示，点击后清除。 |

**清理影响**：清除后首页会重新从服务端拉取 dashboard、体重饮水数据、摄入目标，弹窗标记重置（可能再次弹窗）。

---

### 3.2 朋友圈（社区）模块

| 缓存 Key | 存储内容 | 使用页面 | 关联后端接口 | 说明 |
|---------|---------|---------|-------------|------|
| `community_feed_cache` | Feed 列表数据（动态 + 评论） | `pages/community` | `GET /api/community/feed` (`communityGetFeed`) / `GET /api/community/public-feed` (`communityGetPublicFeed`) | 有效期 5 分钟。先读缓存渲染，同时发请求更新。 |
| `community_friends_cache` | 好友列表 | `pages/community` | `GET /api/community/friends` (`communityGetFriends`) | 有效期 5 分钟。 |
| `community_requests_cache` | 好友申请列表 | `pages/community` | `GET /api/community/friend-requests` (`communityGetFriendRequests`) | 有效期 5 分钟。 |
| `community_feed_timestamp` | Feed 缓存时间戳 | `pages/community` | 无（辅助标记） | 用于判断缓存是否过期（5 分钟）。 |
| `community_friends_timestamp` | 好友列表缓存时间戳 | `pages/community` | 无（辅助标记） | 同上。 |
| `community_feed_filters_v2` | Feed 筛选条件（作者范围、饮食目标、餐次类型、排序方式） | `pages/community` | 无（纯本地状态） | 用户选择的筛选条件持久化，下次进入自动恢复。 |
| `community_priority_authors_v1` | 优先展示的作者 ID 列表 | `pages/community` | 无（纯本地计算） | 基于用户互动频率本地计算，提升熟人内容优先级。 |
| `community_notification_target_v1` | 消息通知跳转目标（recordId + 通知类型） | `pages/community` | 无（纯本地状态） | 点击推送通知后记录目标，进入页面自动定位到对应动态。有效期 10 分钟。 |
| `community_comment_bar_visible` | 评论输入栏是否展开 | `pages/community` | 无（纯本地状态） | 记录用户上次的评论栏展开状态。 |
| `comment_draft_${recordId}` | 某条动态的评论草稿 | `pages/community` | 无（纯本地状态） | 动态 Key，每条动态独立存储。退出页面未发送的评论保留。 |
| `temp_comments_${recordId}` | 某条动态的临时评论（已发送但未审核通过） | `pages/community` | `GET /api/community/comment-tasks` (`communityGetCommentTasks`) | 动态 Key。本地先展示乐观评论，5 分钟内轮询任务状态，审核通过后替换为正式评论；审核失败/violated 则移除。 |

**清理影响**：清除后朋友圈会重新从服务端拉取 feed、好友列表、好友申请，筛选条件重置为默认，评论草稿和临时评论全部丢失。

---

### 3.3 统计页模块

| 缓存 Key | 存储内容 | 使用页面 | 关联后端接口 | 说明 |
|---------|---------|---------|-------------|------|
| `stats_page_bundle_v1` | 周/月统计聚合数据（摄入、TDEE、连续天数、饮食结构等） | `pages/stats` | `GET /api/user/stats/summary` (`getStatsSummary`) | 按 `range: 'week' \| 'month'` 分别存储，网络刷新成功后写入。 |

**清理影响**：清除后统计页重新从服务端拉取周/月数据。

---

### 3.4 分析（AI 识别）流程模块

分析流程涉及多个页面（拍照 → 分析中 → 结果页 → 记录页），通过 storage 传递跨页状态：

| 缓存 Key | 存储内容 | 使用页面 | 关联后端接口 | 说明 |
|---------|---------|---------|-------------|------|
| `analyzeImagePath` | 单张拍照图片路径 | `analyze`, `analyze-loading`, `result`, `record-text`, `analyze-history` | 无（本地文件路径） | 拍照后写入，进入结果页读取展示。 |
| `analyzeImagePaths` | 多张拍照图片路径 | `analyze`, `analyze-loading`, `result`, `record-text`, `analyze-history` | 无（本地文件路径） | 同上，支持多图。 |
| `analyzeTextInput` | 文本描述输入内容 | `analyze-loading`, `result-text`, `analyze-history` | 无（纯用户输入） | 用户输入的饮食描述文本。 |
| `analyzeTextAdditionalContext` | 额外补充信息 | `analyze-loading`, `result`, `analyze-history` | 无（纯用户输入） | 如"今天运动了 30 分钟"等补充上下文。 |
| `analyzeMealType` | 餐次类型 | `analyze`, `result`, `record-manual`, `result-text`, `analyze-history` | 无（用户选择） | breakfast / lunch / dinner / snack 等。 |
| `analyzeDietGoal` | 饮食目标 | `result`, `record-manual`, `analyze-history` | 无（用户选择） | 增肌 / 减脂 / 维持 等。 |
| `analyzeActivityTiming` | 运动时机 | `result`, `record-manual`, `analyze-history` | 无（用户选择） | 餐前 / 餐后 / 无运动 等。 |
| `analyzeExecutionMode` | 执行模式 | `analyze-loading`, `result`, `analyze-history` | 无（用户选择） | 快速模式 / 精确模式 等。 |
| `analyzeSourceTaskId` | 源任务 ID | `result`, `analyze-history` | 无（任务创建后返回） | 用于追踪识别任务链路。 |
| `analyzeTaskType` | 任务类型 | `result`, `analyze-history` | 无（任务创建时确定） | food_photo / food_text 等。 |
| `analyzeResult` | 分析结果（结构化的食物识别结果） | `result`, `analyze-history` | 无（接口返回后缓存） | 避免重复请求。 |
| `analyzePrecisionSessionId` | 精确识别会话 ID | `analyze-loading`, `result`, `analyze-history` | 无（精确模式特有） | 用于精确识别流程的状态保持。 |
| `analyzePendingCorrectionTaskId` | 待修正任务 ID | `analyze-loading`, `result`, `analyze-history` | 无（修正流程特有） | 用户提交修正后等待后台处理。 |
| `analyzePendingCorrectionItems` | 待修正项列表 | `analyze-loading`, `result`, `analyze-history` | 无（修正流程特有） | 记录用户标记的需要修正的食物项。 |
| `analyzeDebugPreview` | 调试预览标记 | `result` | 无（开发调试用） | 标记是否开启调试预览模式。 |

**清理影响**：分析流程的缓存不在「清除缓存」范围内（这些属于当前任务的工作状态，不是全局数据）。但如果用户反馈分析结果异常，可以建议用户重新走一遍识别流程（这些缓存会在流程正常结束时自动清除）。

---

### 3.5 用户认证与个人信息模块

| 缓存 Key | 存储内容 | 使用页面 | 关联后端接口 | 说明 |
|---------|---------|---------|-------------|------|
| `access_token` | JWT 访问令牌 | 全局 | `POST /api/auth/login` / `POST /api/auth/refresh` | 所有认证接口的凭证。 |
| `refresh_token` | JWT 刷新令牌 | 全局 | `POST /api/auth/refresh` | 用于 access_token 过期后自动续期。 |
| `user_id` | 用户 ID | 全局 | `POST /api/auth/login` | 当前登录用户的唯一标识。 |
| `userInfo` | 用户基本信息（昵称、头像等） | `pages/profile`, `pages/community`, `packageExtra/pages/profile-settings`, `packageExtra/pages/food-library-detail` | `GET /api/user/profile` | 多处页面展示用户信息时直接读取，减少重复请求。 |
| `isLoggedIn` | 登录状态标记 | 全局 | 无（由登录流程写入） | 快速判断是否已登录。 |
| `openid` / `unionid` / `phoneNumber` | 微信开放数据 | 全局 | 微信登录相关接口 | 微信生态用户标识。 |
| `membershipStatus` | 会员状态 | `pages/profile` | `GET /api/user/membership` | 展示会员到期时间、权益等。 |
| `userRegisterTime` | 注册时间 | `pages/profile` | `GET /api/user/profile` | 用于展示用户注册天数等。 |
| `pending_friend_invite_code` | 待处理的好友邀请码 | `packageExtra/pages/login` | 无（从分享链接解析） | 未登录时收到邀请链接，先存本地，登录后自动处理。 |

**清理影响**：上述认证类缓存不在「清除缓存」范围内（清除会导致用户登出，需由「退出登录」功能处理）。

---

### 3.6 Badge / 红点提醒模块

| 缓存 Key | 存储内容 | 使用页面 | 关联后端接口 | 说明 |
|---------|---------|---------|-------------|------|
| `profile_tab_badge_count` | 底部导航栏「我的」按钮 badge 总数 | `custom-tab-bar` | `GET /api/analyze/tasks/status-count` + `GET /api/food-expiry/dashboard` | **Badge = waiting_record + food_expiry_todo**（expired + today + soon）。由首页、profile 页计算后写入，tab-bar 每 300ms 轮询读取。 |
| `analyze_waiting_record_count` | 识别记录 waiting_record 数量 | `pages/index`, `pages/profile`, `custom-tab-bar` | `GET /api/analyze/tasks/status-count` | 排队中/识别中的任务数量，用于 profile 页快捷入口数字 badge 和 tab-bar 展示。 |
| `analyze_has_unseen_waiting_record` | 是否有未查看的 waiting_record | `pages/index`, `pages/profile`, `custom-tab-bar` | `GET /api/analyze/tasks/status-count` | 布尔值。基于后端 `last_seen_analyze_history_at` 判断是否有新记录。 |
| `food_expiry_last_seen_date` | 用户上次查看食物保质期页面的日期 | `pages/index`, `pages/profile`, `packageExtra/pages/expiry` | 无（纯前端） | 格式 `YYYY-MM-DD`。当天看过食物保质期页面后，该板块不计入 badge。次日如有新的待处理食物，badge 重新显示。 |

**清理影响**：清除后所有 badge 计数重置，红点提醒恢复为最新服务端状态。

---

### 3.7 其他杂项缓存

| 缓存 Key | 存储内容 | 使用页面 | 关联后端接口 | 说明 |
|---------|---------|---------|-------------|------|
| `dietGoal` | 饮食目标（分析页使用） | `packageExtra/pages/analyze` | 无（用户选择） | 分析流程中选择的饮食目标。 |
| `recordDetail` | 记录详情（跨页传递） | `packageExtra/pages/record-detail` | 无（纯本地状态） | 从列表页点击某条记录时临时存储详情，进入详情页读取。 |
| `stats_risk_detail_visible` | 统计页风险详情弹窗是否展示过 | `pages/stats` | 无（纯本地标记） | 避免重复弹风险提示。 |

---

## 四、缓存设计原则与注意事项

### 4.1 缓存失效策略

| 模块 | 策略 |
|------|------|
| 首页 dashboard | 每次进入页面时发请求更新，成功后覆盖本地缓存；饮食记录保存后主动刷新当日快照。 |
| 朋友圈 feed | 5 分钟有效期（`CACHE_DURATION = 5 * 60 * 1000`），超过有效期重新请求。 |
| 朋友圈评论草稿 | 无有效期，永久保留直到用户发送或手动清除。 |
| 临时评论 | 5 分钟有效期，超过后自动清理；审核通过后被替换为正式评论。 |
| 统计页 | 每次切换周/月时发请求，成功后写入对应 range 的缓存。 |
| 分析流程 | 任务完成后（保存记录或取消）主动清除相关缓存。 |

### 4.2 常见数据不一致原因

1. **缓存过期但未刷新**：用户长时间未进入某页面，本地缓存已过时，但页面未触发刷新逻辑。
2. **服务端数据更新但缓存未同步**：例如用户在 A 设备上更新了摄入目标，B 设备上的本地缓存仍是旧值。
3. **乐观更新失败**：保存饮食记录后本地乐观更新了 dashboard，但服务端实际写入失败（网络中断等），导致本地显示与服务端不一致。
4. **临时评论审核延迟**：用户发送评论后本地展示了临时评论，但审核时间较长，刷新后临时评论消失，等待审核通过才会正式显示。

### 4.3 扩展「清除缓存」的注意事项

当新增涉及用户感知数据的本地缓存时，应同步更新 `src/pages/profile/index.tsx` 中的 `handleClearCache` 函数，确保用户可以通过「清除缓存」重置该数据。当前已覆盖：

- ✅ 首页 dashboard 相关（`home_dashboard_local_cache`, `body_metrics_storage`, `food_link_dashboard_targets_v1`, `home_poster_modal_visible`, `showRecordMenuModal`）
- ✅ 朋友圈相关（`community_feed_cache`, `community_friends_cache`, `community_requests_cache`, `community_feed_timestamp`, `community_friends_timestamp`, `community_feed_filters_v2`, `community_priority_authors_v1`, `community_notification_target_v1`, `community_comment_bar_visible`）
- ✅ Badge / 红点提醒（`analyze_waiting_record_count`, `analyze_has_unseen_waiting_record`, `food_expiry_last_seen_date`）
- ✅ 动态 Key（`comment_draft_*`, `temp_comments_*`）

---

## 五、快速参考：缓存 Key → 页面 → 接口 对照表

```
home_dashboard_local_cache       → pages/index           → GET  /api/user/dashboard
body_metrics_storage             → pages/index           → GET  /api/user/body-metrics/summary
food_link_dashboard_targets_v1   → pages/index           → GET/PUT /api/user/dashboard-targets
home_poster_modal_visible        → pages/index           → (本地标记)
showRecordMenuModal              → pages/index           → (本地标记)

community_feed_cache             → pages/community       → GET  /api/community/feed (or /public-feed)
community_friends_cache          → pages/community       → GET  /api/community/friends
community_requests_cache         → pages/community       → GET  /api/community/friend-requests
community_feed_timestamp         → pages/community       → (辅助标记)
community_friends_timestamp      → pages/community       → (辅助标记)
community_feed_filters_v2        → pages/community       → (本地状态)
community_priority_authors_v1    → pages/community       → (本地计算)
community_notification_target_v1 → pages/community       → (本地状态)
community_comment_bar_visible    → pages/community       → (本地状态)
comment_draft_${recordId}        → pages/community       → (本地状态)
temp_comments_${recordId}        → pages/community       → GET  /api/community/comment-tasks

stats_page_bundle_v1             → pages/stats           → GET  /api/user/stats/summary

analyzeImagePath                 → analyze/result/...    → (本地文件)
analyzeImagePaths                → analyze/result/...    → (本地文件)
analyzeTextInput                 → analyze-loading/...   → (用户输入)
analyzeMealType                  → analyze/result/...    → (用户选择)
analyzeResult                    → result                → (接口返回)
# ... (其余分析流程缓存同上)

profile_tab_badge_count          → custom-tab-bar        → (计算值)
analyze_waiting_record_count     → pages/index/profile   → GET  /api/analyze/tasks/status-count
analyze_has_unseen_waiting_record→ pages/index/profile   → GET  /api/analyze/tasks/status-count
food_expiry_last_seen_date       → pages/profile/expiry  → (纯前端)

access_token / refresh_token     → 全局                  → POST /api/auth/login, /api/auth/refresh
user_id / userInfo               → 全局                  → GET  /api/user/profile
membershipStatus                 → pages/profile         → GET  /api/user/membership
```
