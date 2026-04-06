# 📊 Food Link 开发日志

> 简洁记录项目的所有修改，类似 Git commit 日志

---

## 2026-04-09

- 🎨 style: 优化首页组件间距层次：问候区16rpx→日期12rpx→热量12rpx→营养素24rpx（核心数据区紧密连接），身体状态20rpx，统计/快到期20rpx，餐食32rpx（底部呼吸感） `src/pages/index/index.scss`
- 🎨 style: 蛋白质/碳水/脂肪卡片重构：目标值「XXg」移到标题上方大字体显示，仪表盘半径扩大到40px（容器120rpx，SVG r=40，实际显示80rpx直径） `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🎨 style: 首页卡片背景色改为柔和米白：将 `$card-bg` 变量从纯白 `#fff` 改为 `#FEFEFE`，使所有组件背景更柔和护眼 `src/pages/index/index.scss`
- 🎨 style: 去除体重/喝水/运动卡片左侧图标：删除 IconTrendingUp、IconWaterDrop、IconExercise 图标组件，标题直接显示文字更简洁 `src/pages/index/index.tsx`
- 🎨 style: 首页间距层次精细调整：形成清晰视觉层次 - 问候区16rpx（紧凑顶部）、日期选择器12rpx（连接性）、主卡片16rpx+营养素20rpx（核心数据区）、身体状态20rpx、统计入口/快到期/餐食24rpx（独立区块分隔感） `src/pages/index/index.scss`
- 🎨 style: 重新设计记录菜单弹窗：顶部圆角指示条、2x2网格功能卡片（带NEW标签）、底部餐食/运动列表（带麦克风和箭头图标），仿照参考图片样式 `src/pages/index/components/RecordMenu.tsx` `src/pages/index/index.scss` `src/components/iconfont/index.tsx`
- 🎨 style: 首页间距层次优化：取消统一15rpx，改为更有层次的间距 - 问候区20rpx、日期选择器12rpx、主卡片16rpx、三大营养素20rpx，层次分明 `src/pages/index/index.scss`
- 🎨 style: 首页今日剩余卡片右上角显示改为「目前已摄入卡路里/目标设置的总卡路里」格式，如 "800/2000" `src/pages/index/index.tsx`
- ✅ test: 微信开发者工具自动化验证通过：三大营养素卡片已紧凑显示（仪表盘缩小到100rpx）、卡片间距统一15rpx、底部绿色按钮正常弹出记录菜单弹窗 `verify_home_final.png` `verify_home_4_record_menu.png`
- 🎨 style: 首页三大营养素卡片大幅紧凑化：仪表盘从 180rpx 缩小到 100rpx、卡片内边距减少、间距收紧、字体整体缩小，使组件更紧凑 `src/pages/index/index.scss`
- 🔧 refactor: 统一首页所有组件的 margin-bottom 为 15rpx，保持一致的间距规范 `src/pages/index/index.scss`
- 🐛 fix: 修复底部导航栏中间按钮点击无反应问题：首页添加 showRecordMenu 状态和 RecordMenu 组件，在 useDidShow 中检测 showRecordMenuModal 标记并显示弹窗 `src/pages/index/index.tsx` `src/pages/index/components/index.ts` `src/pages/index/index.scss`

## 2026-04-08

- 🔧 refactor: 编辑目标对话框重构：删除普通模式，仅保留精确模式；为热量/蛋白质/碳水/脂肪四个指标增加左右加减按钮；固定步长：热量100、蛋白质/碳水50、脂肪10 `src/pages/index/components/TargetEditor.tsx` `src/pages/index/types/index.ts` `src/pages/index/index.tsx`
- ✨ feat: 首页三大营养素卡片（蛋白质/碳水/脂肪）底部新增目标值显示：仿照体重卡片样式，显示"总XXg"格式，包含分隔线和数值样式 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🐛 fix: 系统中断导致样式异常，已恢复相关文件：首页样式文件、运动记录页面、分析加载页、记录页等 `src/pages/index/index.scss` `src/pages/index/index.tsx` `src/pages/exercise-record/index.scss` `src/pages/exercise-record/index.tsx` `src/pages/analyze-loading/index.scss` `src/pages/record/index.scss` `src/pages/record/index.tsx`
- 🔧 refactor: 将记录菜单从独立页面改为底部弹窗形式：点击底部绿色按钮切换到首页并触发弹窗，仿照目标编辑对话框样式从底部滑出 `src/pages/index/index.tsx` `src/pages/index/components/RecordMenu.tsx` `src/pages/index/index.scss` `custom-tab-bar/index.js`
- 🎨 style: 优化首页体重/喝水/运动卡片布局：卡片改为三等分自适应宽度（使用 `max-width: calc((100vw - 48rpx - 24rpx) / 3)`），缩小卡片内边距（20rpx 16rpx）和间距（12rpx），同步缩小字体和进度条高度，确保三卡片总宽度不超出屏幕 `src/pages/index/index.scss`
- 🎨 style: 记录菜单页面优化：移除顶部关闭按钮和标题（避免与页面导航栏标题重复），移除功能名称中的英文副标题，功能卡片图标和文字改为水平和垂直居中 `src/pages/record-menu/index.tsx` `src/pages/record-menu/index.scss` `src/pages/record-menu/index.config.ts`
- ✨ feat: 新增运动记录功能，支持用户输入运动描述（如"慢跑30分钟"），AI 自动估算消耗卡路里并保存 `src/pages/exercise-record/index.tsx` `src/pages/exercise-record/index.scss` `src/utils/api.ts`
- ✨ feat: 创建后端运动记录 API，包括获取列表、创建记录、删除记录和 AI 估算卡路里 `backend/main.py` `backend/database.py` `backend/sql/add_exercise_logs.sql`
- ✨ feat: 首页新增运动卡片，显示当日消耗卡路里，点击进入运动记录页面 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🗃️ db: 创建 user_exercise_logs 数据表，存储运动描述、消耗卡路里和记录日期 `backend/sql/add_exercise_logs.sql`
- ✅ test: 微信开发者工具自动化验证通过 - 首页运动卡片显示正常，点击跳转运动记录页面，页面 UI 完整，输入和提交功能正常

## 2026-04-07

- 🎨 style: 首页三大营养素卡片重构布局：当前摄入量放大置顶（40rpx/700weight），标签缩小（20rpx），环形图内改为百分比 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🎨 style: 首页样式综合优化：快到期食物徽章增加gap间距修复数字文字挤压问题；三大营养素标签缩小到20rpx、数字放大到40rpx加粗、仪表盘内改为彩色克数+灰色小g样式；体重喝水运动数字从36rpx放大到40rpx `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🎨 style: 修复首页体重/喝水/运动三卡片宽度溢出问题：减小间距(16rpx→12rpx)、缩小内边距(24rpx→16/12rpx)、降低字号(44→36rpx)、添加文本截断处理 `src/pages/index/index.scss`
- 🔧 refactor: 编辑目标对话框步长调整：蛋白质/碳水固定50g步长，脂肪固定10g步长，热量保持动态步长 `src/pages/index/components/TargetEditor.tsx`
- 🔧 refactor: 编辑目标对话框移除普通模式，仅保留精确模式；为每个指标增加加减按钮，智能步长调整（热量25/50/100，营养素1/2/5克） `src/pages/index/components/TargetEditor.tsx` `src/pages/index/index.scss` `src/pages/index/types/index.ts` `src/pages/index/index.tsx`
- 🎨 style: 简化目标编辑器样式：去掉绿色边框高亮、去掉步长提示文字、输入框改为浅灰背景，整体更清爽简约 `src/pages/index/components/TargetEditor.tsx` `src/pages/index/index.scss`
- 🔧 revert: 回滚编辑目标对话框到滑块版本，恢复 Slider 组件和 CalorieWavePool 波浪池预览 `src/pages/index/components/TargetEditor.tsx` `src/pages/index/index.scss`
- 🎨 style: 优化编辑目标对话框：波块选择器改为横向左右滑动（ScrollView 实现），去除所有图标，布局改为紧凑单行样式（标签+数值在左，选择器在右），对话框支持内部滚动 `src/pages/index/components/TargetEditor.tsx` `src/components/HorizontalWheelPicker/` `src/pages/index/index.scss`
- 🎨 style: 重构编辑目标对话框UI，移除三个滑块和卡路里水池，改用横向波块滚轮选择器（仿 AgePicker 设计），第一个为总热量（800-4000kcal），后为蛋白质/碳水/脂肪三档 `src/pages/index/components/TargetEditor.tsx` `src/components/HorizontalWheelPicker/` `src/pages/index/index.scss`
- 🐛 fix: 修复食物保质期"创建提醒"报错问题，统一使用旧版 API 结构（`/api/food-expiry`），字段映射：storage_type -> storage_location, quantity_note -> quantity_text, expire_date -> deadline_date, 移除不支持的数据库字段 `src/pages/expiry-edit/index.tsx` `src/utils/api.ts`
- 🎨 style: 首页蛋白质/碳水/脂肪卡片顶部显示目标值（40rpx黑色加粗左对齐），标签文字黑色无图标 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🎨 style: 首页体重/喝水/运动卡片去除图标，简化header布局 `src/pages/index/index.tsx` `src/pages/index/index.scss`

## 2026-04-06

- 🎨 style: 替换拍照页相册按钮的 iconfont 图标为 SVG 图片，使用 Image 组件引用本地文件，保持 82rpx 尺寸和白色阴影效果 `src/pages/record/index.tsx` `src/pages/record/index.scss` `src/assets/icons/album.svg`
- 🎨 style: 分析页面去掉配额提示条左侧的表情图标 `src/pages/analyze/index.tsx`
- 🔧 refactor: 后端默认启用拍照分析每日次数限制，修复显示 --/-- 问题 `backend/main.py`
- ✨ feat: 开发者模式添加调试按钮，支持模拟数据直接进入结果页或分析 Loading 页调试样式（长按页面任意位置启用） `src/pages/analyze/index.tsx` `src/pages/analyze/index.scss` `src/pages/analyze-loading/index.tsx` `src/pages/analyze-loading/index.scss`
- 🎨 style: 重新设计分析 Loading 页面UI，全屏背景图+白色半透明高斯模糊，扫描框显示清晰图片，进度列表浮在模糊层上 `src/pages/analyze-loading/index.tsx` `src/pages/analyze-loading/index.scss`
- 🎨 style: 分析 Loading 页去除调试标签，健康知识改为游戏TIPS风格放在扫描框下方，带淡入淡出动画 `src/pages/analyze-loading/index.tsx` `src/pages/analyze-loading/index.scss`
- 🎨 style: 重新设计结果页顶部区域，使用扫描框样式展示图片，高斯模糊白色半透明背景，框外显示分析状态文字 `src/pages/result/index.tsx` `src/pages/result/index.scss`
- 🐛 fix: 修复分析 Loading 页面的 Taro 导入路径 `@taro` -> `@tarojs/taro`，解决构建报错 `src/pages/analyze-loading/index.tsx`

## 2026-04-01

- 🐛 fix: 修复互动消息类型兜底误判，只有 `comment_rejected` 才显示“评论未通过审核”，未知类型改为中性提示，避免点赞等通知被误显示为审核失败 `src/pages/interaction-notifications/index.tsx`
- 📝 docs: 新增基于真实 Supabase 实库的 schema 分析报告，按线上真实表、字段、行数和活跃度梳理核心链路、旧表与治理建议 `docs/数据库实库Schema分析报告.md`
- 🐛 fix: 暂时移除评论审核主链路，圈子评论和公共食物库评论改为直接发布并立即展示，不再显示“已提交审核/审核中” `backend/main.py` `src/utils/api.ts` `src/pages/community/index.tsx` `src/pages/food-library-detail/index.tsx`

## 2026-03-31

- 🐛 fix: 二次纠错重构为“模型主导语义 + 显式字段锁定”，移除正则式语义理解主逻辑，新增 `nameEdited/weightEdited` 仅锁用户手改字段，避免旧清单继续压过模型结果 `src/pages/result/index.tsx` `src/utils/api.ts` `backend/worker.py`
- 🐛 fix: 二次纠错把自由文本提升为最高优先级输入，并补齐“X 说得太模糊了，这是 Y”这类口语改名解析，前后端都会把这类说明转成结构化改名 `src/pages/result/index.tsx` `backend/worker.py`
- 🐛 fix: 文字模式二次纠错改为同样下发结构化清单并在后端按用户确认结果收口，避免文字链路改名/改重量后又漂回旧结果 `src/pages/result/index.tsx` `backend/worker.py`
- 🐛 fix: 补强结果页二次纠错的自然语言改名识别，支持“X 实际上是 Y / 其实是 Y / 应该是 Y”并放宽原项匹配，避免补充说明里的改名没进结构化清单 `src/pages/result/index.tsx`
- 🐛 fix: 临时关闭食物分析每日次数限制，后端默认不再因当日配额拦截拍照/文字分析，并保留环境变量开关便于后续恢复 `backend/main.py`
- ⚡ perf: 修复微信小程序上传主包超 `2MB`，生产构建改为默认压缩且不上传 sourcemap；重新构建后 `dist` 已降到约 `1517.69 KB` `project.config.json` `config/prod.ts`
- ⚡ perf: 新增 Supabase `food-images` 批量压缩脚本，默认只对被业务引用的长期图片做 dry-run 评估，支持同 key 覆盖压缩与本地报告输出 `backend/compress_food_images.py`
- ⚡ perf: 图片压缩脚本补充 `--name` 精确处理入口，支持只压单个指定对象，方便逐张验收后再批量执行 `backend/compress_food_images.py`
- ⚡ perf: 图片压缩脚本新增 `--progress-every` 低日志模式，避免全量压缩时因逐文件输出过多导致后台终端承载异常 `backend/compress_food_images.py`
- ⚡ perf: 图片压缩脚本补充 `--offset` 分批处理能力并跳过占位对象，便于稳定地按批次推进全量压缩 `backend/compress_food_images.py`

## 2026-03-30

- ⚡ perf: 精准模式收敛为“单食物 / 可拆分混合餐 / 复杂混合餐”简化判定，只保留主体数量、遮挡程度、参照物等核心信号，减少旧版严格模式的过细规则负担 `backend/worker.py`
- 🎨 style: 分析页、结果页、历史页与档案页同步改写精准模式文案，统一成“单食物最稳、2-3 个主体可分项估、菜太多就拆拍”的用户心智 `src/pages/analyze/index.tsx` `src/pages/result/index.tsx` `src/pages/analyze-loading/index.tsx` `src/pages/analyze-history/index.tsx` `src/pages/health-profile/index.tsx` `src/pages/health-profile-edit/index.tsx` `src/pages/health-profile-view/index.tsx` `src/pages/record/index.tsx`
- 📝 docs: 补充精准模式验证样本建议，固定单食物、可拆分混合餐、复杂混合餐三组评估口径 `backend/README.md`

## 2026-03-29

- 🐛 fix: 食物分析提交接口新增主进程日志 `MODERATION_SKIPPED_CONFIRMED`，即使 worker 子进程日志不稳定也能在终端确认“该任务按无审核链路提交” `backend/main.py`
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
- 🎨 style: 结果页新增精准模式状态卡与硬/软拒绝交互，历史页新增“精准通过 / 不建议执行 / 需重拍”标签，分析页文案改为受约束执行模式 `src/pages/result/index.tsx` `src/pages/result/index.scss` `src/pages/analyze-history/index.tsx` `src/pages/analyze-history/index.scss` `src/pages/analyze/index.tsx`

## 2026-03-21

- 📝 docs: 新增数据库分析报告，基于仓库内 SQL 与后端数据访问层梳理表结构、业务链路和结构风险 `docs/数据库分析报告.md`
- 🎨 style: 我的页入口统一改为“饮食记录”，统计页改成“饮食记录”整合页并将顶部热图重做为更干净的红蓝灰日历图，直观显示每天吃多/吃少/未记录 `src/pages/profile/index.tsx` `src/pages/profile/index.scss` `src/pages/stats/index.tsx` `src/pages/stats/index.scss` `src/pages/stats/index.config.ts`
- 🎨 style: 目标编辑弹窗新增“按热量自动校准”实时提示，展示当前宏量换算热量与是否需要保存时自动校准，降低用户心算负担 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🐛 fix: 目标保存改为“以热量为准自动校准宏量营养素”，不再要求用户手动满足 4/4/9；保存成功提示是否自动校准 `src/pages/index/index.tsx`
- 🐛 fix: 首页目标编辑新增热量-三大营养素联动与一致性约束：调整总热量时宏量按比例变化，调整任一宏量时总热量按 4/4/9 自动更新并在保存前校验关系 `src/pages/index/index.tsx`
- ✨ feat: 分享记录海报新增“昵称+扫码加好友”引导，支持邀请码直加好友；未注册用户扫码后先登录并自动建立好友关系 `src/pages/record-detail/index.tsx` `src/pages/record-detail/index.scss` `src/utils/poster.ts` `src/utils/api.ts` `src/pages/login/index.tsx` `src/app.ts` `backend/main.py` `backend/database.py`
- ✨ feat: 将历史记录明确为按天回看的饮食档案，在“我的”页新增长期入口，并在统计页加入记录热图与跳转当日明细联动 `src/pages/profile/index.tsx` `src/pages/profile/index.scss` `src/pages/stats/index.tsx` `src/pages/stats/index.scss` `src/pages/record/index.tsx` `src/pages/record/index.scss` `backend/main.py`
- 🐛 fix: 隐藏记录页与首页主入口中的“历史记录”并统一饮食记录按东八区自然日查询，修复凌晨时首页/历史页错天、漏餐和时间显示异常 `src/pages/index/index.tsx` `src/pages/index/index.scss` `src/pages/record/index.tsx` `src/pages/record/index.scss` `backend/main.py` `backend/database.py`

## 2026-03-20

- 🎨 style: 首页三大营养素改为三个紧凑环形图（conic 饼图式达成度），去掉营养结构标题与说明文案 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- ✨ feat: 拍照识别结果保存后新增“顺手上传公共食物库”流程，自动带入刚识别的记录并只需补充商家/位置/是否自制等信息 `src/pages/result/index.tsx` `src/pages/food-library-share/index.tsx` `src/pages/food-library-share/index.scss`
- 🐛 fix: 拍照识别页「文字补充」放在照片区域下方，拍完再补充上下文 `src/pages/analyze/index.tsx`
- 🐛 fix: 修复开发者工具下图片临时路径 `http://tmp/...` 导致 `readFile` 失败的问题：拍照页改用 `chooseImage`，并在 `imageToBase64` 中增加临时路径归一化与兜底校验 `src/pages/analyze/index.tsx` `src/utils/api.ts`
- 🐛 fix: 进一步修复开发者工具临时文件偶发失效：`imageToBase64` 改为多候选路径读取（原路径、downloadFile、getImageInfo 回填路径）逐个兜底，避免 `wxfile://tmp/... no such file` `src/utils/api.ts`
- ✨ feat: 文字记录页新增“快速带入”来源选择：支持直接从历史记录或公共食物库选条目，一键进入与拍照识别相同的结果编辑页（可改食物/重量/比例后再保存） `src/pages/record/index.tsx` `src/pages/record/index.scss`
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

## 2026-03-10

- 🐛 fix: 圈子页点击评论再点别处收起后仍跳顶：改为延迟 120ms 再设 scrollTop 恢复（等键盘收起+布局稳定），720ms 后释放 `src/pages/community/index.tsx`
- 🐛 fix: 圈子页收起评论后跳顶：收起时保存滚动位置并用 scrollTop 短暂恢复 300ms，避免列表重排导致 ScrollView 重置 `src/pages/community/index.tsx`
- 🐛 fix: 圈子页评论栏改为页面底部流式布局（非 fixed），解决键盘弹起后看不到输入框、占位顶到顶端的问题 `src/pages/community/index.scss`
- ✨ feat: 圈子页点击评论后直接弹出键盘，底部固定输入栏紧贴键盘上方（类似朋友圈），无需再点输入框 `src/pages/community/index.tsx`
- 🐛 fix: 圈子页内联评论聚焦键盘后跳顶、占位到顶端：关闭 Input adjustPosition，点击评论时用 scroll-into-view 把该帖滚到顶部并设大 cursorSpacing，避免系统自动滚动导致跳顶 `src/pages/community/index.tsx`
- ✨ feat: 圈子页评论改为帖子下方内联输入框，点击评论后输入框出现在该帖下方，点输入框弹出键盘时帖子自然保持在键盘正上方可见 `src/pages/community/index.tsx` `src/pages/community/index.scss`
- 🐛 fix: 圈子页评论时键盘挡住帖子：改为 scroll-top + createSelectorQuery 在键盘弹起后计算目标滚动位置并滚动，使被评论帖子出现在键盘上方 `src/pages/community/index.tsx`
- ⚡ perf: 圈子页列表滑动卡顿：ScrollView 仅在打开评论时临时受控 scrollTop，滚动后清空，不再在每次 onScroll 时 setState `src/pages/community/index.tsx`
- 🐛 fix: 圈子页点击评论输入框跳回顶部：去掉受控 scrollTop，改用 scroll-into-view 并在键盘弹起后延迟 480ms 触发，清空时不会重置列表位置 `src/pages/community/index.tsx`
- ✨ feat: 记录页历史记录支持删除：卡片右侧弱化删除图标，先 ActionSheet 再二次确认后调用删除接口并刷新列表 `src/pages/record/index.tsx` `src/utils/api.ts` `backend/main.py` `backend/database.py`
- 🐛 fix: 数据统计页餐次结构百分比改为保留一位小数，避免整数四舍五入导致数据不准确 `src/pages/stats/index.tsx`
- ✨ feat: 食物库分享页商家地址搜索改为跳转新页面，进入即定位并使用天地图周边模糊搜索，选中后回填地址与经纬度 `src/pages/food-library-share/index.tsx` `src/pages/location-search/index.tsx` `backend/main.py` `src/app.config.ts`
- ✨ feat: 位置选择页改为天地图地图选点：全屏 web-view 嵌入地图，支持点击取点（自动逆地理）、模糊搜索后地图自动定位到结果并选点，确认后回传 `backend/main.py` `src/pages/location-search/index.tsx` 新增 `GET /map-picker`、`POST /api/location/reverse`
- 🐛 fix: 位置选择页不展示地图/无法搜索：改为小程序原生 Map+搜索列表，不依赖 web-view，进入即定位、点击地图取点（逆地理）、关键字搜索（天地图）后点结果地图定位并选点 `src/pages/location-search/index.tsx` `src/pages/location-search/index.scss`

## 2026-02-17

- 🔧 refactor: 食物库分享页去掉「获取当前位置」功能，保留搜索地址与城市/详细地址填写 `src/pages/food-library-share/index.tsx`
- ✨ feat: 个人中心页首次登录未填写健康档案时自动跳转到答题页（pages/health-profile/index） `src/pages/profile/index.tsx`
- 🔧 refactor: 分析页去掉模型对比；食物分析（图片/文字）统一使用 OpenRouter Gemini，图片/评论/内容审核继续使用千问 `src/pages/analyze/index.tsx` `src/pages/analyze/index.scss` `src/pages/result/index.tsx` `backend/main.py` `backend/worker.py`
- 🎨 style: 关于页仅保留「官方邮箱」一项，移除用户协议、隐私政策、官方微信、联系客服；点击邮箱可复制 `src/pages/about/index.tsx` `src/pages/about/index.scss`
- ⚡ perf: 登录优化：若用户库中已存手机号则不再要求授权手机号，仅用 code 即可登录；后端在仅 code 登录时从库中带回 telephone 至响应，前端主按钮改为「微信一键登录」仅发 code，可选「授权手机号登录」供新用户绑定 `backend/main.py` `src/pages/login/index.tsx` `src/pages/login/index.scss`
- 🎨 style: 圈子页与食物库页顶部「下拉刷新」分割线去掉绿色背景，改为无背景 `src/pages/community/index.scss` `src/pages/food-library/index.scss`
- 🎨 style: 圈子页与食物库页顶部增加「下拉刷新」分割线提示（Taroify Divider），并补充对应样式 `src/pages/community/index.tsx` `src/pages/food-library/index.tsx` `src/pages/community/index.scss` `src/pages/food-library/index.scss`
- 🎨 style: 健康档案编辑页性别选项改为 iconfont 图标（男 icon-nannv-nan，女 icon-nannv-nv） `src/pages/health-profile-edit/index.tsx`
- 🔧 refactor: 食物库分享页商家名称改为可选，移除必填校验与表单项星号，提交时空值传 undefined `src/pages/food-library-share/index.tsx`
- ✨ feat: 食物库分享页保存前弹窗确认「确定要将该食物分享到公共食物库吗？」，用户确认后再提交 `src/pages/food-library-share/index.tsx`

## 2026-02-16

- 🐛 fix: 健康档案编辑页既往病史默认选中「无」；拉取档案无病史时也设为「无」 `src/pages/health-profile-edit/index.tsx`
- 🎨 style: 健康档案编辑页体检报告上传区与底部按钮右侧被遮挡：上传区/占位文案/提示/底部栏与保存按钮加 max-width、box-sizing，底部栏预留左右安全区 `src/pages/health-profile-edit/index.scss`
- 🎨 style: 健康档案编辑页防止内容超出右侧屏幕：页面与区块 box-sizing/max-width/overflow，选项与标签 min-width:0、文字省略，尺子外层容器限制宽度 `src/pages/health-profile-edit/index.tsx` `src/pages/health-profile-edit/index.scss`
- ✨ feat: 分享到公共库提交成功后返回食物库列表页时自动刷新列表（storage 标记 + useDidShow 强制刷新） `src/pages/food-library-share/index.tsx` `src/pages/food-library/index.tsx`
- ✨ feat: 食物库分享页上传的图片支持点击全屏预览（Taro.previewImage） `src/pages/food-library-share/index.tsx`
- ✨ feat: 公共食物库详情页多图时展示当前张数/总张数（如 2/5），位于图片区域右下角 `src/pages/food-library-detail/index.tsx` `src/pages/food-library-detail/index.scss`
- 🐛 fix: 食物库分享页从记录选择时支持多图导入：前端优先使用 record.image_paths 并限制最多 3 张；记录列表接口对含 source_task_id 且无 image_paths 的记录从 analysis_tasks 补全 image_paths `src/pages/food-library-share/index.tsx` `backend/main.py` `backend/database.py`
- 🎨 style: 数据统计页「摄入趋势」卡片标题图标改为 icon-shangzhang `src/pages/stats/index.tsx`
- ✨ feat: 数据统计页切换近一周/近一月时显示「加载中」并禁用切换，防止重复请求 `src/pages/stats/index.tsx` `src/pages/stats/index.scss`
- 🐛 fix: 修复数据统计页「摄入趋势」柱状图不显示：图表列使用 align-items:stretch 与 bar-wrapper flex:1+min-height:0，避免 height:100% 父高度由内容决定导致的循环依赖，柱子可正确渲染 `src/pages/stats/index.scss`
- ✨ feat: 新增健康档案编辑页面，用户修改档案时跳转到表单式编辑页（而非答题页），同时支持"重新填写"选项跳转到答题模式；健康档案查看页按钮优化为"修改档案"和"重新填写"并排显示 `src/pages/health-profile-edit/` `src/pages/health-profile-view/index.tsx` `src/app.config.ts`
- ⚡ perf: 食物库分享页多图增量识别优化：缓存每张图片的识别结果（analyzeResultsMap），上传时只识别新图片并与已有结果叠加，避免重复识别；删除时从缓存移除并重新聚合 `src/pages/food-library-share/index.tsx`
- ✨ feat: 食物库分享页多图每张单独 AI 识别并叠加计算营养：新增 runAnalyzeAndAggregate，上传/删除后对当前全部图片逐张识别并汇总热量/蛋白/碳水/脂肪与 items；上限 3 张 `src/pages/food-library-share/index.tsx` `src/pages/food-library-share/index.scss`
- ✨ feat: 食物库分享页图片上传改为最多 3 张、支持上传一张后继续添加；前端交互参考分析页（网格 + 添加/删除），选图后逐张上传、首张自动识别填充营养，后端能力保持不变 `src/pages/food-library-share/index.tsx` `src/pages/food-library-share/index.scss`
- 🎨 style: 数据统计页优化：用阿里云 iconfont 替换所有表情（热量超标/保持良好/连续记录/AI 洞察/餐次/营养素），卡片标题带图标、餐次用早午晚加餐图标与配色、加载与错误态带图标；卡片与背景视觉统一、按钮渐变与阴影 `src/pages/stats/index.tsx` `src/pages/stats/index.scss`
- ✨ feat: 公共食物库多图支持：详情页多图轮播展示；上传支持多选最多 9 张并提交 image_paths；从记录导入时后端从 analysis_tasks 拉取 image_paths 全量导入；新增 DB 迁移 image_paths 列 `backend/database/migrate_public_food_library_image_paths.sql` `backend/database.py` `backend/main.py` `src/utils/api.ts` `src/pages/food-library-detail/index.tsx` `src/pages/food-library-share/index.tsx`
- ✨ feat: 食物库页增加「收藏夹」Tab，可查看我收藏的餐食；后端新增 list_collected_public_food_library 与 GET /api/public-food-library/collections，前端 Tab 全部/收藏夹、收藏夹空态与取消收藏乐观更新 `backend/database.py` `backend/main.py` `src/utils/api.ts` `src/pages/food-library/index.tsx` `src/pages/food-library/index.scss`
- ✨ feat: 食物库详情页评论与圈子一致走异步审核：发布评论返回 task_id + temp_comment，前端乐观展示并缓存临时评论，加载评论时合并 5 分钟内未去重临时评论并展示「审核中」角标，提交成功提示改为「评论已提交审核」 `src/pages/food-library-detail/index.tsx` `src/pages/food-library-detail/index.scss`
- ✨ feat: 历史记录页日期选择改为 Taroify Calendar 日历弹层，支持单日选择、最近 6 个月范围，点击确认后刷新当日记录 `src/pages/record/index.tsx`

## 2026-02-15

- 🎨 style: 健康档案目标/活动水平选项按钮宽度修正，不超出屏幕：卡片与选项列表加 max-width/min-width/box-sizing，防止右侧被裁切 `src/pages/health-profile/index.scss`
- 🎨 style: 健康档案既往病史选项去掉表情图标，仅显示文字标签；自定义病史项同步去掉图标 `src/pages/health-profile/index.tsx`
- 🎨 style: 体重尺组件中心指示线颜色由蓝色改为绿色（#00bc7d），与主题色一致 `src/components/WeightRuler/index.scss`
- 🔧 refactor: 健康档案页去掉左右滑切换题目，仅保留「上一题/确认」按钮切换，并移除左滑下一题提示与相关样式 `src/pages/health-profile/index.tsx` `src/pages/health-profile/index.scss`
- 🎨 style: 体重尺组件移除磅单位切换，仅保留公斤显示，与项目统一使用克/公斤规范一致 `src/components/WeightRuler/index.tsx`
- 🎨 style: 个人中心默认头像改为 icon（icon-weidenglu），不再使用表情占位；默认 avatar 状态与登录页统一为空字符串 `src/pages/profile/index.tsx` `src/pages/login/index.tsx`
- 🎨 style: 个人中心未登录时不展示会员卡片，仅登录后显示注册时间与记录天数等会员信息 `src/pages/profile/index.tsx`
- 🎨 style: 放大关于页头部与底部文案字号（食探/版本号/版权），提升小程序端可读性 `src/pages/about/index.scss`
- 🎨 style: 关于页 icon 背景色与尺寸对齐登录页（浅绿色背景、160rpx 尺寸、32rpx 圆角），统一品牌图标视觉规范 `src/pages/about/index.scss`
- 🎨 style: 登录页品牌图标由本地 `logo.png` 改为远程 URL 引入，统一关于页与登录页视觉资源 `src/pages/login/index.tsx`
- 🎨 style: 关于页头部图标由本地图标组件改为远程透明底品牌图标 URL，统一品牌视觉 `src/pages/about/index.tsx` `src/pages/about/index.scss`
- ✨ feat: 登录成功后获取并缓存用户注册时间，个人中心会员卡改为展示“注册时间 YYYY-MM-DD”并支持本地兜底读取 `src/pages/login/index.tsx` `src/pages/profile/index.tsx`
- 🎨 style: 个人中心记录提示文案改为展示累计记录天数（“您已在食探记录了 X 天”），去除会员升级倒计时表达 `src/pages/profile/index.tsx`
- 🐛 fix: 修复结果页保存流程报错，移除无效的本地详情缓存构造逻辑并统一为 `saveRecord` 保存函数，保存后直接按记录 ID 跳转详情 `src/pages/result/index.tsx`
- 🎨 style: 调整公共食物库详情页底部操作区：点赞/收藏改为纯图标样式（无独立背景框），评论按钮加长突出主操作 `src/pages/food-library-detail/index.tsx` `src/pages/food-library-detail/index.scss`
- 🎨 style: 底部三按钮升级为轻玻璃 iOS 风格，优化模糊质感、按钮圆角与按压反馈，整体更轻盈细腻 `src/pages/food-library-detail/index.scss`
- 🎨 style: 优化公共食物库详情页底部三个操作按钮样式，统一间距与圆角层级，补齐收藏按钮激活态并增强评论主按钮视觉 `src/pages/food-library-detail/index.scss`
- 🔧 refactor: 记录页历史模块精简为仅保留“历史记录”，移除无效编辑/删除占位操作，并按所选日期二次过滤后展示对应记录内容 `src/pages/record/index.tsx`
- 🐛 fix: 修复记录详情页海报功能报错，移除未接入完成的模板选择残留代码并恢复稳定绘制流程 `src/pages/record-detail/index.tsx`
- 🎨 style: 调整关于页“关于食探/特别鸣谢”标题与正文字号为 `rpx` 并放大，提升文案可读性 `src/pages/about/index.scss`
- 🎨 style: 放大食物库页面介绍文案字号，统一列表与详情的可读性（介绍内容不再过小） `src/pages/food-library/index.scss` `src/pages/food-library-detail/index.scss`
- 🎨 style: 图标字体默认字号单位统一为 `rpx`，将 `iconfont.css` 中默认 `font-size` 从 `px` 调整为 `rpx` `src/assets/iconfont/iconfont.css`
- 🐛 fix: 临时评论用户信息读取优先使用 `userInfo.name` 与 `userInfo.avatar`，与当前本地存储结构保持一致 `src/pages/community/index.tsx` `src/pages/food-library-detail/index.tsx`
- 🐛 fix: 修复临时评论昵称兜底读取错误，兼容从本地 `userInfo` 的 `name/nickname` 取值，避免评论展示为“用户” `src/pages/community/index.tsx` `src/pages/food-library-detail/index.tsx`
- 🐛 fix: 修复评论临时缓存展示与刷新覆盖问题：本地临时评论优先使用真实头像和昵称，社区页新评论改为插入列表前部；页面刷新后仅展示后端返回评论并清理本地临时缓存 `src/pages/community/index.tsx` `src/pages/food-library-detail/index.tsx` `backend/main.py`
- ✨ feat: 评论异步审核功能（无感知审核）：用户评论立即显示（与正常评论样式一致），后台 Worker 异步 AI 审核，通过则入库，违规则自动清理；新建 comment_tasks 评论任务表和 public_food_library_comments 表；圈子和食物库评论接口返回临时评论数据；前端实现本地缓存合并逻辑，刷新时自动清理已通过或超过5分钟的临时评论；用户无感知审核过程；启动独立评论审核 Worker 进程 `backend/database/comment_tasks.sql` `backend/database/public_food_library_comments.sql` `backend/database.py` `backend/worker.py` `backend/run_backend.py` `backend/main.py` `src/utils/api.ts` `src/pages/community/index.tsx` `src/pages/food-library-detail/index.tsx` `COMMENT_MODERATION_QUICKSTART.md`
- ✨ feat: AI 内容审核功能：Worker 在分析前调用 DashScope AI 审核用户提交的图片/文本，检测色情/暴力/政治/无关内容等违规；新建 content_violations 违规记录表；analysis_tasks 新增 is_violated/violation_reason 字段和 violated 状态；前端历史页展示违规标记并拦截查看详情，加载页检测到违规展示专属提示页 `backend/database/content_violations.sql` `backend/database/migrate_add_violation_fields.sql` `backend/worker.py` `backend/database.py` `src/utils/api.ts` `src/pages/analyze-history/index.tsx` `src/pages/analyze-history/index.scss` `src/pages/analyze-loading/index.tsx` `src/pages/analyze-loading/index.scss`
- ✨ feat: 文字分析功能改造为异步接口（与图片分析流程一致），用户提交任务后进入加载页面等待后台处理完成；新增 POST /api/analyze-text/submit 接口、food_text Worker、数据库表支持文字输入字段 `backend/database/migrate_analysis_tasks_for_text.sql` `backend/database.py` `backend/main.py` `backend/worker.py` `backend/run_backend.py` `src/utils/api.ts` `src/pages/record/index.tsx` `src/pages/analyze-loading/index.tsx` `backend/database/README_TEXT_ANALYSIS.md`
- 🐛 fix: 修复文字记录功能 500 错误，后端 AnalyzeTextRequest 模型添加 diet_goal 和 activity_timing 字段，前端 analyzeFoodText 函数支持传递这两个参数 `backend/main.py` `src/utils/api.ts`

## 2026-02-13

- ⚡ perf: 食物库页面性能优化（缓存+下拉刷新+骨架屏）：实现本地缓存机制立即展示数据、条件刷新策略（5分钟内不重复请求）、下拉刷新支持、乐观更新点赞、首次加载骨架屏动画；同时缓存筛选条件，避免每次进入页面数据都是空的 `src/pages/food-library/index.tsx` `src/pages/food-library/index.scss`
- ⚡ perf: 社区页性能优化（缓存+条件刷新+骨架屏）：实现本地缓存机制立即展示数据、条件刷新策略（5分钟内不重复请求）、乐观更新（点赞/评论立即反馈）、首次加载骨架屏动画；用户体验从2-3秒空白优化至<100ms展示 `src/pages/community/index.tsx` `src/pages/community/index.scss`
- ✨ feat: 分析历史页支持展示文字识别任务，同时加载图片和文字两种类型的任务，文字任务显示文字图标占位符和类型标签；更新 AnalysisTask 接口支持可选的 image_url 和 text_input 字段 `src/pages/analyze-history/index.tsx` `src/pages/analyze-history/index.scss` `src/utils/api.ts`
- 🎨 style: 社区页评论发送按钮改为 Taroify Button（圆角、绿色渐变、loading 状态），评论成功后自动收起输入框 `src/pages/community/index.tsx`
- ⚡ perf: 优化社区页接口性能，将帖子+评论整合为一个接口返回（支持分页），前端移除多次评论请求；后端批量查询评论并包含在 feed 列表中，每个帖子返回前5条评论 `backend/database.py` `backend/main.py` `src/utils/api.ts` `src/pages/community/index.tsx`
- 🐛 fix: 修复结果页吸收建议和情境建议未展示的问题，改为完整展示内容（原先只显示了标签） `src/pages/result/index.tsx` `src/pages/result/index.scss`
- 🔧 refactor: 记录页历史记录按时间倒序排列，最新的记录排在最前面（后端查询改为 desc=True） `backend/database.py`
- ✨ feat: 记录详情页完善分析结果展示，新增用户目标/运动时机标签、更完整的营养数据（纤维/糖分）、优化食物明细展示（营养素标签）、重新设计营养汇总为卡片网格布局 `src/pages/record-detail/index.tsx` `src/pages/record-detail/index.scss`
- 🔧 refactor: 记录详情页改为从数据库获取数据，通过 URL 参数传递记录 ID 而非本地缓存；新增后端 GET /api/food-record/{record_id} 接口；兼容食谱等特殊场景仍使用 storage `backend/main.py` `src/utils/api.ts` `src/pages/record/index.tsx` `src/pages/record-detail/index.tsx` `src/pages/community/index.tsx`
- 🎨 style: 食谱列表页优化：布局修复、样式美化（圆角/阴影/绿色主调）、所有 Emoji 替换为 iconfont 图标、优化创建按钮 `src/pages/recipes/index.tsx` `src/pages/recipes/index.scss`
- ✨ feat: 记录页历史记录的目标卡路里与首页一致，通过 getHomeDashboard 获取 intakeData.target 展示，未登录或失败时默认 2000 `src/pages/record/index.tsx`
- 🐛 fix: 修复食物库分享页城市选择器样式导入问题，将 `index.css` 改为 `style` 路径 `config/index.ts`
- 🐛 fix: 修复食物库分享页城市选择后不显示问题，AreaPicker 返回 code 数组需从 areaList 查找名称；改用 View+Text 替代 disabled Input `src/pages/food-library-share/index.tsx` `src/pages/food-library-share/index.scss`
- ✨ feat: 食物库分享页城市选择增加省份显示，普通城市显示"省+市+区"，直辖市显示"直辖市+区"；提交时正确处理直辖市的 city 字段 `src/pages/food-library-share/index.tsx`
- 🗃️ db: public_food_library 表增加 province 字段，支持存储省份信息；更新前后端接口和数据模型 `backend/database/add_province_to_public_food_library.sql` `backend/main.py` `backend/database.py` `src/utils/api.ts` `src/pages/food-library-share/index.tsx`
- 🔧 refactor: 食物库分享页去掉商家地址输入框，将位置信息改为商家地址，提交时自动组合省市区和详细地址作为商家地址 `src/pages/food-library-share/index.tsx`
- ✨ feat: 食物库分享页新增食物名称输入框（必填项），作为商家信息第一项；更新表单验证逻辑 `src/pages/food-library-share/index.tsx`
- 🗃️ db: public_food_library 表增加 food_name 字段，支持存储食物名称；更新前后端接口和数据模型 `backend/database/add_food_name_to_public_food_library.sql` `backend/main.py` `backend/database.py` `src/utils/api.ts` `backend/database/README_MIGRATION.md`
- 🎨 style: 食物库列表页卡片优化：食物名称作为主标题（加大加粗），食物描述弱化为副标题（浅色小字），新增口味评分显示（星星+评分），地址显示完整信息（省市区或商家地址） `src/pages/food-library/index.tsx` `src/pages/food-library/index.scss`
- 🎨 style: 食物库详情页优化：食物名称作为页面主标题，卡路里标签在右侧；食物描述作为副标题显示在食物名称下方 `src/pages/food-library-detail/index.tsx` `src/pages/food-library-detail/index.scss`

## 2026-02-10

- 🐛 fix: 个人中心页头像改为 aspectFit 模式，完整显示在圆形内不被裁剪 `src/pages/profile/index.tsx` `src/pages/profile/index.scss`
- ✨ feat: 个人中心页「账号设置」改为「设置」，点击打开个人设置弹窗 `src/pages/profile/index.tsx`
- 🎨 style: 个人中心页健康档案、我的食谱、数据统计、附近美食四个图标变大 `src/pages/profile/index.tsx` `src/pages/profile/index.scss`

## 2026-02-09

- 🔧 refactor: 健康档案页确认按钮改为 Taroify Button 组件 `src/pages/health-profile/index.tsx` `src/pages/health-profile/index.scss`
- 🎨 style: 圈子页公共食物库和打卡排行榜图标改为灰黑色，与文字颜色统一 `src/pages/community/index.scss`
- ✨ feat: 记录页拍照识别区域增加「查看分析历史」入口，可跳转分析历史页查看任务状态 `src/pages/record/index.tsx` `src/pages/record/index.scss`
- ✨ feat: 健康档案体检报告上传优化：上传后仅展示图片、点击放大预览；保存档案时提交病历提取任务，由 Worker 后台异步处理并更新到档案，用户无感知 `src/pages/health-profile/` `src/utils/api.ts` `backend/main.py` `backend/worker.py` `backend/database.py` `backend/run_backend.py`
- 🎨 style: 个人中心页移除贡献值卡片 `src/pages/profile/index.tsx` `src/pages/profile/index.scss`
- ✨ feat: 食物分析小程序优化：提交后进入加载页（旋转动画+健身小知识轮播+可离开提示），任务完成后自动跳转结果页；新增分析历史页可查看任务状态并将结果保存为饮食记录；分析页改为异步提交并增加「查看分析历史」入口 `src/pages/analyze-loading/` `src/pages/analyze-history/` `src/pages/analyze/index.tsx` `src/pages/result/index.tsx` `src/utils/api.ts` `src/app.config.ts`
- ✨ feat: 食物分析异步任务：Supabase 存储任务、多子进程 Worker 消费，提交即返回 task_id，用户可退出后从识别历史查看结果；任务表与饮食记录关联 source_task_id `backend/database/analysis_tasks.sql` `backend/database/user_food_records_source_task.sql` `backend/database.py` `backend/worker.py` `backend/run_backend.py` `backend/main.py`

## 2026-02-08

- 🎨 style: 社区页全面样式优化：渐变背景、卡片阴影、营养 pill 展示、评论区样式、弹窗与 FAB 按钮等 `src/pages/community/index.scss`
- ✨ feat: 记录详情页图片支持点击全屏预览 `src/pages/record-detail/index.tsx` `src/pages/record-detail/index.scss`
- 🔧 refactor: 登录 token 改为永不过期（约 100 年），解决 token 过期需重新登录问题 `backend/auth.py` `backend/main.py`
- 🎨 style: 优化记录详情页样式和文字间距，提升观感 `src/pages/record-detail/index.tsx` `src/pages/record-detail/index.scss`
- ✨ feat: 圈子页评论优化，点击评论按钮在卡片下展开输入框，每张卡片展示前 5 条评论（头像+文字） `src/pages/community/index.tsx` `src/pages/community/index.scss`
- 🎨 style: 首页餐次图标改为 Taroify 图标，早餐 ClockOutlined、午餐 HotOutlined、晚餐 HomeOutlined、加餐 BirthdayCakeOutlined `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🎨 style: 首页今日餐食为空时使用 Taroify Empty 组件显示空状态，添加"去记录一餐"按钮 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🔧 refactor: 移除首页的 AI 营养建议入口 `src/pages/index/index.tsx`
- 🐛 fix: 修复首页快捷记录跳转 tabBar 页面报错，改用 switchTab + storage 传参 `src/pages/index/index.tsx` `src/pages/record/index.tsx`
- 🐛 fix: 修复真机（iOS/Android）选择头像不触发上传的问题，兼容 wxfile:// 等多种临时路径格式 `src/pages/profile/index.tsx`
- 🐛 fix: 修复好友重复添加 bug，后端添加去重检查，搜索时显示"已添加/已发送"状态，页面加载时自动清理重复记录 `backend/database.py` `backend/main.py` `src/pages/community/index.tsx` `src/utils/api.ts`
- 🎨 style: 社区页好友列表支持左右滑动，好友较多时可水平滚动查看 `src/pages/community/index.tsx` `src/pages/community/index.scss`
- ✨ feat: 健康档案病史题目支持自定义输入，用户可添加预设列表外的病史项，点击切换选中状态，长按删除 `src/pages/health-profile/index.tsx` `src/pages/health-profile/index.scss`
- 🎨 style: 个人中心页使用 Taroify 图标替换 emoji 图标，包括服务列表、设置列表、贡献值卡片等 `src/pages/profile/index.tsx` `src/pages/profile/index.scss`
- 🎨 style: 个人中心页使用 Taroify Cell 组件重构服务导航和设置列表，统一带箭头的单元格样式 `src/pages/profile/index.tsx` `src/pages/profile/index.scss`
- ✨ feat: 引入 Taroify 组件库，配置 vite-plugin-style-import 实现按需引入样式，添加 H5 适配 `config/index.ts` `package.json`
- 🎨 style: 增大文字记录区域的选项按钮尺寸（餐次、饮食目标、运动时机、快捷标签），提升点击体验 `src/pages/record/index.scss`
- 🎨 style: 优化记录页文字记录部分的布局和样式：重新设计输入区域、添加顶部介绍卡片、改用快捷标签形式、折叠配置选项、优化底部按钮交互，整体更美观人性化 `src/pages/record/index.tsx` `src/pages/record/index.scss`
- 🔧 chore: 从 tabBar 中移除 AI助手入口 `src/app.config.ts`
- 🔒 security: 测试后台添加登录认证，账号密码验证后才能访问，使用 Cookie 保持会话，不影响其他 API 接口 `backend/main.py` `backend/static/test_backend/login.html` `backend/static/test_backend/index.html` `backend/static/test_backend/app.js` `backend/static/test_backend/style.css`
- ✨ feat: 实现提示词动态管理功能，支持在测试后台为千问/Gemini模型分别配置和修改提示词，提示词存储在数据库中，支持创建、编辑、激活、删除和历史记录 `backend/database/model_prompts.sql` `backend/database.py` `backend/main.py` `backend/test_backend/single_processor.py` `backend/static/test_backend/`
- ✨ feat: 实现食物分析测试后台系统，支持批量（ZIP）和单张图片测试，对比千问/Gemini模型重量估算偏差，提供可视化表格展示和CSV导出功能 `backend/test_backend/` `backend/static/test_backend/` `backend/main.py`
- 📝 docs: 优化测试后台开发需求文档，添加清晰的结构化说明、API 接口设计、技术实现要求和验收标准，便于 AI 理解需求 `backend/docs/测试后台开发需求.md`
- 🔧 refactor: Gemini 调用改为通过 OpenRouter API 接入，移除 google-genai SDK 依赖，使用 OpenAI 兼容格式简化代码 `backend/main.py` `backend/.env` `backend/requirements.txt`
- ✨ feat: 接入 Gemini 双模型对比分析功能：后端添加 `/api/analyze-compare` 接口，支持同时调用千问和 Gemini 模型；前端分析页添加对比模式开关；结果页添加模型切换选项卡，可对比查看两个模型的分析结果并选择保存 `backend/main.py` `backend/.env` `backend/requirements.txt` `src/utils/api.ts` `src/pages/analyze/index.tsx` `src/pages/analyze/index.scss` `src/pages/result/index.tsx` `src/pages/result/index.scss`

## 2026-02-05

- 🎨 style: 优化分析结果页样式：重构所有卡片视觉，统一阴影与圆角，优化字体排版与颜色，增强按钮交互质感，提升页面整体精致度 `src/pages/result/index.scss` `src/pages/result/index.tsx`
- 🎨 style: 全面优化分析页样式：增加选项图标（餐次/目标/时机），升级为 Grid 卡片布局，优化圆角阴影与交互动效，提升整体精致度 `src/pages/analyze/index.tsx` `src/pages/analyze/index.scss`

## 2026-02-04

- 🎨 style: 分析页去除图标背景与阴影，保持纯图标样式 `src/pages/analyze/index.scss`
- 🎨 style: 更新 iconfont 字体库为 wk9o9xvo91c，并在分析页用 iconfont 替换餐次/状态/细节/语音图标 `src/assets/iconfont/iconfont.css` `src/pages/analyze/index.tsx` `src/pages/analyze/index.scss`
- 🎨 style: 记录页选中态卡片背景调整为统一浅灰高亮，移除彩色渐变选中效果 `src/pages/record/index.scss`
- 🎨 style: 记录页选中态卡片背景对齐首页快捷记录（绿/蓝/紫浅色渐变） `src/pages/record/index.tsx` `src/pages/record/index.scss`
- 🎨 style: 记录页文字/历史图标背景改为首页快捷记录配色（蓝/紫渐变），提升清晰度 `src/pages/record/index.tsx` `src/pages/record/index.scss`
- 🎨 style: 记录页文字/历史图标提升可读性：未选中改深色，文字记录激活态补充绿色渐变背景 `src/pages/record/index.tsx` `src/pages/record/index.scss`
- 🎨 style: 公共食物库页图标替换为 iconfont（空状态/商家/定位/点赞/评论/评分），并补充图标继承与颜色样式 `src/pages/food-library/index.tsx` `src/pages/food-library/index.scss`
- 🎨 style: 移除本周打卡排行榜 banner 图标，保持文字布局简洁 `src/pages/community/index.tsx`
- 🎨 style: 打卡排行榜图标替换为奖杯 icon-weibiaoti-_huabanfuben，保持原有配色与样式 `src/pages/community/index.tsx`
- 🎨 style: 社区页部分 emoji 图标替换为 iconfont（食物/定位/排行榜/热门话题/点赞/评论/活跃人数），并补充图标继承样式与点赞高亮色 `src/pages/community/index.tsx` `src/pages/community/index.scss`
- 🎨 style: 更新 iconfont 字体库为最新版本（font_5122763_08ofacfx1j2），同步新增图标类与字体文件地址 `src/assets/iconfont/iconfont.css`
- 🐛 fix: 修复 iconfont 图标大小样式失效问题：单位从 px 改为 rpx，移除 SCSS 中的 !important，添加伪元素样式继承，默认大小从 24 改为 48rpx `src/components/iconfont/index.tsx` `src/components/iconfont/index.scss`
- 🐛 fix: 修复 IconCarbs 组件名称不一致，将 IconCarb 改为 IconCarbs 匹配使用方 `src/components/iconfont/index.tsx`
- ✨ feat: 创建食谱列表页面，支持全部/收藏标签切换、一键使用、编辑、删除操作，显示营养摘要和使用统计 `src/pages/recipes/index.tsx`
- 🐛 fix: 创建缺失的 iconfont 组件文件，导出 IconCamera/IconText/IconClock 等图标组件，修复记录页模块导入错误 `src/components/iconfont/index.tsx`
- 🐛 fix: 修复构建错误：创建缺失的 recipe-edit/index.tsx 文件，实现基础食谱编辑页面（名称/描述/餐次/营养摘要/保存删除按钮） `src/pages/recipe-edit/index.tsx`
- 🐛 fix: 改进图片上传接口错误处理，区分网络错误与参数错误，提供友好提示 `backend/main.py` `backend/database.py`
- 🐛 fix: 补充图片分析超时与网络错误提示，避免 500 空错误信息 `backend/main.py`
- 🎨 style: 记录页记录方式图标替换为 iconfont，统一视觉风格 `src/pages/record/index.tsx`
- 🐛 fix: 社区页拍照取消不提示失败，避免误导用户 `src/pages/community/index.tsx`
- ✨ feat: 社区页拍照按钮接入拍照分析流程并替换为拍照图标 `src/pages/community/index.tsx`
- 🐛 fix: 修复导入路径大小写错误：将 Iconfont 改为 iconfont 匹配实际文件夹名称，解决 TypeScript 大小写敏感警告 `src/pages/index/index.tsx`
- 🎨 style: 营养素图标颜色统一为白色：蛋白质/碳水/脂肪图标都使用 #ffffff 白色，与绿色渐变背景更加协调 `src/pages/index/index.tsx`
- ✨ feat: 更新 iconfont 并添加营养素图标：下载最新 CSS（font_5122763_t62pgegqf8）新增蛋白质/碳水/脂肪图标；创建 IconProtein/IconCarbs/IconFat 组件；替换首页宏量营养素 emoji 为专业图标（蛋白质-绿色、碳水-橙色、脂肪-红色） `src/assets/iconfont/iconfont.css` `src/components/Iconfont/index.tsx` `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🎨 style: 调整首页快捷记录卡片与上方间距：margin-top 从 -32rpx 改为 -16rpx，减少叠加效果增加呼吸感 `src/pages/index/index.scss`
- 🎨 style: 优化首页快捷记录卡片：图标容器从 60rpx 增大到 72rpx，图标从 37rpx 增大到 44rpx；卡片内边距从 20rpx 增加到 32rpx，按钮间距从 20rpx 增加到 24rpx，图标与文字间距从 12rpx 增加到 16rpx `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🐛 fix: 增强 iconfont 图标居中：在组件内联样式添加 display:flex/alignItems/justifyContent，SCSS 使用 inline-flex 和 !important 确保样式生效 `src/components/Iconfont/index.tsx` `src/components/Iconfont/index.scss`
- 🐛 fix: 修复 iconfont 图标居中问题：将 display 从 inline-block 改为 flex，添加 align-items 和 justify-content 确保所有图标完美居中 `src/components/Iconfont/index.scss`
- 🎨 style: 首页快捷按钮全部替换为 iconfont 图标：拍照使用 IconCamera、文字记录使用 IconText、历史记录使用 IconClock，统一大小 40rpx 白色图标 `src/pages/index/index.tsx`
- 🎨 style: 首页拍照按钮图标优化：调整 IconCamera 大小为 40rpx，添加 overflow 和 line-height 样式确保图标完美居中且不与圆形边界相交 `src/pages/index/index.tsx` `src/pages/index/index.scss`
- 🎨 style: 首页拍照按钮替换为 iconfont 图标：使用 IconCamera 组件替换 emoji 相机图标 `src/pages/index/index.tsx`
- ✨ feat: 配置 Iconfont Font Class 方案：下载字体文件、创建 Iconfont 组件（支持 name/size/color）、全局引入样式、提供 3 个预设图标组件（IconClock/IconCamera/IconText） `src/assets/iconfont/iconfont.css` `src/components/Iconfont/index.tsx` `src/components/Iconfont/index.scss` `src/app.scss` `docs/ICONFONT使用指南.md`
- 📝 docs: Taro-iconfont-cli 兼容性问题说明：工具不兼容 Taro 4.x，提供三种替代方案（简化图标组件/Font class/等待更新） `docs/ICONFONT问题说明.md` `src/components/Icon/index.tsx`
- 🔧 chore: 配置 taro-iconfont-cli 图标管理：安装依赖、创建配置文件、添加 npm 脚本、编写使用文档 `iconfont.json` `package.json` `docs/ICONFONT使用说明.md`
- 🐛 fix: 食谱一键记录数据类型转换：total_weight_grams 从浮点数转整数避免数据库报错 `backend/main.py`
- 🐛 fix: 食谱一键记录创建饮食记录失败：修正 insert_food_record 参数传递，并对餐次为空/非法时回退 snack `backend/main.py`
- ✨ feat: 新增食谱编辑页：支持编辑名称/描述/标签/餐次/收藏，显示营养摘要；无 id 时提示从识别结果页保存 `src/pages/recipe-edit/index.tsx` `src/pages/recipe-edit/index.scss` `src/pages/recipe-edit/index.config.ts` `src/app.config.ts`
- ✨ feat: 私人食谱库前端页面：新增食谱列表页（全部/收藏切换、营养摘要、使用统计、一键记录/编辑/删除）；结果页增加「保存为食谱」按钮；个人中心新增「我的食谱」入口 `src/pages/recipes/` `src/pages/result/index.tsx` `src/pages/result/index.scss` `src/pages/profile/index.tsx` `src/pages/profile/index.scss` `src/app.config.ts`
- ✨ feat: 私人食谱库功能：支持用户保存常吃的食物组合为食谱（如"我的标配减脂早餐"），实现一键记录；后端新增 user_recipes 表、CRUD API（创建/列表/详情/更新/删除/使用）；前端新增对应 API 函数 `backend/database/user_recipes.sql` `backend/database.py` `backend/main.py` `src/utils/api.ts`
- 🎨 style: 个人中心页面颜色调整：将深绿色系（#10b981）统一调整为首页的明亮绿色（#00bc7d、#00bba7），保持全局色彩一致性 `src/pages/profile/index.scss`
- 🎨 style: 个人中心页面设计全面优化：更现代的渐变配色（绿色主题）、圆润的圆角设计、精致的阴影和光效、流畅的动画过渡、卡片悬浮效果、图标旋转动效、优化的间距和排版 `src/pages/profile/index.scss`
- 🔧 refactor: 个人中心去除减重相关内容：删除体重卡片与统计卡片（连续签到/已减重/总记录），仅保留用户信息与服务列表；新增 GET /api/user/record-days 返回真实记录天数（按日期去重计算） `src/pages/profile/index.tsx` `src/pages/profile/index.scss` `src/utils/api.ts` `backend/main.py`
- ✨ feat: 个人设置功能优化：保存前显示确认弹窗；校验空信息并提示；单独修改头像或昵称时二次确认；未做修改时也显示保存成功 `src/pages/profile/index.tsx`
- ✨ feat: 个人设置功能：点击设置按钮打开弹窗，支持重新修改头像和昵称；微信头像自动上传到 Supabase 获取公网 URL；保存时显示具体修改项（头像/昵称）的提示；后端新增 POST /api/user/upload-avatar、database.py 新增 upload_user_avatar、Supabase 新增 user-avatars bucket `backend/database.py` `backend/main.py` `src/utils/api.ts` `src/pages/profile/index.tsx` `src/pages/profile/index.scss`

## 2026-02-03

- ✨ feat: 公共食物库功能（生态建设）：用户可分享健康餐到公共库（带商家名、地址、位置、口味评分、是否适合减脂、自定义标签），支持点赞、评论与评分，形成带地理位置/商家信息的健康饮食红黑榜，解决「减肥不知道点什么外卖」痛点 `backend/database/public_food_library.sql` `backend/database.py` `backend/main.py` `src/utils/api.ts` `src/pages/food-library/` `src/pages/food-library-detail/` `src/pages/food-library-share/` `src/pages/community/index.tsx` `src/app.config.ts`
- 🐛 fix: 修复海报底部内容被遮挡：Canvas 高度增至 720px，预览弹窗支持内容滚动，确保长图完整显示 `src/utils/poster.ts` `src/pages/record-detail/index.scss` `src/pages/record-detail/index.tsx`
- 🎨 style: 优化海报设计 V3：Ins 风格、纯白背景、小程序主题色 (#00BC7D) 点缀；新增底部品牌区域（产品图标+名称）及二维码占位；高度增至 750px `src/utils/poster.ts` `src/pages/record-detail/index.tsx` `src/pages/record-detail/index.scss`
- 🎨 style: 优化海报设计 V3：升级为森系灰绿 Ins 风格，圆形图片+白边，居中排版，白色手写风文字，数据左右分栏，底部保留 Logo 与二维码，高度 750px `src/utils/poster.ts`
- 🎨 style: 优化海报设计 V2：引入衬线字体（Didot/Bodoni）、装饰性光晕背景、拍立得风格图片边框与阴影；使用极简圆点展示宏量营养素，去除进度条，整体更具时尚感与女性审美，高度加长至 640px `src/utils/poster.ts` `src/pages/record-detail/index.scss`
- 🎨 style: 优化海报设计 V1：升级为杂志风格排版，使用暖白背景与 Oswald 字体（或粗体 sans），增加日期大数字、圆形进度条展示宏量营养素、图片阴影效果，提升分享美感 `src/utils/poster.ts` `src/pages/record-detail/index.scss`
- ✨ feat: 识别结果详情页增加「生成分享海报」：含食物照片、本餐热量与宏量、健康建议一句、品牌与 slogan；支持保存到相册，符合《用户端升级方案》5.2 分享卡片设计 `src/pages/record-detail/index.tsx` `src/pages/record-detail/index.scss` `src/utils/poster.ts`

## 2026-02-02

- ✨ feat: 新增数据统计页：个人中心「数据统计」跳转 pages/stats；周/月切换、热量盈缺看板（日均 vs TDEE）、连续记录天数、按餐次与宏量占比的饮食结构、每日摄入列表、简单分析报告；后端 GET /api/stats/summary?range=week|month `backend/main.py` `src/utils/api.ts` `src/pages/stats/` `src/pages/profile/index.tsx` `app.config.ts`
- 🔧 chore: 新增脚本 seed_xiaomage_request.py：模拟用户「小马哥」请求添加测试账号(18870666046)为好友；主种子脚本增加同一步骤 `backend/seed_test_data.py` `backend/seed_xiaomage_request.py`
- ✨ feat: 圈子 Feed 同时展示自己的今日食物：list_friends_today_records 包含当前用户，API 返回 is_mine，前端自己的帖子显示「我」 `backend/database.py` `backend/main.py` `src/utils/api.ts` `src/pages/community/index.tsx`
- ✨ feat: 圈子测试帖增加图片与食物明细：种子脚本 FOOD_RECORDS 含 image_path（Unsplash 图）、items 明细；圈子帖支持点击查看详情（存 record 后跳 record-detail），点赞/评论区域阻止冒泡 `backend/seed_test_data.py` `src/pages/community/index.tsx`
- 🐛 fix: 圈子页下拉刷新不生效：改为使用 ScrollView 的 refresher（refresherEnabled/onRefresherRefresh/refresherTriggered），因页面级下拉被内部 ScrollView 接管 `src/pages/community/index.tsx` `src/pages/community/index.config.ts`
- ✨ feat: 圈子页改为下拉刷新：启用 enablePullDownRefresh，使用 usePullDownRefresh 刷新好友与动态，移除触顶刷新 `src/pages/community/index.tsx` `src/pages/community/index.config.ts`
- 🐛 fix: 圈子页滚动与屏幕不同步：页面用 flex 布局、ScrollView 外包一层并绝对定位填满，使滚动区域高度与可视区一致；底部留白 320rpx `src/pages/community/index.tsx` `src/pages/community/index.scss`
- 🐛 fix: 圈子页滚动到底部内容被遮挡：为滚动内容增加底部留白 280rpx，避免最后一条动态被 tab 栏和浮动按钮挡住 `src/pages/community/index.tsx` `src/pages/community/index.scss`
- 🔧 chore: 新增种子脚本 seed_test_data.py：为测试账号 18870666046 添加 3 名测试好友（小明/小红/小刚）及今日食物记录，用于圈子 Feed 测试 `backend/seed_test_data.py`
- ✨ feat: 圈子页完善社交：好友（按昵称/手机号搜索、发送请求、收到的请求接受/拒绝、好友列表）、好友今日饮食动态（来自 user_food_records）、点赞与评论（feed_likes/feed_comments）；后端 user_friends/friend_requests/feed_likes/feed_comments 表与 API `backend/database/user_friends.sql` `backend/database/feed_likes_comments.sql` `backend/database.py` `backend/main.py` `src/utils/api.ts` `src/pages/community/index.tsx` `src/pages/community/index.scss`
- ✨ feat: 食物分析结合健康档案：/api/analyze、/api/analyze-text 支持可选 Authorization，已登录时拉取用户健康档案（性别/身高体重年龄/活动水平/病史/饮食偏好/过敏/BMR·TDEE/体检摘要）注入 prompt，AI 在 insight、absorption_notes、context_advice 中给出更贴合体质与健康状况的建议（如控糖、低嘌呤、过敏规避） `backend/middleware.py` `backend/main.py`
- 🎨 style: 首页去除今日运动卡片及相关逻辑与样式 `src/pages/index/index.tsx` `src/pages/index/index.scss`

## 2026-02-01

- ✨ feat: 食物分析先上传图片到 Supabase 获取 URL，分析接口支持 image_url；分析页先调 upload-analyze-image 再分析，结果页/标记样本/保存记录均存 Supabase 图片 URL `backend/database.py` `backend/main.py` `src/utils/api.ts` `src/pages/analyze/index.tsx`
- ✨ feat: 结果页「标记样本」功能：AI 估算偏差大时点击标记，需先修改重量（>1g 差异）并登录，提交到 critical_samples_weapp 表；参考 hkh 实现，已标记后按钮变绿不可再点 `src/pages/result/index.tsx` `src/pages/result/index.scss` `src/utils/api.ts` `backend/main.py` `backend/database.py` `backend/database/critical_samples.sql`
- ✨ feat: 分析页增加餐次选择（早餐/午餐/晚餐/加餐），分析时传入后端；结果页若来自分析页则直接确认保存不再选餐次与状态 `src/pages/analyze/` `src/pages/result/index.tsx` `src/utils/api.ts` `backend/main.py`
- ✨ feat: 记录页文字记录增加「当前状态」选择，开始计算时传入分析接口；结果页（result-text）若来自文字记录则直接使用该状态确认记录 `src/pages/record/index.tsx` `src/pages/record/index.scss` `src/pages/result-text/index.tsx` `src/utils/api.ts`
- ✨ feat: 分析页（pages/analyze）增加「当前状态」选择，分析时传入后端，AI 结合状态给出建议；结果页若来自分析页则直接使用该状态确认记录 `src/pages/analyze/index.tsx` `src/pages/analyze/index.scss` `src/pages/result/index.tsx` `src/utils/api.ts`
- ✨ feat: 增强食物分析：PFC 比例评价、吸收率说明、情境建议；确认记录时选择当前状态（刚健身完/空腹/减脂期/增肌期/维持/无特殊）；user_food_records 新增 context_state/pfc_ratio_comment/absorption_notes/context_advice `backend/database/user_food_records_pro_analysis.sql` `backend/main.py` `backend/database.py` `src/utils/api.ts` `src/pages/result/` `src/pages/result-text/` `src/pages/record-detail/`
- ✨ feat: 新增识别记录详情页，记录页点击历史记录卡片跳转详情（餐次/时间/总热量、描述与建议、食物明细与宏量汇总） `src/pages/record-detail/` `src/pages/record/index.tsx` `app.config.ts`
- 🎨 style: 健康档案选项宽度收窄，仅比文字略宽（性别/活动/病史/饮食） `src/pages/health-profile/index.scss`
- 🐛 fix: 健康档案切换下一题时校验必填项，未选择/未填写时不允许切换并提示；身高/体重超出范围时给出具体提示 `src/pages/health-profile/index.tsx`
- 🎨 style: 健康档案采用方案 D 轻优化：上一题收进卡片底部与确认同一行，左滑下一题/右滑上一题手势，进度旁「左滑下一题」提示，可选时确认按钮高亮 `src/pages/health-profile/index.tsx` `src/pages/health-profile/index.scss`
- 🎨 style: 健康档案每步「确认」按钮改为紧贴选项/文本框下方，不再贴卡片底部 `src/pages/health-profile/index.scss`
- ✨ feat: 个人页「健康档案」按是否完成分流：未完成跳填写页，已完成跳新建查看页展示已填信息并可修改 `src/pages/profile/index.tsx` `src/pages/health-profile-view/` `app.config.ts`
- ✨ feat: 首页数据对接：GET /api/home/dashboard 聚合今日摄入与今日餐食，首页拉取并展示；运动区块保留静态 `src/pages/index/index.tsx` `src/utils/api.ts` `backend/main.py`
- ✨ feat: 文字记录数量改为多行输入，开始计算前增加用户确认弹窗 `src/pages/record/index.tsx` `src/pages/record/index.scss`
- ✨ feat: 文字记录：多行食物描述、开始计算调大模型分析、跳转 result-text 页展示并确认记录落库 `src/pages/record/index.tsx` `src/pages/result-text/` `src/utils/api.ts` `backend/main.py`
- ✨ feat: 记录页历史记录改为真实数据：GET /api/food-record/list 按日期拉取，支持最近 7 天日期选择，加载/空态/未登录提示 `src/pages/record/index.tsx` `src/utils/api.ts` `backend/main.py` `backend/database.py`
- ✨ feat: 结果页确认记录：点击「确认记录并完成」先选餐次（早餐/午餐/晚餐/加餐），确认后保存到 user_food_records，未登录提示先登录 `src/pages/result/index.tsx` `src/utils/api.ts` `backend/main.py` `backend/database.py` `backend/database/user_food_records.sql`
- 🗃️ db: 新增 user_food_records 表（user_id, meal_type, image_path, description, insight, items, total_* 营养与总重量），用于拍照识别后确认记录落库 `backend/database/user_food_records.sql`
- ✨ feat: 保存健康信息前弹出确认框，保存成功后 1.5 秒跳转到个人中心 `src/pages/health-profile/index.tsx`
- 🐛 fix: 健康档案最后一步改为第 10 步，显示「保存健康信息」按钮；修复 TOTAL_STEPS=9 导致最后一张保存卡无法到达的问题，问卷+OCR 一并保存到数据库 `src/pages/health-profile/index.tsx` `src/pages/health-profile/index.scss`
- ✨ feat: 上传体检报告单独一卡，仅识别不落库；点击「保存健康档案」时将个人身体情况与病例信息一并存入数据库 `backend/main.py` `src/pages/health-profile/index.tsx` `src/utils/api.ts`
- 🎨 style: 健康档案页改为分步卡片答题式交互：每题一卡、卡片滑动切换、进度条、选项卡片点击即下一题，减少枯燥感 `src/pages/health-profile/index.tsx` `src/pages/health-profile/index.scss`
- ✨ feat: 深度个性化健康档案（Professional Onboarding）：基础生理问卷、BMR/TDEE 代谢计算、病史与饮食偏好、体检报告 OCR 导入 `backend/database/user_health_profile.sql` `backend/main.py` `backend/database.py` `backend/metabolic.py` `src/pages/health-profile/` `src/pages/profile/index.tsx` `src/utils/api.ts`
- 🗃️ db: 扩展 weapp_user 表（height/weight/birthday/gender/activity_level/health_condition/bmr/tdee/onboarding_completed），新增 user_health_documents 表用于 OCR 报告 `backend/database/user_health_profile.sql`
- ✨ feat: 个人页增加「健康档案」入口与未完成引导时的提示条，登录后同步 onboarding_completed 状态 `src/pages/profile/index.tsx` `src/app.config.ts`

---

## 2025-01-28

- 🐛 fix: 优化登录错误提示，增加详细错误信息便于排查网络问题 `src/utils/api.ts`
- 🔧 chore: 前端 API 地址改为生产环境 https://healthymax.cn `src/utils/api.ts`
- 🔧 chore: 修改后端启动端口为 3010，同步更新前端 API 地址 `backend/run.sh` `src/utils/api.ts`
- 🔧 refactor: 给所有后端接口添加 /api 前缀，统一API路径规范 `backend/main.py`
- 🐛 fix: 修复结果页食物重量调节时摄入比例跟随变化的bug，现在两者独立调节 `src/pages/result/index.tsx`
- ✨ feat: 添加摄入比例滑块功能，支持拖动调节0-100%（步长5%） `src/pages/result/index.tsx`
- 📝 docs: 完成拍照识别功能的完整技术分析文档
- 🔧 chore: 创建项目开发规则文件 `.cursorrules` 和进度追踪文件 `PROGRESS.md`

---

## 项目初始化

- ✨ feat: 实现微信小程序登录功能（JWT认证）
- ✨ feat: 实现拍照识别食物热量功能（阿里云DashScope AI）
- ✨ feat: 实现营养成分展示（热量、蛋白质、碳水、脂肪、纤维、糖）
- ✨ feat: 实现AI健康建议生成
- ✨ feat: 实现用户信息管理
- ✨ feat: 实现手动调节食物摄入量

---

## 待开发

- [x] 饮食记录保存到数据库
- [x] 历史记录查询和展示
- [x] 每日营养统计图表
- [x] 摄入比例滑块控件
- [ ] 运动记录功能
- [x] 社区分享功能
- [x] 公共食物库（健康外卖红黑榜）
- [ ] 私人食谱库
- [ ] 更多城市/地区筛选

---

**当前版本：** v0.2.0-alpha  
**最后更新：** 2026-02-03

## 2026-03-17

- ✨ feat: 后台食物分析 Gemini 接口切换为通过 OfoxAI OpenAI 兼容接口调用 `backend/main.py`

