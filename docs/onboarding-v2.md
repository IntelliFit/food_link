# 注册新流程 onboarding_v2（A/B 实验）

2026-10-26 实现，分支 `feat/experiment-platform`。设计稿：https://claude.ai/artifact/FSF11GU3H2tQyzjcYzXEAd

## 两组

| 分组 | 流程 |
|---|---|
| `control` | 原流程：登录页 → 头像昵称弹窗 → 13 步健康档案 → 首页（签到弹窗、5 步记录讲解） |
| `pet_flow` | 小麦首屏（盖在首页上，不用登录）→ 先试拍一顿 + 一句话纠错 → 点「存进饮食档案」时手机号登录 → 3 句话建档 → 首页第一份简报 |

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
  - 分包 `packageOnboarding/pages/try`（先试 + 登录保存）、`packageOnboarding/pages/profile`（3 句话建档）
  - `utils/onboarding-v2.ts`（一句话身体情况解析、数字格式）、`utils/onboarding-api.ts`
  - 首页 `pages/index/index.tsx`：建档当天不弹签到、不放 5 步讲解、不催健康档案
  - 登录页：实验组未建档用户跳 3 句话建档

## 3 句话建档写了什么

`updateHealthProfile`：`diet_goal`、`gender`、`birthday`（只问年龄，按当年 7 月 1 日算）、`height`、`weight`、`activity_level` 和 `daily_life_activity_level`（久坐为主 / 走动较多 / 经常站立，对应 sedentary / light / moderate）、选「学校食堂」时 `is_student=true`。身体情况跳过时按 `onboarding_status=skipped` 保存。每日热量目标以保存后首页接口返回的为准。作息、病史、过敏、饮食偏好、体检报告不再在注册时问。

## 上线前

1. 线上建表：`-only-content-configs`（2026-10-27 已在线上库执行）
2. 后台填好徽章与说明（默认是空的，不填就不显示）；方括号占位不能带上线；精准度、合作方说法要有报告和书面授权
3. 后台创建并开始 `onboarding_v2`（人群仅新用户，50/50）
4. 小程序隐私指引补「使用数据统计」

## 实验指标

后台「看数据」里的「24h 用 AI」除了 `analysis_tasks` 的饮食识别，也把引导页的游客体验（`srv.onboarding_try`，按 anon_id 对应）算进去，避免实验组被低估。注销账号只去掉分组里的 user_id，不把人移出分母。

## 埋点（app_events）

`onboarding_welcome_view / _try / _ask / _browse`、`onboarding_try_view / _photo / _result / _correction / _error`、`onboarding_save_open`、`onboarding_login_success`、`onboarding_record_saved`、`onboarding_profile_view / _goal / _body / _body_skip / _saved / _done`、`onboarding_brief_view / _close`。props 只放界面状态（是否跳过、来源等布尔值），不放身高体重、热量、目标这类健康数值。
