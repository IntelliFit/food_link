# 首页活动 Banner 与三记录卡设计 QA

- 源视觉真值：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-3c6dce1c-ce26-438d-bd0e-f2bf395bf33f.png`
- 实现截图：`/private/tmp/foodlink-home-banner-three-cards-final.png`
- 聚焦实现截图：`/private/tmp/foodlink-home-banner-three-cards-focus.png`
- 并排对比图：`/private/tmp/foodlink-home-banner-three-cards-comparison.png`
- 验证环境：微信开发者工具模拟器，页面内容视口约 390 × 753 CSS px；完整截图 656 × 1418 px
- 源图像尺寸：688 × 486 px；实现聚焦图尺寸：656 × 463 px
- 密度归一：源图缩放为 656 × 463 px；实现截图裁取同一 Banner 与记录卡区域为 656 × 463 px，再横向合并比较
- 页面状态：同一登录用户、浅色主题、活动 Banner 与今日记录默认态

## Findings

- 无 P0/P1/P2 问题。
- 信息结构：活动 Banner 保留标题和说明两行，第三行“去识别 / 去赚 / 去看看 / 去反馈”及箭头已删除；整张 Banner 仍是点击入口。
- 尺寸：Banner 主卡由 176rpx 调整为 140rpx，缩短 20.45%；Swiper 轨道同步由 184rpx 调整为 148rpx，未产生裁切或多余空白。
- 记录卡：体重、喝水、运动已恢复为三个等宽独立白色卡片，不再使用“今日记录 + 编辑”的共享大卡和竖线分隔结构。
- 字体：继续使用首页既有字号；Banner 标题 28rpx、说明 22rpx，记录值 40rpx、单位与辅助信息 20rpx，没有新增一次性字号。
- 间距：缩窄后的 Banner 两行文案垂直居中；三张记录卡使用 16rpx 间距、20rpx 内边距和 24rpx 圆角，首屏仍能看到“今日餐食”作为下滑提示。
- 颜色：保留原 Banner 图片与深色遮罩；三张记录卡使用白色表面和轻阴影，体重、喝水、运动图标继续使用灰、蓝、橙色语义色。
- 图标与图片：Banner 继续使用原业务图片，记录卡继续使用项目 iconfont；没有新增或替换图片资产，也没有使用 Emoji、自绘 SVG 或占位资源。
- 文案：标题和业务说明保持不变，仅按用户要求删除第三行操作文案；记录卡保留原有真实数值、单位和辅助信息。

## Full-view comparison evidence

- 并排图左侧为修改前源图，右侧为实现。右侧 Banner 高度明显降低约五分之一，标题和说明未被裁切，轮播圆点仍在卡片内。
- 右侧不再出现任何第三行白色操作文字；下面直接进入三张独立记录卡，卡片边界和间距清晰。
- 三卡下方已露出“今日餐食”标题，没有出现恢复三卡后首屏内容完全被挤出的情况。

## Focused-region comparison evidence

- 聚焦图覆盖 Banner、三张记录卡和下一模块标题，文字、圆角、卡间距及轮播圆点均可清晰判读，无需额外局部放大。
- CSS 尺寸提供精确比例证据：`140 / 176 = 79.55%`，即高度缩短 `20.45%`，符合“缩窄 20%”要求。

## Interaction and runtime checks

- `.home-handbook-card__action` 确认不存在。
- `.body-status-card` 确认渲染 3 个。
- 点击缩窄后的整张 Banner 成功进入 `packageExtra/pages/goose-duck-chicken/index`，返回首页正常，说明删除操作文字没有删除业务入口。
- 微信开发者工具运行时错误日志：0 条。
- TypeScript、目标 ESLint 与 `git diff --check` 通过。

## Comparison history

1. 修改前 Banner 为 176rpx 高并包含第三行操作文字；记录区为单张共享大卡。
2. 修复：Banner 改为 140rpx，删除 action 字段和渲染节点；记录区恢复 PR #54 前的三卡 JSX、样式和深色模式规则。
3. 修复后证据：`/private/tmp/foodlink-home-banner-three-cards-final.png` 与并排对比图显示布局稳定；整卡跳转正常，运行时错误 0。

## Follow-up Polish

- 无阻塞项。P3：极窄设备上较长的喝水目标文案继续沿用原版单行展示策略，当前常用机型未发生溢出。

final result: passed

---

# 分析页双模式主卡区分设计 QA

- 均衡模式：`/private/tmp/foodlink-balanced-stats-light-card.png`
- 养生模式：`/private/tmp/foodlink-wellness-stats-dark-card.png`
- 验证环境：微信开发者工具模拟器，同一分析数据，仅切换首页模式

## Findings

- 均衡模式主卡使用 `#edf8f2 → #c8e5d7` 浅薄荷/鼠尾草绿渐变，标题与主数值使用 `#1f493a` 深绿；视觉语言与圈子页浅色卡片一致。
- 养生模式主卡继续使用 `#133a32 → #245c4f` 深森林绿渐变和白色标题，不受均衡模式规则影响。
- 两种模式的卡片结构、数值、徽标和四项指标完全一致，只通过色面和文字明度区分，不改变分析功能。
- 微信运行时确认分别命中 `fl-page-theme-root--balanced` 与 `fl-page-theme-root--wellness`；错误日志为 0。
- TypeScript、目标 ESLint与 `git diff --check` 通过。

final result: passed

---

# 首页模式扩展为全局主题设计 QA

- 养生分析页：`/private/tmp/foodlink-wellness-global-stats-final.png`
- 养生圈子页：`/private/tmp/foodlink-wellness-global-community.png`
- 养生我的页：`/private/tmp/foodlink-wellness-global-profile.png`
- 均衡我的页对照：`/private/tmp/foodlink-balanced-global-profile.png`
- 验证环境：微信开发者工具模拟器，同一代码与用户状态，仅切换 `home_display_mode_v1`

## Findings

- 养生模式在三个主 Tab 使用一致的暖白背景、暖米白表面、森林绿主卡和暖金导航选中态；没有把页面主体整体染成深绿。
- 分析页“关注综合分”主卡保持深绿底与白字，运行时背景为 `#133a32 → #245c4f`，标题为纯白；不存在通用暖白卡片覆盖造成的低对比问题。
- 圈子页的快捷入口、排行榜、筛选区和动态列表处于同一暖色背景体系；排行榜继续承担主视觉，内容照片和业务语义色未被主题滤镜污染。
- 我的页的会员主卡保持深绿，列表卡使用暖米白表面；头像、功能图标和红色提醒等原语义色保持不变。
- 三页页面壳均实测为 `fl-page-theme-root--wellness`；切回均衡模式后实测为 `fl-page-theme-root--balanced`，页面恢复原薄荷渐变与白色导航。
- 原生顶部背景和自定义底栏均随模式统一；运行时错误日志为 0。
- TypeScript、目标 ESLint、21 个 Jest 套件（78 条）与 `git diff --check` 通过。

final result: passed

---

# 首页双模式宠物尺寸一致性设计 QA

- 养生模式截图：`/private/tmp/foodlink-wellness-pet-size.png`
- 均衡模式截图：`/private/tmp/foodlink-balanced-pet-size.png`
- 验证环境：微信开发者工具模拟器，同一登录用户、同一宠物展开状态

## Findings

- 养生模式不再强制把宠物收起，也不再额外应用 `scale(0.62)`；模式切换只改变首页内容主题，不改变宠物视觉状态。
- 微信运行时测量：养生/均衡模式的宠物外框均为 `187 × 98px`，头像均为 `86 × 86px`，状态类均为 `is-expanded`。
- 两张完整页面截图中宠物的位置、头像直径、对话气泡和收起按钮尺寸一致；未出现裁切、重叠或缩放跳变。
- 真实执行养生 → 均衡 → 养生切换，用户选择状态可保持；运行时错误日志为 0。
- TypeScript、目标 ESLint、21 个 Jest 套件（78 条）与 `git diff --check` 通过。

final result: passed

---

# 常用形象新增华佗与太极小子设计 QA

- 源视觉真值：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-02918ffa-9e4b-4b14-89ee-884138499f5c.png`、`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-79144f06-2bb9-43ef-a22b-808aee82e619.png`
- 目标区域参考：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-912a0d14-8f81-4bab-bb29-daedea1c04ed.png`
- 处理后素材：`apps/wechat/src/assets/pets/huatuo-01.png`、`apps/wechat/src/assets/pets/taiji-xiaozi-01.png`
- 素材规格：384 × 384 透明 PNG；华佗约 29KB，太极小子约 22KB

## Findings

- 已去除源卡片的绿色编号、名称、标签与说明文字，只保留人物和随身元素；华佗保留药杖、药枝与药篮，太极小子保留太极图。
- 两个人物使用同一透明画布尺寸与视觉重心，接入既有 `PetAvatar` 的 `aspectFit` 槽位，不使用截图整卡、占位图、Emoji 或自绘 SVG。
- “常用形象”由两列调整为三列，健文伙伴、华佗、太极小子可以在同一行展示；卡片选中态和“选择/当前”交互沿用现有实现。
- 新增后端内置 ID 和候选元数据，复用现有选择接口与持久化字段；匹配版本提升后，已有用户也能获取新增候选。
- TypeScript、目标 ESLint、21 个 Jest 套件（78 条）、宠物 Go 服务测试与 `git diff --check` 通过。
- 微信开发者工具 CLI 已成功打开项目并刷新编译产物，但当前 DevTools 版本只启动 IDE HTTP 服务，未开放 `miniprogram-automator` 所需 WebSocket；`mrc` 无法连接 3001，因此未能取得同状态运行时截图和实际点击证据。

## Blocking issue

- 需要在微信开发者工具中重新开启“工具 → 自动化”或恢复兼容的自动化端口后，补做三张卡可见、点击华佗/太极小子、返回首页同步、错误日志为 0 的验证。

final result: blocked

---

# 养生模式微量营养展开设计 QA

- 实现截图：`/private/tmp/foodlink-home-wellness-micros-expanded-final.png`
- 验证环境：微信开发者工具模拟器，首页养生模式，浅色主题

## Findings

- 养生热量卡复用均衡模式既有的 `MicrosSection`，没有复制微量营养配置、计算或数据状态。
- 折叠态在三大营养下方显示“营养概览 / 展开更多”；展开后显示 21 项微量营养及当前值、目标值和进度。
- 展开区域延续养生模式的暖米白卡面、低饱和金色分隔和森林绿操作色，未引入新的深绿色大背景。
- 点击收起后展开内容消失，再次点击恢复 21 项；微信开发者工具运行时错误为 0。
- TypeScript、目标 ESLint、21 个 Jest 套件（78 条）与 `git diff --check` 通过。

final result: passed

---

# 首页养生建议与主题 Banner 设计 QA

- 页面参考图：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-870cb843-50a3-41d1-a30a-2ad32db7fdc8.png`
- 养生建议整卡背景参考：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-ab5f5726-01fb-4cb3-80e8-8224b5fe348f.png`
- 微信开发者工具实现截图：`/private/tmp/foodlink-home-wellness-advice-background-final.png`
- 全屏并排证据：`/private/tmp/foodlink-wellness-full-comparison.png`
- 养生建议聚焦实现：`/private/tmp/foodlink-wellness-advice-focus.png`
- 养生建议聚焦对比：`/private/tmp/foodlink-wellness-advice-comparison.png`
- 验证环境：微信开发者工具模拟器，浅色主题，养生模式，同一登录用户
- 视口与密度：页面内容约 390 × 753 CSS px；实现截图 656 × 1418 px；页面参考 528 × 992 px；卡片参考 600 × 178 px；聚焦实现裁取为 600 × 128 px。对比以相同 600 px 宽度归一，不把截图高度和设备框差异记为视觉缺陷。

## Findings

- 无 P0/P1/P2 问题。
- 信息架构：养生模式顺序明确为热量概览、今日养生建议、养生主题 AI 食物识别 Banner、体重/喝水/运动；均衡模式原 Banner 和后续功能未改。
- 用户后续要求删除养生音乐与养生小运动；最终养生模式在三张身体状态卡后直接结束，不再渲染 `.wellness-feature-grid` 或任何对应入口、占位提示和专用样式。日常运动记录卡属于身体状态数据，按要求保留。
- 字体与文案：使用现有中文字体与字号体系；“今日养生建议、立秋、宜/建议/少、AI 食物识别”形成清晰层级，文案全部围绕顺时饮食与养生，不使用健身目标导向表达。
- 间距与布局：建议区为单张 359 × 77 CSS px 横向卡片；节气说明和三条建议在同一背景上连续排布，没有独立缩略图或嵌套小卡。Banner 紧随其后，状态三卡仍保持原顺序。
- 颜色与视觉：建议卡复用水墨节气资产作为整卡背景，使用暖白半透明遮罩保证文字对比；Banner 使用独立浅绿色养生食物图，不再复用均衡模式深色活动图。
- 图片质量：养生 Banner 使用 1200 × 600、约 140KB 的本地 JPG，右侧食物清晰、左侧留白适合文案；水墨背景覆盖卡片内容区，边框造成的内边界差为 1 CSS px/侧，属于预期裁切。
- 交互：点击养生 Banner 成功打开现有记录菜单，沿用登录与记录逻辑；未新建虚假识别能力或新路由。

## Full-view comparison evidence

- 并排图显示参考与实现都采用“热量概览 → 养生提醒/建议 → 养生食物识别 → 身体状态”的阅读顺序。
- 实现保留项目现有热量主卡和三状态卡，属于用户要求的“其他不更改”；差异不构成功能或视觉回归。

## Focused-region comparison evidence

- 聚焦对比中，第一版参考的节气图仍是独立左侧块；最终实现把同一水墨视觉铺满整张卡片，并通过遮罩把标题、节气与三项建议融合为一个表面，符合用户最新纠正。
- 背景运行时尺寸为 357 × 75 CSS px，卡片为 359 × 77 CSS px，恰好扣除 1px 四周边框；不存在孤立的 `.wellness-daily-advice__season` 节点。

## Comparison history

1. 第一轮根据整体参考将节气图放在建议卡左侧，用户指出图片应作为卡片背景而非孤立元素。
2. 修复：删除节气缩略容器，把水墨图片改为绝对定位整卡背景，并增加全卡浅色遮罩与统一内容层。
3. 修复后证据：`/private/tmp/foodlink-wellness-advice-comparison.png` 显示整卡已经融合；运行时确认旧独立节点不存在。

## Runtime and static checks

- 养生模式旧 `.wellness-handbook-swiper` 不存在，均衡活动 Banner 未混入养生模式。
- 新 Banner 点击后 `.record-menu-modal` 正常出现。
- 微信开发者工具运行时异常：0 条。
- TypeScript、目标 ESLint、21 个 Jest 套件（78 条）与 `git diff --check` 通过。
- 删除两张养生功能卡后，编译产物中不再包含 `wellness-feature`、养生音乐、养生小运动、古琴舒缓或八段锦。微信开发者工具自动化重载连续遇到 `pageNotFound` 与响应超时，未生成新的删除后截图；前一版布局截图仅用于养生建议与 Banner 对比，不作为本次删除的运行时证据。

## Follow-up Polish

- P3：节气和建议当前仍是静态前端文案，后续接入日期、地区或天气数据后可动态生成，但不影响本轮布局和交互。

final result: passed

---

# 养生模式暖白主体与绿色导航配色 QA

- 初始色系参考：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-c6338865-e49a-41d1-8c96-2877f1e907a2.png`
- 用户留白纠正截图：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-6646251f-242d-4855-878d-aad284b64739.png`
- 最终实现截图：`/private/tmp/foodlink-home-wellness-light-body-green-nav-final.png`
- 最终并排对比：`/private/tmp/foodlink-wellness-light-palette-comparison.png`
- 均衡模式回归截图：`/private/tmp/foodlink-home-balanced-palette-regression.png`
- 验证环境：微信开发者工具模拟器，浅色主题，登录用户
- 视口与密度：页面内容约 390 × 753 CSS px；参考图 495 × 1067 px；最终实现 656 × 1418 px。并排对比将参考图等比关系归一为 656 × 1418 px，与实现同高同宽比较。

## Findings

- 无 P0/P1/P2 问题。
- 字体与层级：养生模式继续使用项目中文字体和既有字号；问候标题由金色改为深森林绿，暖白背景下对比清晰；正文使用灰绿与暖灰，没有因换色改变换行或截断。
- 间距与布局：日期、热量、建议、识别 Banner 和三状态卡的位置、圆角与间距保持原布局。删除的养生音乐/养生小运动未恢复。
- 颜色：按用户最新纠正，页面主体从整屏墨绿改为暖白—浅灰绿渐变；宠物和问候区保留大面积留白。深墨绿仅用于底部导航和 AI 识别 Banner，小面积森林绿用于日期选中态、进度和按钮；卡片统一暖米白并使用低饱和金色边框。
- 图片质量：水墨建议背景与养生食物 Banner 均继续使用清晰本地图片；主体变浅后图片边界和文字对比仍清晰，无透明边缘或错误裁切。
- 文案与功能：所有养生文案、体重/喝水/运动记录入口、识别入口和模式切换保持不变；只调整颜色作用域。

## Full-view comparison evidence

- 初始参考用深墨绿作为全屏底色；用户最新明确否定大面积深绿，因此最终实现有意改为暖白主体，只继承参考中的墨绿导航、暖米白卡片和金色边框体系。
- 最终并排图可见导航仍是完整深绿色，正文区域留白明显增加，宠物背景不再发绿；页面重点仍通过深绿选中日期和识别 Banner 建立。

## Focused-region comparison evidence

- 整屏对比已清楚覆盖顶部留白、全部卡片和底部导航，重要色面无需额外局部裁图。
- 微信开发者工具实测主体背景为暖白渐变 `#fbf8f0 → #eef2ed`；模式按钮为 88% 暖白；热量与日期卡保持米白/金色边框。

## Comparison history

1. 第一轮按原参考将养生模式整个页面和宠物背景改为深墨绿，并将底部导航同步改绿。
2. 用户指出整页绿色过深，只需要导航栏绿色，宠物背后等主体区域应留白。
3. 修复：主体改为暖白渐变，问候与模式按钮恢复深色文字/浅色表面；保留深绿底部导航、识别 Banner 和少量选中态。
4. 修复后证据：`/private/tmp/foodlink-home-wellness-light-body-green-nav-final.png`；运行时异常 0，均衡/养生双向切换后均能恢复各自配色。

## Runtime and static checks

- 养生根背景、日期卡、热量卡的运行时颜色与目标 token 一致。
- 从养生切到均衡后，均衡主页恢复原浅绿色背景和白色导航；再切回养生后暖白主体与墨绿导航恢复。
- 养生音乐/养生小运动卡片数量保持 0。
- 微信开发者工具运行时异常：0 条。
- TypeScript、目标 ESLint、custom-tab-bar JS 语法、78 条 Jest 与 `git diff --check` 通过。

## Follow-up Polish

- P3：微信开发者工具自定义导航样式下，顶部系统胶囊颜色由宿主管理；当前暖白主体保证黑色状态栏图标有足够对比，不影响底部导航配色。

final result: passed

---

# 首页养生模式设计 QA

- 源视觉真值：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-0eed55da-0f8f-41b2-9f9d-07d4bcd20269.png`
- 顶部实现截图：`/private/tmp/foodlink-home-wellness-final-v2.png`
- 下半屏实现截图：`/private/tmp/foodlink-home-wellness-lower-final-v3.png`
- Banner 与中下部实现截图：`/private/tmp/foodlink-home-wellness-banner-switch-final.png`
- 双向箭头切换截图：`/private/tmp/foodlink-home-wellness-switch-arrow-final.png`
- 三身体状态卡最终截图：`/private/tmp/foodlink-home-wellness-three-status-cards-final.png`
- 均衡模式回归截图：`/private/tmp/foodlink-home-balanced-final.png`
- 并排对比图：`/private/tmp/foodlink-wellness-design-comparison-final.png`
- 验证环境：微信开发者工具模拟器，浅色主题，同一登录用户；页面内容视口约 390 × 753 CSS px
- 源图尺寸：906 × 1260 px；实现截图：656 × 1418 px；对比时三张图统一缩放至 1246 px 高并横向拼接，未改变宽高比
- 页面状态：养生模式、当日无饮食记录；源图为已有饮食数据，因此空态文案属于真实数据差异，不作为视觉偏差

## Findings

- 无 P0/P1/P2 问题。
- 信息架构：按用户最新指定，养生模式顺序改为“热量与三大营养 → 活动 Banner → 体重/喝水/运动 → 今日养生建议 → 养生音乐/小运动”；均衡模式仍是独立的原有内容树。
- 字体：标题、正文、辅助信息和关键数字沿用首页现有中文系统字体与四级字号体系；关键热量数字保留数据强调级，不新增零散字号。
- 间距：卡片使用 20rpx 纵向节奏、24–26rpx 内边距和 30rpx 圆角；三餐行、建议胶囊与双功能卡均未发生挤压、重叠或横向溢出。
- 颜色：采用参考图的暖白表面、浅鼠尾草绿进度和低饱和语义色；营养图标继续沿用均衡模式的蓝/黄/橙语义，不造成两套数据含义冲突。
- 图片：节气卡使用独立生成并压缩的水墨插画 `apps/wechat/src/assets/wellness/solar-term-autumn.jpg`；三餐有真实图片时继续展示用户记录图片，无记录时使用项目 iconfont，不伪造食物照片。
- 文案：养生模式不再显示“今日食物记录”、早餐、午餐、晚餐或拍照识别；音乐未接业务页，点击明确提示“即将上线”。

## Full-view comparison evidence

- 并排图左侧为源图，中间为实现首屏，右侧为实现下半屏。热量半环、横向三大营养、浅绿建议条、三餐列表、水墨节气卡及双功能卡的区域顺序和视觉权重与源图一致。
- 实现保留 FoodLink 原有问候区、日期选择器、悬浮宠物和底部 TabBar，这是现有产品基础设施，不是参考图内容的错误复刻。
- 右上模式切换按钮位于宠物下方且可见；进入养生模式后宠物强制使用缩小视觉态，滚动时不再大面积遮住卡片，切回均衡模式仍恢复用户原宠物状态。
- 养生模式活动 Banner 位于热量主卡与今日食物记录之间，复用真实活动数据、轮播尺寸、图片和整卡点击行为，不重复制造一套活动配置。

## Focused-region comparison evidence

- 热量区：半环、剩余值、已摄入/目标、总进度条和三大营养在同一卡片内，层级与源图一致。
- 身体记录区：与均衡模式共用同一份三卡 JSX，体重、喝水、运动的数值、单位、辅助信息、点击与长按处理完全一致。
- 建议区：水墨节气插画占左侧主视觉，饮食/运动/作息三个胶囊在右侧；下方音乐和小运动为两张等宽卡片。

## Interaction and runtime checks

- 点击模式切换：均衡模式 `.balanced-home-content` 与养生模式 `.wellness-home-content` 互斥，切换后按钮文案同步变化并本地记忆选择。
- 模式按钮实测仅显示 `⇄` 与目标模式文字，旧 `.home-mode-switch .iconfont` 不存在；双向切换后的文字分别为“均衡模式”和“养生模式”。
- 养生模式 `.wellness-handbook-swiper` 存在并位于三张身体状态卡之前，使用与均衡模式相同的活动数据与轮播状态。
- 点击养生模式当前可见 Banner，成功进入 `packageExtra/pages/goose-duck-chicken/index` 并返回，证明整卡活动入口未因复用位置失效。
- 最终截图确认 Banner 后直接显示体重、喝水、运动三张 `.body-status-card`，旧 `.wellness-food-card` 和三餐列表不再渲染。
- 均衡模式回归：`.combined-card`、活动 Banner 和 3 张 `.body-status-card` 均存在，原功能树未删除。
- 点击“拍照识别”：成功打开原 `.record-menu-modal`，关闭正常。
- 点击“养生小运动”：成功进入 `packageExtra/pages/exercise-record/index` 并可返回。
- 养生音乐：点击显示“养生音乐即将上线”，没有伪造不存在的播放能力。
- 微信开发者工具运行时异常：0 条。
- TypeScript、目标 ESLint、21 个 Jest 套件（78 条）与 `git diff --check` 通过。

## Comparison history

1. 第一轮实现完整还原卡片结构，但原有展开态悬浮宠物会遮住模式切换按钮和滚动后的热量内容。
2. 修复：模式按钮改为独立右对齐行；养生模式将宠物切为不改变持久状态的视觉收起态，并缩放为 62%。
3. 修复后证据：最终顶部和下半屏截图中按钮清晰可点，宠物渲染约 51 CSS px，不再形成大面积遮挡；运行时异常仍为 0。
4. 用户要求取消养生模式三餐列表；修复为两种模式共用 `bodyStatusCards`，并删除养生三餐 JSX、派生数据和废弃样式。最终截图显示 Banner 下方为三张独立状态卡。

## Follow-up Polish

- P3：节气、宜食和作息文案当前为前端静态内容；若后续接入日期/天气/地区服务，可改为每日动态建议，但不影响本轮双模式界面和现有数据功能。

final result: passed

---

# 宠物主页卡片精简设计 QA

- 源视觉真值：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-2f39bf28-9a30-4b3e-ab7d-ba367dadbe6f.png`
- 领取前截图：`/private/tmp/foodlink-pet-home-reward-before.png`
- 领取后截图：`/private/tmp/foodlink-pet-home-reward-after.png`
- 经验条参考图：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-29a9acf1-1ad0-4335-be6e-f0e2df365f59.png`
- 经验条实现截图：`/private/tmp/foodlink-pet-home-level-bar.png`
- 经验条聚焦对比：`/private/tmp/foodlink-pet-level-bar-comparison.png`
- 大头像参考图：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-e04e8581-9b16-4718-ae3c-dc59187429b8.png`
- 大头像实现截图：`/private/tmp/foodlink-pet-home-large-avatar.png`
- 大头像聚焦对比：`/private/tmp/foodlink-pet-large-avatar-comparison.png`
- 等级泡泡最终截图：`/private/tmp/foodlink-pet-home-level-bubble.png`
- 名称在上最终截图：`/private/tmp/foodlink-pet-home-name-above-exp.png`
- 成长融合最终截图：`/private/tmp/foodlink-pet-home-growth-merged.png`
- 外观换装三项截图：`/private/tmp/foodlink-pet-home-outfit-three-items.png`
- 并排对比图：`/private/tmp/foodlink-pet-home-local-comparison.png`
- 验证环境：微信开发者工具模拟器，浅色主题，同一登录用户

## Findings

- 无 P0/P1/P2 问题。
- 信息架构：删除“为什么是它”“今日状态”“外观试验箱”和独立“离线小惊喜”卡片；保留“常用形象”“成长进度”和“外观换装”。离线经验领取并入首卡，页面由解释型信息转为形象、成长和换装三个可操作区域。
- 首卡：顶部改为连续的“Lv.1 + 经验进度条 + 当前/下级经验值”结构，经验不再作为头像旁的独立泡泡；头像只保留积分泡泡。宠物名称与中性箭头位于右侧，整行继续作为对话入口；存在未领取事件时，在名称下方显示“领取 +N 经验”轻量按钮。
- 尺寸与间距：首卡最小高度由 246rpx 收紧为 212rpx，头像由 188rpx 收紧为 166rpx；头像信息区与右侧名称之间保持清晰分栏，没有恢复嵌套对话卡。
- 颜色与图标：继续使用现有暖白表面、薄荷绿数据色和项目 iconfont；没有新增图片、Emoji、自绘 SVG 或占位资源。
- 保留功能：常用形象选择、成长进度、离线经验领取、专属像素分身、首页悬浮宠物、随机换外观和挑选外观均继续存在；仅移动领取入口，没有改写后端领取逻辑。

## Runtime checks

- 页面卡片标题实测为：常用形象、成长进度、外观换装。
- `.pet-home-reason-list`、`.pet-home-score-grid`、`.pet-home-inline-action.lab` 均不存在。
- 领取前经验泡泡为“经验 20”，按钮为“领取 +16 经验”；点击后经验变为 36，成长进度同步变为 36/100，领取按钮消失。
- 最终经验条实测文案为“Lv.1  36 / 100 经验值”，进度条宽度 196.594 CSS px；旧 `.pet-home-stage-stat--exp` 不存在。
- 首卡 `background-image` 为 `none`，未增加参考图中的草地/装饰背景；卡片内部未增加三点菜单。
- 第二轮布局将宠物头像放大至 216rpx，运行时为 112 × 112 CSS px；头像距首卡内容顶部约 21 CSS px，并占据左侧 135 × 118 CSS px 舞台。
- 经验条收进右侧 202 CSS px 宽区域，文案精简为“Lv.1  36 / 100”，不再显示“经验值”三个字；名称保持在经验条下方右对齐。
- 最终将 Lv.1 从经验条移到人物左上方，复用与“积分 42”一致的 `.pet-home-stage-stat` 泡泡结构；运行时等级泡泡 52 × 21 CSS px、积分泡泡 45 × 21 CSS px。右侧经验条只显示“36 / 100”，不再渲染 `.pet-home-level-badge`。
- 名称与经验条最终交换顺序：运行时名称顶部偏移 23 CSS px、经验条顶部偏移 76 CSS px，确认“水滴汤圆 ›”位于经验进度上方；点击“专属像素分身”成功打开可编辑取名弹窗并可取消，异常 0。
- 独立“成长进度”卡最终删除；页面卡片标题只剩“常用形象、外观换装”。陪伴天数改为人物周围同体系泡泡，运行时为“陪伴 3天”、50 × 21 CSS px。
- 首卡底部使用左右对齐的“升级到 Lv.2 / 36 / 100”说明和全宽进度条，运行时区域 343 × 35 CSS px，明确进度条用于等级升级，不再重复展示总经验和距升级数据卡。
- 外观换装最终只保留“专属像素分身、首页悬浮宠物、随机换外观”3 项；“挑选外观”和对应即将开放样式均已删除，开发者工具运行时确认 3 项且异常 0。
- 点击 `.pet-home-name-link` 成功进入 `packageExtra/pages/pet-chat/index`，返回正常。
- 微信开发者工具运行时异常：0 条。
- TypeScript、目标 ESLint、21 个 Jest 套件（78 条）与 `git diff --check` 通过。

## Follow-up Polish

- 无阻塞项。外观换装卡片内容较长，但可自然向下滚动，底部未出现被试验箱占据的冗余调试区。

final result: passed

---

# 宠物名称箭头入口设计 QA

- 源视觉真值：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-ab545de5-e66a-45c8-9c9f-428727e9be12.png`
- 实现截图：`/private/tmp/foodlink-pet-name-arrow-final.png`
- 聚焦实现截图：`/private/tmp/foodlink-pet-name-arrow-focus.png`
- 并排对比图：`/private/tmp/foodlink-pet-name-arrow-comparison.png`
- 验证环境：微信开发者工具模拟器，页面内容视口约 390 × 753 CSS px；完整截图 656 × 1418 px
- 源图像尺寸：666 × 260 px；实现聚焦图尺寸：656 × 256 px
- 密度归一：源图缩放至 656 × 256 px；实现截图裁取同一首卡区域为 656 × 256 px，再横向合并比较
- 页面状态：同一登录用户、浅色主题、宠物主页默认态

## Findings

- 无 P0/P1/P2 问题。
- 信息架构：首卡不再显示绿色“和它聊聊”卡片、聊天图标、入口标题或说明；对话能力收敛为宠物名称右侧的单个箭头。
- 字体：宠物名称继续使用页面强调字号 36rpx 和既有中文系统字体；删除入口两档附加字号后，首卡层级更单纯。
- 间距：箭头与宠物名称使用 10rpx 间距并共同居中，名称或箭头均可点击；88rpx 隐形点击高度不增加可见背景、边框或卡片轮廓。
- 颜色：名称保持主文字色，箭头使用中性灰；入口没有绿色背景、绿色描边或额外阴影，不与积分胶囊产生视觉竞争。
- 图标与图片：宠物头像与三项状态胶囊保持不变；箭头复用项目 iconfont，没有新增图片、Emoji、自绘 SVG 或占位资源。
- 文案：删除“和它聊聊”“饮食与训练分析”两行入口文案；其余宠物名称、等级、积分、今日经验和页面内容不变。

## Full-view comparison evidence

- 并排图左侧为修改前源图，右侧为最终实现。右侧绿色入口卡完全消失，仅在“水滴汤圆”右侧保留紧邻箭头。
- 首卡白色表面保持统一，不再出现内部第二层有色卡片；宠物头像、等级、积分和今日经验的位置未被破坏。
- 删除入口卡后首卡留白更自然，下面“为什么是它”等模块仍保持原布局。

## Focused-region comparison evidence

- 1312 × 256 px 聚焦并排图可直接判断名称、箭头、头像和三个状态胶囊的位置，无需额外放大。
- 右侧实现未出现残留边框、绿色背景、聊天图标或两行聊天说明。

## Interaction and runtime checks

- `.pet-home-chat-entry` 确认不存在，`.pet-home-name-arrow` 确认存在。
- 点击 `.pet-home-name-link` 成功进入 `packageExtra/pages/pet-chat/index`；返回后仍停留在宠物主页。
- 微信开发者工具运行时错误日志：0 条。
- TypeScript、目标 ESLint 与 `git diff --check` 通过。

## Comparison history

1. 修改前宠物名称下方存在有背景、描边、聊天图标和两行文字的独立入口，视觉上形成嵌套卡片。
2. 修复：删除入口内容与全部有色卡样式，将点击事件移动到“宠物名称 + 右箭头”行。
3. 修复后证据：`/private/tmp/foodlink-pet-name-arrow-final.png` 与并排对比图显示入口已完全扁平化；点击跳转正常，运行时错误 0。

## Follow-up Polish

- 无阻塞项。P3：名称特别长时继续使用现有省略号策略，箭头会保持可见。

final result: passed

---

# 养生模式日期栏去金色外环设计 QA

- 源截图：`/var/folders/dl/j1hxj3fs3czd7lt458p170t80000gn/T/codex-clipboard-f41cabf9-a1de-438a-bfce-28a3e81befc5.png`
- 实现截图：`/private/tmp/foodlink-home-wellness-date-no-gold-ring-final.png`
- 验证环境：微信开发者工具模拟器，首页养生模式，浅色主题

## Findings

- 删除日期栏原有的金色实线描边与 5rpx 金色外圈，不再用边框、外环、渐变和重阴影同时强调同一组件。
- 日期栏改为暖白单一表面、8% 低对比森林绿边界和 10% 中性阴影；日期选中胶囊继续承担主要状态强调。
- 五秒视觉顺序恢复为问候 → 日期选择 → 热量主卡，日期容器不再与热量数据争夺焦点。
- 页面没有文字重叠、裁切或状态泄漏；微信开发者工具运行时错误为 0。
- TypeScript、目标 ESLint、21 个 Jest 套件（78 条）与 `git diff --check` 通过。

final result: passed

---

# 养生模式全局导航保持设计 QA

- “分析”截图：`/private/tmp/foodlink-wellness-global-nav-stats-final.png`
- “圈子”截图：`/private/tmp/foodlink-wellness-global-nav-community-final.png`
- “我的”截图：`/private/tmp/foodlink-wellness-global-nav-profile-final.png`
- 验证环境：微信开发者工具模拟器，`home_display_mode_v1=wellness`

## Findings

- 养生模式的深墨绿底部导航已从首页局部状态改为全局持久化状态，跨 Tab 不再闪回白色。
- 分析、圈子、我的页面主体继续使用各自原配色，仅底部导航延续养生主题，避免整页主题污染。
- 三个页面的当前 Tab 均使用暖金色选中态，未选 Tab 保持低对比灰绿色；中间拍照按钮保持暖米白表面与森林绿图标。
- 微信开发者工具依次完成首页 → 我的 → 分析 → 圈子 → 我的导航检查，运行时错误为 0。
- 自定义 TabBar JS 语法、TypeScript、21 个 Jest 套件（78 条）与 `git diff --check` 通过。

final result: passed
