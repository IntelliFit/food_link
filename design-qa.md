# 首页卡路里卡与内容 Banner 设计 QA

- 参考效果图：`/Users/ashley/.codex/generated_images/019fbc5e-e05f-7e60-a1bb-f7bbc7adb75e/exec-d20978cd-0c33-438f-b98b-f2364b4990b1.png`
- 实现截图：`/private/tmp/foodlink-home-banner-final.png`
- 滑动后截图：`/private/tmp/foodlink-home-banner-swiped.png`
- 并排对比图：`/private/tmp/foodlink-home-design-qa-comparison.png`
- 验证环境：微信开发者工具模拟器，656 × 1418 px，首页已登录默认态

## 检查结果

- 信息顺序符合确认稿：日期选择器 → 白底热量主卡 → 横向可滑 Banner → 今日记录。
- 热量主卡保持白底，只增加轻绿色描边与弱绿色外沿光，不使用绿色填充。
- Banner 显示下一张卡片边缘，自动轮播与手动 `swipeTo` 均可切换。
- 按用户最新纠正保留原有业务内容：鹅鸭鸡识别、动态赚积分、校园活动、意见反馈；未替换为新的 AI 手册文案。
- 新增“赚积分”和“意见反馈”主题配图；鹅鸭鸡、校园活动继续使用项目既有内容配图。
- 按用户复核意见，赚积分配图已改为纯静物插画，仅使用金币、勾选、健康餐、水杯和运动器材，不包含真人或人物形象。
- 按用户截图复核意见，四张 Banner 顶部辅助小标题全部删除，主标题、说明和操作入口整体上移；开发者工具检查 `.home-handbook-card__kicker` 数量为 0。
- 独立“今天吃什么”卡片已移除；右上角宠物代码、位置和交互未修改。
- 自动化点击首张 Banner 后进入 `packageExtra/pages/goose-duck-chicken/index`，运行时异常为 0。
- 替换积分图后再次在微信开发者工具切换至“今天还可以赚 3 积分”，截图确认无真人元素，运行时异常为 0。
- 删除小标题后再次截图 `/private/tmp/foodlink-home-banner-no-kicker.png`，四张卡片均无顶部辅助行，积分卡主体文案无裁切，运行时异常为 0。
- 与效果图的可见差异为有意保留：按用户要求不改宠物；按用户最新要求沿用现有 Banner 业务文案；热量区沿用项目既定四档字号和现有营养展开交互。

final result: passed
