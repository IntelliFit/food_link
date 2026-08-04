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
