# 📊 Food Link 开发日志

> 简洁记录项目的所有修改，类似 Git commit 日志

---

## 2026-04-07

- 🎨 style: 从合并前提交恢复下午已调好的界面：首页/统计/分析中/记录相关样式与布局，iconfont 与 `index` 组件；`index.tsx` 保留 `HomeFoodExpiry*` 与身体指标缓存迁移，快到期入口改为 `pages/expiry`；`app.config.ts`/`app.scss` 保持与远端合并后的白边修复与路由 `src/pages/index/` `src/pages/stats/` `src/pages/analyze-loading/` `src/pages/record*` `src/assets/iconfont/`
- 🐛 fix: 进一步消除多页左侧 1px 白线：`page` 使用对称负边距与 `calc(100% + 2px)` 扩展宽度盖住亚像素缝；`page > view` 全宽约束 `src/app.scss`
- 🎨 style: 首页「食物保质期」去掉顶部提醒条；外层取消独立白底外框；每条记录白底圆角阴影与「今日餐食」条目一致 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- ✨ feat: 首页接入「食物保质期」区块：展示 dashboard 返回的待吃完条目与摘要、空态引导 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🐛 fix: 缓解多数页面左侧细白线：统一 `window.backgroundColor` 与 page 背景；page 增加 `overflow-x: hidden`；全屏/表单根容器将 `100vw` 改为 `100%` 避免亚像素溢出 `src/app.config.ts` `src/app.scss` `src/pages/record/index.scss` `src/pages/analyze-loading/index.scss` `src/pages/record-text/index.scss` `src/pages/record-manual/index.scss`
- 🐛 fix: 食物保质期：`/api/expiry/dashboard` 与 `/api/expiry/items` 按 `user_food_expiry_items` 序列化；新增 `POST /api/food-expiry/{id}/restore`；`pages/expiry` 改用待吃完/已吃完列表与恢复接口，修复误用 PUT 仅传 `status` 导致 422 `backend/main.py` `backend/database.py` `src/utils/api.ts` `src/pages/expiry/index.tsx`
- 🎨 style: 分析中页取景框与摄影页统一为 640rpx、四角 150rpx/80rpx 圆角/10rpx 边线与扫描线动画；修正层级顺序并去掉内容区灰底模糊 `src/pages/analyze-loading/index.scss` `src/pages/analyze-loading/index.tsx` `src/pages/record/index.scss`
- 🎨 style: 分析中页：全屏与扫描框均使用刚拍/选的本地图；去掉白雾遮罩；底部渐变衬托中文文案；分析步骤与小贴士去卡片化；步骤与健康贴士文案中文化 `src/pages/analyze-loading/index.tsx` `src/pages/analyze-loading/index.scss`
- 🐛 fix: 提交分析任务跳转 loading 前写回 `analyzeImagePath`，避免分析页清空 storage 后 loading 无图 `src/pages/analyze/index.tsx`
- 🐛 fix: 首页记录菜单「拍照识别」改用 `switchTab` 进入 tabBar 拍照页，并去掉四项英文副标题 `src/pages/index/components/RecordMenu.tsx` `src/pages/record-menu/index.tsx`
- 🐛 fix: 统计页体重趋势：扩大身体指标查询窗口；`recorded_on` 错年时用创建日或平移到当前年；按日 LOCF 生成 `weight_trend_daily`；喝水聚合同步使用规范化日期 `backend/main.py` `src/utils/api.ts` `src/pages/stats/index.tsx`
- 🐛 fix: 修复分析页喝水/体重趋势与首页不一致：首页日期曾用 2025 展示但身体指标接口未做年与 dashboard 相同的映射，导致写入 `recorded_on` 错年、统计周聚合为 0；改为首页使用真实日历日、API 统一 `mapCalendarDateToApi`，并迁移本机今日身体指标缓存键 `src/pages/index/index.tsx` `src/utils/api.ts` `src/pages/stats/index.tsx`
- 🔧 chore: `dev:backend` 改为使用 `backend/venv` 解释器，避免系统 Python 缺少 FastAPI 导致启动失败 `package.json`
- 🎨 style: 优化日期选择器选中项样式，胶囊背景改为主题绿色，中间日期小球改为黑色 `src/pages/index/index.scss`
- 🎨 style: 去除首页日期选择器外容器的背景色、圆角和 padding，使其与页面背景融合 `src/pages/index/index.scss`
- 🔧 chore: 重启前后端服务并进行微信开发者工具自动化验证，后端 PID 59751 (端口 3010)，前端编译正常 `backend/run_backend.py` `npm run dev:weapp`
- 🎨 style: 更换首页标题类名，移除不必要 margin-bottom，快到期食物改为 expiry-title，今日餐食改为 meals-title `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🎨 style: 分离快到期食物和今日餐食标题样式，新增 expiry-title 和 meals-title 类，移除 margin-bottom `src/pages/index/index.scss` `src/pages/index/index.tsx`
- 🐛 fix: 修复首页点击底部导航栏中间按钮无响应问题：改进了 custom-tab-bar 事件通知机制，当已在首页时直接通过多方案降级策略触发事件，不再依赖 switchTab 生命周期 `custom-tab-bar/index.js` `src/pages/index/index.tsx`
- 🎨 style: 优化编辑今日目标界面布局，将加减按钮移到输入框左右两侧形成水平布局，缩小各板块间距 `src/pages/index/index.scss`

## 2026-04-09

- ⏪ revert: 还原分析页面到含体重喝水数据展示、Switch控件、仪表盘餐次结构的版本 `src/pages/stats/index.tsx`

## 2026-04-08

- 🐛 fix: 修复分析页面体重喝水与其他数据（摄入趋势、营养素占比、每日缺口）无法同时正常显示的问题。体重/喝水数据使用过去365天的扩展日期范围查询，与食物记录的正常周/月范围分离，避免日期年份不匹配导致的查询失败 `backend/main.py`

## 2026-04-01

- 🐛 fix: 修复互动消息类型兜底误判，只有 `comment_rejected` 才显示"评论未通过审核"，未知类型改为中性提示，避免点赞等通知被误显示为审核失败 `src/pages/interaction-notifications/index.tsx`
- 📝 docs: 新增基于真实 Supabase 实库的 schema 分析报告，按线上真实表、字段、行数和活跃度梳理核心链路、旧表与治理建议 `docs/数据库实库Schema分析报告.md`
- 🐛 fix: 暂时移除评论审核主链路，圈子评论和公共食物库评论改为直接发布并立即展示，不再显示"已提交审核/审核中" `backend/main.py` `src/utils/api.ts` `src/pages/community/index.tsx` `src/pages/food-library-detail/index.tsx`

## 2026-03-31

- 🐛 fix: 二次纠错重构为"模型主导语义 + 显式字段锁定"，移除正则式语义理解主逻辑，新增 `nameEdited/weightEdited` 仅锁用户手改字段，避免旧清单继续压过模型结果 `src/pages/result/index.tsx` `src/utils/api.ts` `backend/worker.py`
- 🐛 fix: 二次纠错把自由文本提升为最高优先级输入，并补齐"X 说得太模糊了，这是 Y"这类口语改名解析，前后端都会把这类说明转成结构化改名 `src/pages/result/index.tsx` `backend/worker.py`
- 🐛 fix: 文字模式二次纠错改为同样下发结构化清单并在后端按用户确认结果收口，避免文字链路改名/改重量后又漂回旧结果 `src/pages/result/index.tsx` `backend/worker.py`
- 🐛 fix: 补强结果页二次纠错的自然语言改名识别，支持"X 实际上是 Y / 其实是 Y / 应该是 Y"并放宽原项匹配，避免补充说明里的改名没进结构化清单 `src/pages/result/index.tsx`
- 🐛 fix: 临时关闭食物分析每日次数限制，后端默认不再因当日配额拦截拍照/文字分析，并保留环境变量开关便于后续恢复 `backend/main.py`
- ⚡ perf: 修复微信小程序上传主包超 `2MB`，生产构建改为默认压缩且不上传 sourcemap；重新构建后 `dist` 已降到约 `1517.69 KB` `project.config.json` `config/prod.ts`
- ⚡ perf: 新增 Supabase `food-images` 批量压缩脚本，默认只对被业务引用的长期图片做 dry-run 评估，支持同 key 覆盖压缩与本地报告输出 `backend/compress_food_images.py`
- ⚡ perf: 图片压缩脚本补充 `--name` 精确处理入口，支持只压单个指定对象，方便逐张验收后再批量执行 `backend/compress_food_images.py`
- ⚡ perf: 图片压缩脚本新增 `--progress-every` 低日志模式，避免全量压缩时因逐文件输出过多导致后台终端承载异常 `backend/compress_food_images.py`
- ⚡ perf: 图片压缩脚本补充 `--offset` 分批处理能力并跳过占位对象，便于稳定地按批次推进全量压缩 `backend/compress_food_images.py`

## 2026-03-30

- ⚡ perf: 精准模式收敛为"单食物 / 可拆分混合餐 / 复杂混合餐"简化判定，只保留主体数量、遮挡程度、参照物等核心信号，减少旧版严格模式的过细规则负担 `backend/worker.py`
- 🎨 style: 分析页、结果页、历史页与档案页同步改写精准模式文案，统一成"单食物最稳、2-3 个主体可分项估、菜太多就拆拍"的用户心智 `src/pages/analyze/index.tsx` `src/pages/result/index.tsx` `src/pages/analyze-loading/index.tsx` `src/pages/analyze-history/index.tsx` `src/pages/health-profile/index.tsx` `src/pages/health-profile-edit/index.tsx` `src/pages/health-profile-view/index.tsx` `src/pages/record/index.tsx`
- 📝 docs: 补充精准模式验证样本建议，固定单食物、可拆分混合餐、复杂混合餐三组评估口径 `backend/README.md`

## 2026-03-29

- 🐛 fix: 食物分析提交接口新增主进程日志 `MODERATION_SKIPPED_CONFIRMED`，即使 worker 子进程日志不稳定也能在终端确认"该任务按无审核链路提交" `backend/main.py`
- 🐛 fix: 为已去审核的食物分析链路补充 `MODERATION_SKIPPED` 终端标记，便于从后端日志确认请求未再经过审核步骤 `backend/worker.py` `backend/main.py`
- ⚡ perf: 食物营养分析改为直接进入主模型识别，移除图片/文字分析的独立审核与同步分析中的违规判定字段，优先降低耗时和调用成本 `backend/worker.py` `backend/main.py`
- 🐛 fix: 首页三大营养素比例改为按真实超额值显示，超过目标后不再被 `100%` 截断，同时保留圆环和进度条的视觉上限保护 `src/pages/index/index.tsx`
- 🎨 style: 移除分析中页面无法反映真实状态的三步假进度，只保留加载动效、模式说明和健康小知识，避免误导用户 `src/pages/analyze-loading/index.tsx` `src/pages/analyze-loading/index.scss`
- ⚡ perf: 严格拆分标准模式与精准模式的食物分析 prompt，标准模式恢复轻量返回结构并停止附带精准判定字段，降低异步识别成本 `backend/worker.py`
- ✨ feat: 社区评论初版补齐审核状态闭环、单层回复、互动消息入口与未读逻辑，并新增评论权限校验和真实评论数返回 `src/pages/community/index.tsx` `src/pages/interaction-notifications/index.tsx` `src/utils/api.ts` `backend/main.py` `backend/database.py` `backend/worker.py`
- 🐛 fix: 修复评论相关初始化 SQL 对老库不兼容的问题，`feed_comments` 和 `comment_tasks` 改为先建表再 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` 补列，避免旧表缺字段时建索引直接报错 `backend/database/feed_likes_comments.sql` `backend/database/comment_tasks.sql`

## 2026-03-28

- ✨ feat: 精准模式升级为受约束执行模式，新增结构化结果状态 `recognitionOutcome/rejectionReason/retakeGuidance/allowedFoodCategory`，支持精准通过、软拒绝、硬拒绝三类结果 `src/utils/api.ts` `backend/main.py` `backend/worker.py`
- 🐛 fix: 文字异步分析提交补齐 `execution_mode` 的档案回退逻辑，避免图片和文字任务在未显式传模式时行为不一致 `backend/main.py`
- 🎨 style: 结果页新增精准模式状态卡与硬/软拒绝交互，历史页新增"精准通过 / 不建议执行 / 需重拍"标签，分析页文案改为受约束执行模式 `src/pages/result/index.tsx` `src/pages/result/index.scss` `src/pages/analyze-history/index.tsx` `src/pages/analyze-history/index.scss` `src/pages/analyze/index.tsx`

## 2026-03-21

- 📝 docs: 新增数据库分析报告，基于仓库内 SQL 与后端数据访问层梳理表结构、业务链路和结构风险 `docs/数据库分析报告.md`
- 🎨 style: 我的页入口统一改为"饮食记录"，统计页改成"饮食记录"整合页并将顶部热图重做为更干净的红蓝灰日历图，直观显示每天吃多/吃少/未记录 `src/pages/profile/index.tsx` `src/pages/profile/index.scss` `src/pages/stats/index.tsx` `src/pages/stats/index.scss` `src/pages/stats/index.config.ts`
- 🎨 style: 目标编辑弹窗新增"按热量自动校准"实时提示，展示当前宏量换算热量与是否需要保存时自动校准，降低用户心算负担 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🐛 fix: 目标保存改为"以热量为准自动校准宏量营养素"，不再要求用户手动满足 4/4/9；保存成功提示是否自动校准 `src/pages/index/index.tsx`
- 🐛 fix: 首页目标编辑新增热量-三大营养素联动与一致性约束：调整总热量时宏量按比例变化，调整任一宏量时总热量按 4/4/9 自动更新并在保存前校验关系 `src/pages/index/index.tsx`
- ✨ feat: 分享记录海报新增"昵称+扫码加好友"引导，支持邀请码直加好友；未注册用户扫码后先登录并自动建立好友关系 `src/pages/record-detail/index.tsx` `src/pages/record-detail/index.scss` `src/utils/poster.ts` `src/utils/api.ts` `src/pages/login/index.tsx` `src/app.ts` `backend/main.py` `backend/database.py`
- ✨ feat: 将历史记录明确为按天回看的饮食档案，在"我的"页新增长期入口，并在统计页加入记录热图与跳转当日明细联动 `src/pages/profile/index.tsx` `src/pages/profile/index.scss` `src/pages/stats/index.tsx` `src/pages/stats/index.scss` `src/pages/record/index.tsx` `src/pages/record/index.scss` `backend/main.py`
- 🐛 fix: 隐藏记录页与首页主入口中的"历史记录"并统一饮食记录按东八区自然日查询，修复凌晨时首页/历史页错天、漏餐和时间显示异常 `src/pages/index/index.tsx` `src/pages/index/index.scss` `src/pages/record/index.tsx` `src/pages/record/index.scss` `backend/main.py` `backend/database.py`

## 2026-03-20

- 🎨 style: 首页三大营养素改为三个紧凑环形图（conic 饼图式达成度），去掉营养结构标题与说明文案 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- ✨ feat: 拍照识别结果保存后新增"顺手上传公共食物库"流程，自动带入刚识别的记录并只需补充商家/位置/是否自制等信息 `src/pages/result/index.tsx` `src/pages/food-library-share/index.tsx` `src/pages/food-library-share/index.scss`
- 🐛 fix: 拍照识别页「文字补充」放在照片区域下方，拍完再补充上下文 `src/pages/analyze/index.tsx`
- 🐛 fix: 修复开发者工具下图片临时路径 `http://tmp/...` 导致 `readFile` 失败的问题：拍照页改用 `chooseImage`，并在 `imageToBase64` 中增加临时路径归一化与兜底校验 `src/pages/analyze/index.tsx` `src/utils/api.ts`
- 🐛 fix: 进一步修复开发者工具临时文件偶发失效：`imageToBase64` 改为多候选路径读取（原路径、downloadFile、getImageInfo 回填路径）逐个兜底，避免 `wxfile://tmp/... no such file` `src/utils/api.ts`
- ✨ feat: 文字记录页新增"快速带入"来源选择：支持直接从历史记录或公共食物库选条目，一键进入与拍照识别相同的结果编辑页（可改食物/重量/比例后再保存） `src/pages/record/index.tsx` `src/pages/record/index.scss`
- ✨ feat: 首页支持编辑每日热量与蛋白质/碳水/脂肪目标，配置持久化到用户健康档案 JSON，并新增营养结构可视化与目标达成进度展示 `backend/main.py` `src/utils/api.ts` `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🔧 refactor: 摄入目标保存兼容线上旧后端：独立接口 404 时回退 PUT 健康档案并合并 `dashboard_targets`，仍无法落库则本机暂存 `src/utils/api.ts` `src/pages/index/index.tsx` `backend/main.py`

## 2026-03-17

- 📝 docs: 更新 README，说明推送 GitHub `main` 分支后由 GitHub Actions 自动触发服务器拉取代码并部署后端 `README.md`
- 📝 docs: 在 README 中补充服务器上手动部署后端步骤，包含创建虚拟环境、安装依赖并在项目根目录执行 `python backend/run_backend.py` 的示例命令 `README.md`

## 2026-03-16

- 📝 docs: 简化 README，移除 Supabase 初始化建表 SQL 示例，统一后端启动命令为 python run_backend.py，并将默认后端端口更新为 3010 `README.md`

## 2026-03-12

- ✨ feat: 数据统计页 AI 营养洞察架构优化：统计接口仅返回数据+缓存结果，新增生成/保存洞察的独立接口，前端首次进入时先展示统计数据，再请求大模型并以打字方式输出，打字完成后再存库，避免统计接口因大模型超时 `backend/main.py` `backend/database.py` `src/utils/api.ts` `src/pages/stats/index.tsx` `src/pages/stats/index.scss`
- 🐛 fix: 修复日均卡路里计算错误：之前用固定天数（7/30）作除数，现改为用实际有记录的天数计算 `backend/main.py`
- ✨ feat: 重构食物参数编辑弹窗：名称/营养值改为只读展示，摄入克数支持加减按钮+手动输入，比例改为滑块控件，intake↔ratio 自动联动 `src/pages/record-detail/index.tsx` `src/pages/record-detail/index.scss`
- 🎨 style: 优化圈子页面触底分页加载动效：加载中显示三点弹跳动画，空闲/到底状态用渐变分割线+文字 `src/pages/community/index.tsx` `src/pages/community/index.scss`
- 🐛 fix: 修复"已记录天数"实际按记录次数计算的 bug：Supabase 返回 ISO 8601 时间戳（T 分隔），代码用空格 split 导致每条记录被当作不同天；改用 `[:10]` 截取日期部分 `backend/main.py`
- 🐛 fix: 修复圈子页面键盘弹出时 ScrollView 跳到顶部的问题：1) 评论蒙层从条件渲染改为始终渲染+CSS切换，避免DOM增删触发原生布局重算 2) 移除程序化 focus 聚焦（改为用户点击输入框自然触发），避免原生层 focus 事件引发滚动重置 3) 移除 enhanced、添加 disableScroll、固定像素高度替代 100vh `src/pages/community/index.tsx` `src/pages/community/index.scss` `src/pages/community/index.config.ts`
- ✨ feat: 圈子页面开放给所有用户（含未登录），未登录展示公共 Feed（来自公开记录的用户），好友/评论/点赞等需登录后可用；后端新增 GET /api/community/public-feed 公共接口 `src/pages/community/index.tsx` `src/utils/api.ts` `backend/main.py` `backend/database.py`
- 🐛 fix: 修复登录成功后 navigateBack 在首页崩溃的问题，添加 safeNavigateBack 安全返回（无历史页时 switchTab 到首页） `src/pages/login/index.tsx`
- 🔒 security: 登录页增加《用户服务协议》及《隐私政策》勾选校验，未勾选无法发起登录请求，避免用户在未同意条款时登录 `src/pages/login/index.tsx` `src/pages/login/index.scss`
- ✨ feat: 记录详情页新增「修改记录」按钮，仅记录创建者可见，支持编辑食物名称、摄入量、营养参数等，后端新增 PUT /api/food-record/{record_id} 接口 `src/pages/record-detail/index.tsx` `src/pages/record-detail/index.scss` `src/utils/api.ts` `backend/main.py` `backend/database.py`
- 🐛 fix: 修复底部评论栏 focus 导致页面跳顶：延迟 300ms 聚焦（等滑入动画完成）+ adjustPosition=false 阻止原生层滚动 `src/pages/community/index.tsx`
- 🔧 refactor: 评论交互彻底重构为底部固定输入栏（类似微信朋友圈），去掉所有滚动位置计算和恢复逻辑，打开/关闭/发送评论均不影响列表滚动位置 `src/pages/community/index.tsx` `src/pages/community/index.scss`
- 🔧 refactor: 圈子页评论交互简化、更丝滑：打开评论不再滚动列表，收起评论不做任何恢复滚动，去掉 scrollIntoView/scrollTo/相关 ref `src/pages/community/index.tsx`
- 🔧 refactor: 圈子页评论改为弹层输入：点击评论弹出模态框，主列表不参与焦点与滚动 `src/pages/community/index.tsx` `src/pages/community/index.scss`
- 🐛 fix: 圈子页评论弹层打开/关闭后列表回顶：打开前与关闭前（取消/发送）均用 scrollOffset 取当前滚动位置，弹层变化后 80ms 用 scrollTo 恢复 `src/pages/community/index.tsx`
- 🐛 fix: 圈子页评论输入框聚焦时文字不可见（失焦才显示）：用不透明颜色 rgb(30,41,59)、opacity:1、caret-color，输入区用透明底+外层 wrap 做背景，避免安卓原生层渲染透明 `src/pages/community/index.tsx` `src/pages/community/index.scss`
- 🐛 fix: 登录后数据库未存手机号：登录页主按钮改为原生 Button（openType="getPhoneNumber"），授权后带 phoneCode 调用 login，后端写入 weapp_user.telephone；拒绝时仍仅用 code 登录 `src/pages/login/index.tsx` `src/pages/login/index.scss`
- ✨ feat: 若数据库已有手机号则微信一键登录不再弹授权：先仅用 code 登录，后端有 telephone 则直接返回；无手机号时登录成功后再弹「完善账号」授权手机号弹窗，可调用 POST /api/user/bind-phone 绑定 `backend/main.py` `src/utils/api.ts` `src/pages/login/index.tsx` `src/pages/login/index.scss`
- ✨ feat: 前端 token 校验：无 token 或接口返回 401/403 时清除登录态并 redirectTo 登录页，并 Toast 提示 `src/utils/api.ts`
