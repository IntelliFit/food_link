# DECISIONS

- `2026-04-23`: 当日代谢页不再直接展示“脂肪累计克数”。正式口径改为：红色曲线表示“每分钟被模型判定为转向脂肪堆积的能量，占当天吸收峰值的百分比”，首屏摘要第一项显示“当日转脂能量占总吸收能量的比例（%）”。
- `2026-04-23`: 积分充值页在黑色主题下不能只保留页面根背景切暗；余额卡、充值卡、邀请码卡、金额预设、输入框和规则弹层都应统一补 dark-only 面板与文字对比。其主 CTA `微信支付充值` 在 dark 下正式口径为与卡路里主按钮同系的亮绿色底 + 白字。
- `2026-04-23`: 统计页 Hero 里的 `保持良好` 胶囊、`当日代谢动态` CTA，以及我的页积分卡 `充值` 按钮，在黑色主题下应统一使用与页面主背景同系的深墨绿色面板，而不是浅灰或泛白按钮底。
- `2026-04-23`: 统计页 `餐次结构` 的圆环轨道颜色不能写死在浅色 SVG 里；正式口径改为在 `src/pages/stats/index.tsx` 里读取当前 `scheme`，按 light/dark 动态生成轨道色，否则黑色主题下会出现一圈过亮白轨。
- `2026-04-23`: 黑色主题下的微信原生导航栏与右上角胶囊不应再按页面逐个补丁式处理；正式口径改为在 `withAuth` 中统一监听当前主题，并在页面显示/主题变化时调用 `Taro.setNavigationBarColor`，让首页/分析/圈子/我的及分包页尽量同步切到深色导航外观。
- `2026-04-23`: 对仍使用微信系统导航栏的分包页，深色主题不能只改页面内容区；`record-manual`、`record-text`、`analyze`、`analyze-history` 等页进入时还应按当前主题调用 `Taro.setNavigationBarColor`，否则顶部导航栏会继续停留在浅色口径。
- `2026-04-23`: 图片分析 / 文字记录链路的深色主题不能只停留在页面根卡片层；`analyze-loading` 的全屏占位与错误态、`result` 的头图占位/餐次弹层/二次纠错抽屉/底部操作区、`result-text` 与 `record-text` 的 hero/控制区/禁用态也要统一在 `src/styles/fl-color-scheme-dark.scss` 里补 dark-only 覆盖。

- `2026-04-23`: 深色主题下“页面卡片”和“弹层/抽屉/底部操作区”采用不同口径。普通信息卡片可使用低透明面板，但首页编辑目标、今日餐食操作弹层、记录编辑弹层及类似 modal/sheet 必须保持高不透明暗底，避免黑色主背景下内容漂浮、对比不足。

- `2026-04-23`: 深色主题在黑色主背景下的正式口径改为“透明面板”而不是厚重深绿实底。首页、统计、圈子、我的、弹层与记录详情等通用卡片优先使用低透明度浅色面板变量，保留轻边框与文字对比，不再大面积使用 `rgb(26 34 32 / 88~98%)` 这类实心暗底。

- `2026-04-23`: 深色主题适配不能只覆盖 Tab 根页；分析、结果、健康档案、公共库、好友、定位、手动记录、文本记录、会员、菜谱等分包页也应统一通过 `src/styles/fl-color-scheme-dark.scss` 提供 dark-only 覆盖，避免直接改浅色源样式而误伤亮色主题。
- `2026-04-23`: 「我的」链路下的子页面也统一纳入深色主题覆盖范围，至少包含 `profile-settings`、`health-profile*`、`privacy-settings`、`about/agreement/privacy`、`friends`、`pro-membership`、`exercise-record`、`login`；这些页面优先在 `src/styles/fl-color-scheme-dark.scss` 中做 dark-only 适配，而不是改原浅色 SCSS。
- `2026-04-23`: 好友管理链路的深色主题范围不只 `friends` 列表页，还应覆盖 `interaction-notifications` 与 `interaction-feed-detail`，统一在 `src/styles/fl-color-scheme-dark.scss` 中补充 dark-only 样式，保证消息列表和单条互动详情在黑色主背景下同样可读。
- `2026-04-23`: 首页“编辑目标”和首页菜单类弹层在深色主题下应直接使用与首页主背景同系的实体暗底渐变，不能只把外层容器调深而保留内部半透明卡片，否则会继续产生“透明发飘”的视觉问题。

- `2026-04-23`: 本地启动联调环境时，微信开发者工具仍以本项目专用自动化目标为准，使用 `/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto --project /Users/kirigaya/project/food_link --auto-port 9420`，并以 `mrc` 连通结果作为有效启动确认。
- `2026-04-23`: 若微信开发者工具提示 `dist/app.json` 缺失，不优先怀疑 `project.config.json`；先检查 `dist/` 是否只有空壳文件，再前台执行一次 `npm run build:weapp -- --no-check` 触发首轮完整产物生成，并用 `mrc where --port 9420` 确认已恢复到业务页。

- `2026-04-13`: 首页核心数据（卡路里/餐食/运动/保质期）采用“本地快照优先 + 云端静默覆盖”口径。按日期缓存最近 60 条，页面与切日先渲染本地，再后台请求；云端结果与本地不一致时才回写覆盖。

- `2026-04-13`: 首页分享链路回退到“无称号开关”的固定流程。分享弹层不再提供“显示今日称号”切换，海报生成不再依赖称号可见性状态。

- `2026-04-13`: 小程序全局字体不可再通过 `@font-face` 直接注入本地 OTF 到 WXSS。该做法会导致 `app-origin.wxss` 体积暴涨并触发微信编译/存储错误；全局字体应优先使用系统字体名与回退链。

- `2026-04-13`: 项目全局默认字体口径切换为思源黑体（`Source Han Sans SC`）；在 `src/app.scss` 统一注册字体并覆盖页面与基础组件默认字体族。

- `2026-04-13`: 今日小结海报底栏采用更高可读性排版：头像相对二维码中线等比放大，标题行与副文案行需保留更明显的垂直间距，避免底部信息拥挤。

- `2026-04-13`: 今日小结圆内百分比采用“数字 + `%` 分离绘制”口径：数字作为主视觉更粗更大，`%` 作为次级信息显著缩小并使用差异色；两者按基线对齐并整体轻微下移居中。

- `2026-04-13`: 首页分享弹层“显示今日称号”开关默认关闭；今日小结默认双标题态采用“第二行下移 + 下方留白回收”的间距策略，确保“坚持目标”与上方标题拉开、与下方圆球更贴近。

- `2026-04-13`: 首页「今日小结」分享卡片字体口径统一为思源宋体（`Source Han Serif SC` 字体族）；项目内保留思源宋体与思源黑体字体文件作为可复用字体资源。

- `2026-04-13`: 互动消息单动态详情页需避免依赖 `withAuth` 非 public 模式的首次渲染门控（可能导致页面 `useLoad` 丢参数并卡加载）。该类“依赖路由 query 拉首屏数据”的页面统一采用“public 挂载 + 页面内鉴权重定向 + 路由参数兜底解析（`recordId/record_id/id`）+ 请求超时兜底”模式。

- `2026-04-13`: 前端加载态统一视觉规范：页面处于 loading 状态时不显示“加载中”类文字，统一使用 spinner/skeleton 等动画表达；文本仅用于错误态或空态。

- `2026-04-13`: 今日小结海报的称号展示强调“情绪价值”：称号不再带“今日称号”前缀，位置上移到原日期区域并采用接近主标题的大字；日期信息下移到热量圆上半区，且日期格式不显示年份。

- `2026-04-13`: 互动消息点击动态的正式交互改为“独立单动态详情页”而非“切回圈子页滚动定位”。详情页只承载被点击的单条动态，卡片结构与圈子列表保持一致，并就地展示点赞/评论相关信息与评论交互。

- `2026-04-13`: 今日小结海报中的称号展示采用“圆区内绝对定位”方案：称号胶囊固定放在中央热量圆上半区，不随下方竖条/底栏流式布局变化；分享弹层中的称号开关行需保留顶部安全间距，避免在黑色预览区被遮挡。

- `2026-04-13`: 首页「今日小结」分享图称号能力采用独立模块 `src/utils/daily-honor-title.ts`。称号根据当日摄入热量、三大宏量、喝水完成度、运动消耗与连续打卡数据计算，并由分享弹层开关控制是否渲染到海报（默认开启，切换后立即重新生成海报）。

- `2026-04-13`: 互动消息列表进入动态时，导航优先级调整为「有圈子上级页就 `navigateBack`，否则 `switchTab`」，以降低切换延迟并保留圈子页上下文；同时圈子筛选漏斗图标统一使用 `iconfont icon-filter-filling`，避免 `icon-filter` 在当前字体集下不渲染。

- `2026-04-11`: `app.config` 已启用 `tabBar.custom: true` 时，业务页**不得**再调用 `wx.hideTabBar` / `wx.showTabBar`（Taro 同名 API）做显隐；否则在开发/体验版等环境下易与**系统原生文字 tabBar**叠成双导航。底栏显隐统一由根目录 `custom-tab-bar` 的 `hidden` + `updateHidden`（路径与 storage）控制；`pages/record-menu/index` 视为需隐藏底栏的子页之一。

- `2026-04-10`: `food_link` 真机调试不得继续使用 `dev:weapp` 默认注入的 `http://127.0.0.1:3010`。在真机上，`127.0.0.1` 永远指向手机自身；若要联本地后端，必须改成开发电脑的局域网 IP，或直接使用 `build:weapp:preview / dev:weapp:online` 走 `https://healthymax.cn`。
- `2026-04-10`: 小程序端应避免直接在页面 JSX 中渲染原生 `<svg>` 作为常规图标方案。当前 `tmpl_0_svg not found` 已定位到多处直接 `<svg>` 写法；后续图标实现优先使用 iconfont、图片资源或其它 weapp 兼容方案。
- `2026-04-10`: 互动消息点击动态的定位链路不能再依赖社区页当前 Feed 的筛选、缓存列表或分页 offset。正式口径改为：通知跳转优先按 `record_id` 直取单条动态上下文，再在社区页插入并滚动到目标动态；评论/回复类通知再按 `comment_id / parent_comment_id` 补拉完整评论区并打开输入框。

- `2026-04-01`: 精准模式重新恢复开发，不再沿用“前端彻底关闭 strict”的临时策略。新的正式口径是“多轮精准会话”：`strict` 提交后先进入规划阶段，再根据结果进入 `追问补充 / 建议重拍 / 并行分项估计 / 聚合最终结果`。

- `2026-04-01`: 精准模式的状态机当前收口为 `collecting / needs_user_input / needs_retake / estimating / done / cancelled / failed`。会话主状态放在 `precision_sessions`，轮次问答放在 `precision_session_rounds`，多主体并行估计放在 `precision_item_estimates`。

- `2026-04-01`: 精准模式的“参考物”必须走结构化字段透传，而不是只塞进自由文本。当前统一使用 `reference_objects[]`，每个参考物包含 `reference_type / reference_name / dimensions_mm / placement_note / applies_to_items`，供规划器和分项估计器共同使用。

- `2026-04-01`: 多食物精准估计默认不再让一个模型注意整餐一次做完；正式链路改为“先拆主体，再对子项并行估计，最后聚合”。只有明确单主体时才允许 `single_item` 直接进入单项估计，其余可拆分场景优先 `multi_item_parallel`。

- `2026-04-01`: 体重记录不能再按"每天最多 1 条"处理。正式口径改为：同一天允许记录多次；首页变化文案按"最近一次 vs 上一次"计算，不再默认绑到"昨天"；统计趋势按"每天最后一次"聚合展示。

- `2026-04-01`: 放开同日多次体重记录后，云端同步必须补幂等键。当前收口为：`user_weight_records` 引入 `client_record_id` 作为客户端记录 ID，并移除 `(user_id, recorded_on)` 唯一约束；本地旧体重迁移到云端时优先按 `client_record_id` 去重，没有客户端 ID 时再按"同日同体重"保守去重，避免重复导入。

- `2026-04-01`: 首页喝水弹层的快捷量按钮属于"即时动作"，点击后应直接记一杯并关闭弹层；只有自定义输入量才保留"填写后点保存"的交互。饮水统计仍按自然日累计：第二天首页今日值自动从 `0` 开始，但历史天数据保留用于统计页趋势。

- `2026-04-01`: 首页体重/喝水弹层不能再贴底顶着自定义 tabBar。产品实现口径改为"浮起式底部卡片"，整体上移到 tabBar 之上，并给底部操作区和清空按钮留出稳定点击空间。

- `2026-04-01`: 首页 `今日餐食` 卡片也应遵守"先看图、再看字"的口径。每个餐次卡片默认展示该餐次当天记录里的代表图；若同餐次有多张照片，则保留可预览图片列表并显示张数角标；只有没有实物图时才回退到餐次图标占位。

- `2026-04-01`: 体重/喝水能力不再停留在首页本地 storage。正式口径改为"云端为主、本地兜底"：已登录用户的体重记录、喝水日志、喝水目标都应写入云端；旧首页本地缓存允许作为迁移来源自动补同步，避免之前已记的数据直接丢失。

- `2026-04-01`: 统计页的长期分析不仅看热量和宏量营养素，还要纳入体重与喝水。当前收口为：`GET /api/stats/summary` 直接返回 `body_metrics` 聚合结果，前端统计页展示体重趋势和喝水趋势，不再把这两类数据留在首页孤岛里。

- `2026-04-01`: 饮食记录的商业化口径从"每日次数限制"转向"积分制"。当前拟定的基础规则是：`标准分析 1 积分/次`、`精准分析 3 积分/次`、`新用户赠送 20 积分`，积分仅对 `拍照记录` 与 `文字记录` 生效。

- `2026-04-09`: 商业化正式切换为**积分制**（`POINTS_SYSTEM_ENABLED` 默认开启），不再以 Pro/非 Pro 区分权限；扣费规则：**标准食物分析（拍照/文字）1 分/次**、**精准模式 2 分/次**、**运动热量大模型估算 0.5 分/次**；新用户初始 **100** 积分；充值 **1 元 = 20 积分**（`POINTS_YUAN_TO_POINTS`）；注册用户各有 **registration_invite_code**，新用户登录时传入邀请码则**邀请人与被邀请人各 +20** 积分。数据库需执行 `backend/database/user_points.sql`；积分充值走 `POST /api/points/recharge/create` + 原微信支付回调（`plan_code=points_recharge` 分支发积分）。旧「每日次数」由 `FOOD_ANALYSIS_DAILY_LIMIT_ENABLED` 控制，默认关闭。

- `2026-04-09`: 积分充值订单复用 `pro_membership_payment_records`，`plan_code=points_recharge` 时 `duration_months=0` 表示非订阅；须执行 `backend/sql/migrate_pro_membership_payment_duration_months_allow_zero.sql`，将 `duration_months_check` 放宽为 `duration_months >= 0`，否则插入会触发 PostgreSQL `23514`。

- `2026-04-09`: `pro_membership_payment_records.plan_code` 外键指向 `membership_plan_config.code`，须在库中插入 `code=points_recharge` 的占位行（`is_active=false`，`duration_months=0`，不在套餐列表展示）；同表原 CHECK 常限制 `duration_months>=1`，迁移脚本会先放宽为 `>=0` 再插入；见 `backend/sql/migrate_membership_plan_config_points_recharge_fk.sql`。否则插入触发 `23503` 或 `23514`。

- `2026-04-01`: `手动记录` 必须作为独立记录模式新增，且永久免费。手动记录不走 AI 分析，不消耗积分；其食物选择链路优先使用 `public_food_library`，再兜底 `food_nutrition_library + food_nutrition_aliases`，未命中再进入 `food_unresolved_logs` 供后续词典扩充。

- `2026-04-08`: 手动记录的产品形态从“浏览食物表”收口为“搜索优先单餐工作台”。空搜索时优先展示 `最近常吃 / 收藏优先 / 公共库推荐 / 标准营养词典` 四层；有搜索词时统一走远程搜索混排，不再依赖前端本地筛选和“两栏 tab 切换”。

- `2026-04-08`: 手动记录保存时必须保留来源身份。当前口径是把 `manual_source / manual_source_id / manual_source_title / manual_portion_label` 写进 `user_food_records.items[]` 的 JSON 快照里，而不是额外新建表；这样能在不改主表结构的前提下，支撑“最近常吃 / 同食物复用 / 收藏优先”。

- `2026-04-08`: 手动记录的主链路交互改为“重复点击直接累加”。同一个食物再次点击不再提示“已添加”，而是默认增加一份或一组默认克重；保存成功后统一跳转到 `pages/day-record/index` 的当天页，让用户看到“这顿饭已经记上了”。

- `2026-04-08`: 圈子评论提交必须具备“双层防重复”保护。前端 `community` 评论发送需要同时拦截 `in-flight` 重复触发和短时间同内容连点；后端 `feed_comments` 写入前也必须按“同用户 + 同动态 + 同回复目标 + 同内容 + 短时间窗口”做幂等去重，并在命中重复时跳过再次写互动通知。
- `2026-04-08`: 历史圈子重复评论的清理口径与线上防重保持一致，但窗口放宽到 `45` 秒：同用户、同动态、同回复目标、同内容在 `45` 秒内出现多条时，只保留最早一条，其余视为重复提交清理。
- `2026-04-10`: 互动消息通知也必须具备防重复能力。`create_feed_interaction_notification_sync()` 需要按“同接收人 + 同触发人 + 同动态 + 同通知类型 + 同文案”做短时间幂等；若 `comment_id` 完全相同则直接视为同一事件，不得重复插入通知。
- `2026-04-10`: 历史重复互动通知的清理口径与评论清理一致，默认按 `45` 秒窗口分簇：同接收人、同触发人、同动态、同父评论、同通知类型、同文案在窗口内出现多条时，只保留最早一条。

- `2026-04-01`: 用户明确否定"首页体重/喝水做成独立大卡片模块"的方向。正确口径应是：它们只是首页里的极轻量快捷操作，视觉重量必须低于热量卡和三大营养素卡，按钮尺寸应接近甚至小于营养素卡里的百分比徽标。

- `2026-04-01`: 首页里的体重/喝水即使做成直出，也必须保持"辅助信息"定位，不能压过热量总览与饮食记录主链路。布局上应让热量卡保持首页主视觉，体重/喝水采用更轻、更小的二级卡片表达。

- `2026-04-01`: 体重记录文案不能默认假设"每日 1 次"。产品口径应允许用户按自己节奏补记，比较文案优先使用"较上次"而不是强绑定"较昨日"。

- `2026-04-01`: 圈子评论回复输入栏必须采用稳定的底部 composer 结构，回复提示条与输入框不能再塞进同一横向行里；实现上优先避免 `Textarea autoHeight + fixed` 这类容易导致键盘顶起抖动的组合，确保"点回复后输入框立即可见、位置稳定"。

- `2026-04-01`: "食物保质期记录与提醒"功能当前产品定位应按"个人管理工具"处理，主入口放在 `我的` 页，而不是首页或健康档案。入口形态不是独立大卡片，而应做成和其他服务一致的小图标入口，放在 `我的` 页顶部功能区、靠近"食探会员"卡片；图标右上角允许显示红色数字角标，用于提示即将过期/待处理食物数量。

- `2026-04-01`: 多视角辅助模式采用严格口径：未开启多视角时，拍照分析只允许上传 `1` 张图片；上传多张图片仅用于"同一份食物的不同视角"。前端需要明确提醒用户"如果要拍多视角，请先开启多视角模式"，后端正式接口也必须做同样的硬校验，不能只靠 prompt 猜测。

- `2026-04-05`: 食物保质期功能 V1 的入口放在"我的"页面服务网格，首页只展示已设置好的临期摘要，不承担设置职责。
- `2026-04-05`: 首页"快到期食物"卡片仅在用户当前存在待处理保质期食物时显示；若从未设置或当前待处理数为 `0`，首页整块直接隐藏，不显示空状态占位。
- `2026-04-05`: 食物保质期数据采用独立表 `food_expiry_items` 作为唯一主表管理，不挂在 `health_condition` 等用户 JSON 字段里；旧 `user_food_expiry_items` 与 `/api/food-expiry/*` 已下线，首页与“我的”统一走 `/api/expiry/*`。
- `2026-04-05`: 食物保质期 V1 只支持手动录入，暂不与饮食记录、公共食物库、服务号通知联动。
- `2026-04-05`: 食物保质期支持两种截止精度：`date`（按当天 `23:59:59` 处理）和 `datetime`（按具体时分处理）；状态不单独存库，由 `completed_at + deadline_at` 派生。
- `2026-04-05`: 个人页服务网格中的 `Pro会员` 入口属于测试入口，当前产品阶段对用户侧隐藏；仅移除服务网格测试入口，不影响顶部"食探会员"卡片和既有会员页面路由。

- `2026-03-31`: 饮食记录的信息架构改为"三层职责分离"：`pages/stats/index` 负责历史总览与日历入口，`pages/record/index` 只负责新增记录（拍照/文字），点击某一天的饮食记录必须进入独立的"当天记录页"，不能再跳进拍照页。

- `2026-03-31`: 独立"当天记录页"里的每条饮食记录卡片需要在进入详情前就提供图片缩略图预览；有实物图时展示首张照片并允许直接放大预览，无实物图时显示占位 logo，而不是只给纯文字列表。

- `2026-03-31`: 评论审核链路改为复用 OfoxAI OpenAI 兼容接口，与 Gemini 热量识别共用 `OFOXAI_API_KEY` 和 `https://api.ofox.ai/v1`，默认审核模型切到 `openai/gpt-5.4-nano`。

- `2026-03-31`: 评论审核口径改为"宽松优先、明确违规才拦截"。普通吐槽、轻微负面评价、食物语境玩梗、简短回复、情绪化口语默认放行；只有明确色情、暴力威胁、违法引流、政治煽动、强烈辱骂骚扰时才判违规。

- `2026-04-01`: 评论链路现阶段进一步收口为"默认不做审核，直接发布"。圈子评论与公共食物库评论提交后直接入库并立即展示，不再创建 `comment_tasks` 审核任务，也不再向前端展示"已提交审核/审核中"；圈子评论相关互动通知改为在接口层直接写入。

- `2026-04-01`: 体重记录、喝水记录如果要进入 `food_link`，入口不应藏在"健康档案/健康板块"这类二级区域里。产品口径应优先保证"用户一打开就能直接看到并顺手记录"，优先考虑首页直出，而不是先放进设置型或档案型页面。

- `2026-04-01`: 首页新增体重/喝水能力时，信息架构采用"首页一级数据卡"而非"功能入口"。具体位置固定为：首页日期条下方、热量总览卡上方；其中体重卡偏低频状态记录，喝水卡偏高频快捷操作。

- `2026-03-31`: 首页所有达成率展示统一采用"真实百分比文案 + 视觉进度单独裁剪"的口径。三大营养素与各餐次都必须显示真实比例（可超过 `100%`），但圆环/进度条等视觉控件只裁到 `100%`，并且在前端对 `undefined / NaN / 非数字字符串` 做兜底，避免比例条消失或渲染异常。

- `2026-03-31`: 精准模式当前先临时关闭，不再允许用户在前端主动切换到 `strict`。分析页、健康档案问卷、健康档案编辑页点击精准模式时统一提示"该功能仍在完善中"；重新分析/二次纠错提交也统一回落到 `standard`，避免旧缓存或历史任务继续走精准模式链路。

- `2026-03-31`: 用户健康档案中的 `BMR/TDEE` 计算口径从 Mifflin-St Jeor 切换为更贴近中国成人样本的毛德倩公式；其中 `BMR` 改为按 `性别 + 体重` 计算，`TDEE` 仍保持 `BMR × 活动系数`。相应地，后端不再要求必须先有生日/年龄和身高才生成 `BMR/TDEE`。

- `2026-03-31`: 圈子互动消息不再只覆盖评论/回复/驳回，需补齐 `like_received`。用户给动态点了赞时，只要是"新增点赞"且作者不是自己，就应给作者写入一条站内互动通知。

- `2026-03-31`: 圈子评论里的"回复某人"不能再只靠一段行内文字表达；回复项在视觉上必须与普通评论拉开层级，至少要明确呈现"回复目标 + 差异化内容气泡/引导线"，避免看起来像两条互不相关的独立评论。

- `2026-03-31`: 图片模式二次纠错不能只按"纠错后的食物名"做匹配；请求侧必须携带原项身份（至少 `sourceName`，优先 `sourceItemId`），后端应按"原项替换"而不是"新名字追加"，避免把 `橘子 -> 橙子` 这类改名误处理成新增一项。
- `2026-03-31`: 图片模式二次纠错弹窗里提交的 `correctionItems` 代表用户确认后的"完整最终食物清单"，不是给模型参考的局部提示。Worker 最终写回结果时，数量、顺序、名称、克重都必须以这份清单为准，不能再把模型额外生成的旧项或重复项保留下来。
- `2026-03-31`: 图片模式二次纠错里，如果用户没有手动改列表，而是在补充说明里明确写出改名关系（如 `不是橘子，是橙子`、`炸肉饼实际上是牛肉饼`），前端必须先把这类自然语言翻译成结构化改名再提交；未显式改名的旧 `correctionItems` 不能把模型已经识别出的更具体新名字强行覆盖回去。
- `2026-03-31`: 文字模式二次纠错也需要与图片模式保持相同的"结构化优先"口径：前端不能再丢弃 `correctionItems`，补充说明中的明确改名也应先转成结构化清单；后端文字链路在模型返回后同样要按用户确认清单收口，避免名称、数量或重量又漂回去。
- `2026-03-31`: 二次纠错里的自由文本说明不能再被当成次级"补充信息"；它应是最高优先级的纠错输入。结构化 `correctionItems` 主要负责锁定最终食物列表、顺序和明确重量。前后端都需要支持把口语化表达（如 `X 说得太模糊了，这是 Y`）解析成结构化改名，避免旧清单继续把正确结果压回去。
- `2026-03-31`: 上一条决策继续收敛后，最终口径改为：二次纠错**不再依赖正则或规则去理解用户语义**。自由文本纠错说明完全交给大模型理解；结构化 `correctionItems` 只承担确定性职责，即标记哪些字段被用户显式手改（如 `nameEdited / weightEdited`）以及锁定最终列表顺序。未显式修改的旧名称/旧重量，不能再压过模型本轮结果。
- `2026-03-31`: 图片模式二次纠错需要兼容用户直接用自然语言说"不是 A，是 B / 把 A 改成 B"。当前前端在提交前应先把这类明确改名句式解析进结构化 `correctionItems`，避免用户只写补充说明时看起来"完全没生效"。
- `2026-03-31`: 食物二次纠错排查默认采用"全链路日志法"，不要再只靠猜测 prompt 行为。开启 `FOOD_ANALYSIS_DEBUG=1` 后，至少要能拿到：提交接口收到的 payload、worker 实际拿到的 task_input、prompt、模型 raw output、final_result。

- `2026-03-31`: 圈子 Feed 无论使用 `recommended / hot / balanced` 还是其他推荐排序，主序都必须保持 `record_time` 倒序；推荐分只能作为同时间层内的次级排序参考，不能把旧动态整体顶到新动态前面。

- `2026-03-31`: 微信小程序生产上传默认必须使用"压缩后、无 sourcemap"的 `dist/` 产物：`project.config.json` 保持 `minified=true`、`uploadWithSourceMap=false`，`config/prod.ts` 显式启用 `terser/csso` 并关闭 `mini.enableSourceMap`。这属于低风险减包基线，优先于分包或业务改造。

- `2026-03-31`: 处理 Supabase Storage 配额时，当前阶段采取"先压缩、后删除"的保守策略：先对 `food-images` 中被引用的长期图片做安全二次压缩，确认回看体验可接受后，再处理 `analysis_only_temp` 与 `orphan` 这类临时/孤儿图片删除。压缩阶段优先保持对象 key/URL 不变，降低业务回归风险。

- `2026-03-31`: 食物分析的每日次数限制先临时取消。后端默认不再因当日配额拒绝拍照/文字分析，仅保留环境变量 `FOOD_ANALYSIS_DAILY_LIMIT_ENABLED` 作为恢复开关；恢复前，不再向用户暴露 `3/20` 的日限口径。

- `2026-03-30`: 精准模式后续收敛为"经典简洁版拆分精估模式"：核心不再依赖过细的 `sceneTags` 心智，而是优先围绕 `单食物 / 可拆分混合餐 / 复杂混合餐`、`主体数量`、`边界清晰度`、`是否需要拆拍` 来判断。默认规则是：单主体清晰可直接估，2-3 个清晰主体可分项估，4 个以上或遮挡严重时建议拆拍；缺参照物只作为降可信度因素，不再作为唯一主心智。

- `2026-03-30`: 本地排查 token / prompt 问题时，`FOOD_ANALYSIS_DEBUG=1` 必须启用"本地专用异步任务队列"隔离：`food -> food_debug`、`food_text -> food_text_debug`。避免同一 Supabase 项目中的其他环境 Worker 抢占本地调试任务，导致本地终端看不到真实 prompt/输出日志。

- `2026-03-29`: 食物营养分析链路（图片识别 + 文字识别）当前明确以"速度最大化"为优先级，不再保留任何独立内容审核步骤；提交任务后直接进入主模型识别，由主模型本身返回可识别/不可识别结果。评论审核与公共食物库审核暂不受这条决策影响。
- `2026-03-29`: 首页"今日餐食"里的餐次规划默认按"三餐模式"处理：早餐 / 午餐 / 晚餐按用户当天总热量目标动态分配；各类加餐只显示统一参考值，并明确标注"加餐参考，不计入总目标"。
- `2026-03-29`: 分析中页不展示无法反映真实后端阶段的"步骤进度"；拿不到真实进度时，只保留加载动效与说明，避免用假进度误导用户。
- `2026-03-29`: 首页三大营养素达成率的"文案显示值"不能再被封顶为 `100%`；超过目标时应显示真实比例（如 `120%`），但圆环和进度条等视觉控件仍可保留 100% 上限，避免超出一圈后失真。
- `2026-03-29`: 圈子推荐一期不直接上复杂推荐系统，而采用"后端轻量打分 + 前端轻筛选"的方案：动态 Feed 支持 `recommended / latest / hot / balanced`，并综合特别关注、餐次匹配、目标匹配、热度、新鲜度、营养均衡度做排序。
- `2026-03-29`: 食物识别的 `standard` 与 `strict` 必须走严格分叉的 prompt/schema：`standard` 保持轻量营养识别流程，不再默认输出 `recognitionOutcome / rejectionReason / retakeGuidance / allowedFoodCategory / sceneTags / followupQuestions`；这些结构化判定字段只在 `strict` 下启用，避免标准模式替精准模式承担额外 token 成本。
- `2026-03-29`: "我关注的会员"一期先落为本地持久化的"特别关注作者"列表，不单独新建复杂社交关系表；用户在圈子页点击好友头像即可切换，推荐排序与"特别关注"筛选直接复用该列表。
- `2026-03-29`: 公共食物库推荐一期新增 `balanced / high_protein / low_calorie / recommended` 排序，并通过 `recommend_reason` 给出简短推荐理由，先提升实用性，再考虑后续补餐次字段与更细画像。

- `2026-03-29`: 互动消息里的"评论了你的动态 / 回复了你的评论"点击后，不应再跳到 `record-detail`；应切回 `pages/community/index`，并基于 `record_id / comment_id / parent_comment_id` 自动定位到对应动态的评论区，方便继续回复。
- `2026-03-29`: 当 `main` 与 `dev` 同时各自前进时，分支同步默认采用"先把 `dev` 合入最新 `main`，验证通过后再让 `dev` 快进到同一合并提交"的策略；这样既保留双边历史，也能让两个分支最终落到同一提交，避免继续分叉。
- `2026-03-29`: 这个项目的微信开发者工具读取的是 `dist/` 产物，不是 `src/` 源码；像 tabbar、路由、页面注册这类变更即使源码已正确合并，如果没有重新编译，运行效果仍会停留在旧 `dist`。判断"合并是否生效"时要同时核对 `src/*` 和 `dist/*`。
- `2026-03-29`: 用户已明确确认：`food_link` 项目后续默认不要求"运行项目 + 微信开发者工具截图/交互验证"；前端改动可仅做代码修改与构建校验，除非用户之后单独要求运行态验证。
- `2026-03-29`: 用户再次明确收紧口径：`food_link` 项目默认不做任何运行检测、交互点击、前端截图、构建校验或其他前端验证；只有用户刻意指定时才执行对应验证动作。
- `2026-03-29`: 分析页、结果页、文字结果页的餐次选择必须保持 6 餐次：`breakfast / morning_snack / lunch / afternoon_snack / dinner / evening_snack`；历史 `snack` 仅作为兼容值保留，前端展示与新记录默认映射为 `午加餐`。
- `2026-03-29`: 结果页点击"记录"时，若分析前已经存有 `analyzeMealType`，必须直接按该餐次保存；不要再次弹出餐次选择。只有在缺失餐次缓存时，才允许用户补选一次。

- `2026-03-29`: 食物识别模型返回值不能再默认信任为顶层 `dict`；图片/文字识别解析前必须先做响应归一化。若模型偶发直接返回食物数组，则先包成 `{"items": [...]}`；若结构仍异常，返回用户可读错误，不能把 Python 原始 `.get` 异常直接暴露到前端。

- `2026-03-29`: `food_link` 微信小程序在开发者工具中显示时，默认直接运行 `project.config.json` 指向的 `dist/` 构建产物；`dev:weapp` 只是 Taro 的 watch 编译，不是必须常驻的前端 dev server。
- `2026-03-29`: 前端未显式配置开发环境地址时，`src/utils/api.ts` 默认把 `API_BASE_URL` 指向 `https://healthymax.cn`；因此只要本地还保留 `access_token`，小程序就会直接请求线上后端，而不是依赖本地 Python 服务。
- `2026-03-29`: 本地联调默认应走"开发编译 + 本地后端"链路；前端在 development 下若未显式配置 `TARO_APP_API_BASE_URL`，默认回退到 `http://127.0.0.1:3010`，production 继续使用 `https://healthymax.cn`。
- `2026-03-29`: `backend/run_backend.py` 与本地开发文档统一使用 `3010` 作为默认端口，避免再出现 `3010 / 8000 / 8888` 多套口径并存。
- `2026-03-29`: `npm run build:weapp` 生成的是生产 `dist`，当前会指向 `https://healthymax.cn`；`npm run dev:weapp` 才是开发 watch 构建，首轮编译后 `dist/common.js` 会注入 `http://127.0.0.1:3010`。
- `2026-03-29`: 微信开发者工具当前项目私有配置里 `useStaticServer=false`、`useLanDebug=false`，不存在"开发者工具替你起本地服务"的机制；工具之所以能打开页面，是因为它直接读取现成的 `dist/` 产物。
- `2026-03-29`: `compileHotReLoad=true` 只会在 `dist/` 已经变化时帮助热刷新，不会代替 `npm run dev:weapp` 做源码编译。

- `2026-03-29`: 分析页的本地图片必须在"选中图片/恢复缓存路径"当下立即持久化到 `USER_DATA_PATH`，不能等到点击"分析"时再保存；否则微信临时文件可能已被回收，触发 `compressImage:fail file doesn't exist` / `uploadFile:fail file not found`。
- `2026-03-29`: 图片分析上传链路改为"文件直传优先、base64 仅兼容兜底"；分析页不得再把大 base64 放进页面状态，否则既会放大 `413` 风险，也会触发小程序 `setData` 体积过大告警。
- `2026-03-29`: 食物分析、文字录入、评论审核都需要遵守"食物语境优先"原则；食品名、菜单名、品牌名、包装文案里的玩梗词（如"牛马""打工人""摸鱼"）若明显在描述食物商品本身，不按政治敏感拦截，且只在 `politics / inappropriate_text / other` 这类轻度误判场景自动放行。
- `2026-03-29`: 社区评论初版只支持"动态评论 + 单层回复"，不做多层楼中楼；前端保持扁平渲染，通过 `parent_comment_id` 和 `reply_to_user_id` 展示"回复某人"。
- `2026-03-29`: 社区评论继续沿用异步审核模型；前端提交成功文案必须表达"已提交审核"，并在社区页合并本地临时评论，避免用户误以为评论丢失。
- `2026-03-29`: 互动消息初版不做独立复杂消息中心和推送，只做站内轻量通知表 `feed_interaction_notifications`，支持 `comment_received`、`reply_received`、`comment_rejected`。
- `2026-03-29`: 圈子动态的评论和点赞必须经过可见性校验，允许范围限定为：本人、好友、或作者开启 `public_records` 的动态。
- `2026-03-29`: 圈子 Feed 返回的 `comment_count` 必须是真实总数，不能再直接等于预览评论条数；卡片里评论仅作为预览，允许用户再拉完整列表。
- `2026-03-29`: 图片分析链路与文字分析链路的精准模式字段派生必须分开处理；图片任务只能走 `_derive_recognition_fields`，不能误传文字链路专用的 `text_input`。
- `2026-03-31`: 统计页 `AI 营养洞察` 不应在用户每次打开页面时实时调用大模型；默认策略改为"优先展示最近缓存 + 明示生成日期"，当日数据有变化时仅提示"可手动更新"，由用户主动触发重新生成。
- `2026-04-07`: 保质期提醒正式收口到 `pages/expiry/* + /api/expiry/* + food_expiry_items` 新链路，旧 `pages/food-expiry/*` 不接订阅提醒能力。
- `2026-04-07`: 保质期微信通知采用“小程序订阅消息”而不是服务号模板通知；V1 仅在新增成功后的当次交互里申请订阅，默认只在到期当天提醒一次，调度时间固定为当天 `09:00`（若用户当天晚于该时间才订阅，则尽快补发）。
- `2026-04-07`: 保质期订阅消息里若模板字段使用 `character_string`，后端不得直接透传中文 `quantity_note`；发送前必须统一清洗成 ASCII 安全字符串，空值或全中文备注降级为 `NA`，避免微信报 `argument invalid! data.character_string*.value`。
- `2026-04-07`: 小程序 `app.json` 的 `permission` 只保留合法权限声明（当前保留 `scope.userLocation`）；`scope.camera` 属于无效键，不再写入配置。
- `2026-04-07`: 为兼容微信开发者工具历史启动页缓存，保留 `pages/food-expiry/index` 兼容路由页，仅用于自动跳转到 `pages/expiry/index`，不承载业务逻辑。
- `2026-04-07`: 统计页 `fetchStats` 不能再让本地缓存解析影响云端主链路。即便 `/api/stats/summary` 与 `/api/body-metrics/summary` 返回 200，也必须对 `body_metrics_storage` 做结构校验并“按需读取”（仅在云端缺数据时兜底），避免脏缓存触发前端 `获取统计失败`。
- `2026-04-08`: 运动热量估算链路不得把大模型的非标准返回静默降级为 `0 kcal` 并直接入库。若无法可靠解析，应将任务标记为失败；解析时优先识别带 `kcal/千卡/大卡` 的数字，兜底再取候选数值中的最大值，避免把“30分钟”误写成 `30 kcal` 或 `0 kcal`。
- `2026-04-08`: 运动热量估算改为「思考过程 + 千卡」结构化 JSON（`reasoning` + `calories_kcal`），不再要求模型只吐单个数字；思考过程落库字段 `user_exercise_logs.ai_reasoning`（需执行 `backend/sql/add_exercise_ai_reasoning.sql`），任务结果与试算接口同步返回 `reasoning`。
- `2026-04-08`: 运动热量估算必须结合用户画像快照：优先使用 `user_weight_records` 最近体重，没有则回退 `weapp_user.weight`；并一并透传 `height / gender / birthday(age) / activity_level / bmr / tdee`。异步任务在提交时将该快照写入 `analysis_tasks.payload.profile_snapshot`，worker 执行时优先使用该快照，缺字段再回源补齐。
- `2026-04-08`: 本地联调运动任务时，不能继续直接投递共享主队列 `task_type=exercise`，否则会被同一 Supabase 上的旧环境 worker 抢走并按旧逻辑处理。当前本地口径是开启 `FOOD_DEBUG_TASK_QUEUE=1` 后，将 `POST /api/exercise-logs` 直接投递到 `food_text_debug + payload.exercise=true`，由本地 debug worker 内部转到 `process_one_exercise_task`。
- `2026-04-10`: 运动热量估算在 `gemini-3-flash-preview + Instructor` 组合下，遇到“高强度动作描述 + 完整画像快照”时可能因 reasoning token 膨胀触发 `max_tokens length limit`。正式口径改为：保留 Instructor 结构化主链路，但若命中“输出被截断”，必须自动降级到“短 JSON fallback”再次估算；同时主提示词与 schema 需强约束 reasoning 只保留 1-2 句短依据，避免长推导再次撑爆。
- `2026-04-10`: 对于“一条文本里包含多项运动”的描述，后端应自动按换行/分号/句号拆分为多个分项，再逐项估算后求和，不要求用户手动拆条。分项估算优先走短 JSON / 数字输出的轻链路；若单项仍拿不到可解析结果，则允许退化到基于 `运动关键词 + 时长 + 体重` 的规则估算，目标优先保证“不报错、能落结果”。

- `2026-03-27`: Added persistent state files so `food_link` context survives session resets and compaction better.
- `2026-03-27`: Project ownership must come from `IDENTITY.md` plus state files, not stale transcript memory.
- `2026-03-27`: Durable requirements, blockers, and handoffs must be written to files instead of relying on chat history alone.
- `2026-03-27`: Pure text analysis must clear both `analyzeImagePath` and `analyzeImagePaths`, and result-page logic must trust explicit task type over stale image storage.
- `2026-03-27`: When a food record has no user-provided real image, UI should display the product logo instead of reusing any previous meal photo.
- `2026-03-27`: Keep backward-compatible API aliases in `src/utils/api.ts` when page code still imports old names (e.g. `friendRemove` -> `friendDelete`) to avoid build breaks during incremental refactor.
- `2026-03-27`: For friend-invite APIs, keep legacy login compatibility function `requestFriendByInviteCode` and map status `request_sent -> requested` until login page fully migrates.
- `2026-03-27`: In mini-program runtime code, never access `process.env` directly at module top-level; always guard with `typeof process !== 'undefined'` (or equivalent) to avoid `ReferenceError: process is not defined`.
- `2026-03-27`: In `result` page correction flow, avoid re-declaring identifiers that shadow state names inside async callbacks (e.g. `taskType`), to prevent TDZ runtime errors like `Cannot access 'taskType2' before initialization`.
- `2026-03-27`: For pages/components that hit ambiguous hook-binding runtime errors in Taro mini-program builds, prefer explicit `React.useState/useEffect/useCallback` and named lifecycle hook imports like `useDidShow` over mixed shorthand/default-namespace patterns.
- `2026-03-28`: Text-mode secondary correction must preserve the original text input and send correction instructions as structured context; when correction instructions conflict with original text, backend prompt should prioritize the correction context.
- `2026-03-28`: For secondary correction flows where the user explicitly confirms food weights, the final displayed result must respect those confirmed weights even if the model re-estimates them differently; use prompt constraints plus client-side post-processing as a safeguard.
- `2026-03-28`: Text-mode second-pass correction should be treated as a true re-analysis over four context sources: original input, previous output, structured correction list, and latest free-text note. Latest free-text clarification should be able to override earlier rounds; avoid hard client-side overwrites that suppress newer feedback.
- `2026-03-28`: In text mode, direct edits on the result page are the primary structured baseline. The secondary-correction drawer should mainly collect explanatory text about why the previous analysis was wrong and how to reinterpret it, rather than asking the user to re-edit the same weights there.
- `2026-03-28`: 二次纠错必须按模式拆分：图片记录模式以结构化纠错清单为主输入（并保留原图+首轮结果）；文字记录模式以补充说明文本为主输入，弹窗列表仅参考。
- `2026-03-28`: 图片记录模式新增后端强约束兜底：若模型未遵守纠错清单克重，按纠错清单回写 `estimatedWeightGrams` 并按比例缩放营养，避免"二次纠错后结果不变"。
- `2026-03-28`: 精准模式不再只是提示词差异；分析结果统一新增 `recognitionOutcome`、`rejectionReason`、`retakeGuidance`、`allowedFoodCategory`，由后端在严格模式下做 hard/soft reject 后校验，前端结果页和历史页按结构化状态展示。
- `2026-03-28`: 文字异步分析任务的 `execution_mode` 必须和图片任务一样做"请求优先、档案回退"的统一合并，避免未传模式时默认掉回 `standard`。
- `2026-03-29`: 结果页的"上传公共库"必须是独立入口，点击后应直接进入公共库上传页并沿用当前拍照分析结果作为草稿；不要先走"记录餐次/保存记录"链路，也不要在"记录"成功后再弹上传提醒。
