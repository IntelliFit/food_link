# 注册新流程 onboarding_v2（A/B 实验）

2026-10-26 实现，分支 `feat/experiment-platform`。设计稿：https://claude.ai/artifact/FSF11GU3H2tQyzjcYzXEAd

## 两组

| 分组 | 流程 |
|---|---|
| `control` | 原流程：登录页 → 头像昵称弹窗 → 13 步健康档案 → 首页（签到弹窗、5 步记录讲解） |
| `pet_flow` | 小麦首屏（盖在首页上，不用登录）→ 先试拍一顿 + 一句话纠错 → 点「存进饮食档案」时手机号登录 → 4 句话建档（目标 → 关注 → 身体情况 → 在哪吃饭/动得多不多），存好后小麦说这一顿看到了什么、给第一个任务 → 首页第一份简报 |

只有首次打开、没登录、不是通过邀请进来的游客参与（首页 `readWelcomeEligible`）。两组都在游客落到首页时记曝光；实验组再盖上首屏。「先随便逛逛」照常浏览首页，满足审核「游客先浏览」的要求。

## 代码位置

- 后端 `backend/internal/onboarding`：
  - `GET /api/onboarding/config`：公开的徽章和说明文字
  - `GET /api/onboarding/stats`：数据量（只算在用/已上线/已审核的行），缓存 1 小时
  - `POST /api/onboarding/try`：游客体验识别，复用同步识别服务（标准模式）；在一个加了咨询锁的事务里先查上限再写 `app_events`（`srv.onboarding_try`，`srv.` 前缀只有服务端能写），之后才调模型；按设备和全站每日上限拦截，另有每 IP 每小时 30 次（Redis 不可用时放行，数据库上限兜底）；纠错只回传每项的名称、重量和四项营养（最多 15 项）；每一项补 `nutrition_source_label`，没匹配到食物库的标「AI 估算」
  - `GET/PUT /api/admin/onboarding/config`：后台编辑，含《广告法》绝对化用语和方括号占位提醒
- 配置表 `app_content_configs`（key `onboarding_v2`），迁移 `go run ./cmd/migration -only-content-configs`。没有配置时不显示任何徽章和宣传说明；后台保存时对「第一、最、领先、权威、精准」等用语和方括号占位给出提醒
- 后台页面 `admin/src/pages/onboarding-page.tsx`（菜单「注册引导与实验」）：改徽章、说明、游客次数；创建/开始/强制分组/结束实验；看各组数据
- 小程序：
  - `components/OnboardingWelcome`（首屏）、`components/FirstBriefSheet`（简报）、`components/TrustBadges`
  - 分包 `packageOnboarding/pages/try`（先试 + 登录保存）、`packageOnboarding/pages/profile`（4 句话建档，问关注的选项在 `pages/profile/FocusPicker.tsx`）
  - `packageOnboarding/focus.ts`（关注选项、小麦的回复、保存关注，只被 `FocusPicker.tsx` 引用）、`packageOnboarding/first-meal.ts`（第一餐那两句，只被建档页引用）。Taro 会把被两个以上模块引用的 `src` 文件打进主包 `common.js`，所以每个文件只留一个引用方、页面只引类型；也不放进 `utils/onboarding-v2.ts`（首页在用，在主包）
  - `utils/onboarding-v2.ts`（一句话身体情况解析、数字格式）、`utils/onboarding-api.ts`
  - 首页 `pages/index/index.tsx`：建档当天不弹签到、不放 5 步讲解、不催健康档案
  - 登录页：实验组未建档用户跳 4 句话建档（没有试拍记录，所以不显示「这一顿看到了什么」，第一个任务照常）

## 4 句话建档写了什么

2026-11-05 在目标后面加了一句「② 你最想改善哪方面？」（原来的身体情况、吃饭/活动变成 ③ ④），只在实验组；对照组走原来的 13 步健康档案，不受影响。

- 选项用分析页关注卡的 key：控血压 `hypertension`、控血糖 `diabetes`、管体重 `weight`、护心血管 `cardio`、肠道舒服 `colorectal`、吃饭更规律 `longevity`、补够钙和钾 `micronutrient`，再加一项「自己写」（2–12 个字）。多选最多 3 项，自己写的也算一项；可以跳过。
- 保存：自己写的先 `POST /api/user/health-focuses` 建出来（和分析页「我的关注」同一个接口），再连同内置项一起 `PUT /api/health/focus`，body `{"keys": ["hypertension", "custom:<id>"]}`。在后台发出，不等结果；任何一步失败只记日志，不拦注册。选完第 ④ 句后的建档保存（`PUT /api/user/health-profile`）会先等它最多 3 秒，因为两个接口都整体改写 `health_condition`，同时写会把关注冲掉。
- 小麦回一句固定的话，只说引擎为这几项真的会看的东西（`nutrition_state_focus.go`）：比如选控血压回「好，我会帮你盯着盐。」；跳过回「没关系，我先帮你看整体吃得均不均衡，以后想改随时说。」
- 第一餐后的反馈：先试拍那一顿保存后，`try` 页把记录 id 用 `record` 参数传给建档页。建档保存成功后，和首页数据（每天大约多少 kcal）一起取、一起显示（分两次追加时第二次自动滚动会被正在进行的滚动吞掉），取的是 `GET /api/health/nutrition-state/meal-impact?record_id=` 的 `headline`（「从你这一顿我看到：…」）和 `GET /api/pet/daily` 的 `task.title` / `task.reason`（「今天的第一个任务」），各等最多 3 秒；取不到、为空或任务已完成就不显示那一句。放在关注和档案都存好之后再取，任务才按这个人的关注选；`/api/pet/daily` 当天第一次读取时会定下当天任务。

`updateHealthProfile`：`diet_goal`、`gender`、`birthday`（只问年龄，按当年 7 月 1 日算）、`height`、`weight`、`activity_level` 和 `daily_life_activity_level`（久坐为主 / 走动较多 / 经常站立，对应 sedentary / light / moderate）、选「学校食堂」时 `is_student=true`。身体情况跳过时按 `onboarding_status=skipped` 保存。每日热量目标以保存后首页接口返回的为准。作息、病史、过敏、饮食偏好、体检报告不再在注册时问。

## 上线前

1. 线上建表：`-only-content-configs`（2026-10-27 已在线上库执行）
2. 后台填好徽章与说明（默认是空的，不填就不显示）；方括号占位不能带上线；精准度、合作方说法要有报告和书面授权
3. 后台创建并开始 `onboarding_v2`（人群仅新用户，50/50）
4. 小程序隐私指引补「使用数据统计」

## 实验指标

后台「看数据」里的「24h 用 AI」除了 `analysis_tasks` 的饮食识别，也把引导页的游客体验（`srv.onboarding_try`，按 anon_id 对应）算进去，避免实验组被低估。注销账号只去掉分组里的 user_id，不把人移出分母。

## 埋点（app_events）

`onboarding_welcome_view / _try / _ask / _browse`、`onboarding_try_view / _photo / _result / _correction / _error`、`onboarding_save_open`、`onboarding_login_success`、`onboarding_record_saved`、`onboarding_profile_view / _goal / _focus / _body / _body_skip / _saved / _done`（`_focus` 的 props：`count` 选了几项（含自己写）、`custom` 有没有自己写、`skipped` 是否跳过；不放选了哪几项）、`onboarding_brief_view / _close`。props 只放界面状态（是否跳过、来源等布尔值），不放身高体重、热量、目标这类健康数值。
