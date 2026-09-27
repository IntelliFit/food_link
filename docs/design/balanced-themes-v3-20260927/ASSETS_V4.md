# 均衡主题实装素材 V4

生成方式：内置 image_gen；以本目录各主题的 four-surfaces-v3.png 为视觉参考。原始输出保留在本机 Codex generated_images 中，项目交付文件位于 `apps/wechat/src/packageThemeScenes/assets/`。所有图片都只包含场景与食物，界面标题、按钮和用户数据由组件实时绘制。

| 文件 | 提示词摘要与用途 |
| --- | --- |
| miniature-garden-v4.webp | Portrait 2:3, photoreal handcrafted miniature edible garden. Detailed glass greenhouse, tiny adult visitors, produce stalls, turquoise brook, limestone bridge, warm natural morning light, no signs/text/UI. 首页花园；分析章节场景。 |
| miniature-desk-v4.webp | Landscape 3:2, photoreal miniature botanist writing desk. Blank leather journal, pressed leaves, warm brass lantern, little field drawers, natural sunlight, no text/UI. 我的旅行档案。 |
| miniature-square-v4.webp | Landscape 3:2, detailed miniature village plaza. Adults sharing lunch under trees, farmers market, stone paving, tiny balconies, golden light, no text/UI. 圈子邻里广场。 |
| picturebook-day-v4.webp | Portrait 2:3, sophisticated literary painterly art, midnight teal and warm gold, subtle grain. Three vertically connected scenes: man and cat preparing breakfast, noon street, evening balcony. No text/UI. 绘本首页晨昏三幕。 |
| picturebook-desk-v4.webp | Landscape 3:2, cinematic literary illustration, lamplit desk, sleeping tabby, night city window, blank journal, pen and coffee, no text/UI. 绘本内页章节。 |
| water-vessel-v4.webp | Portrait 2:3, photoreal sculptural transparent water droplet enclosing a salmon dish on dark basalt, liquid refraction, calm silver caustics, midnight black-blue, restrained orange reflection, no UI/text. 水之道主视觉。 |
| natural-leaves-v4.webp | Portrait 2:3, fine botanical mixed media, real translucent leaf veins and white wildflowers on cream fibrous paper, muted blue-grey paper, quiet cream negative spaces, no text/UI. 自然主题叶脉纸笺。 |
| eastern-soup-v4.webp | Landscape 4:3, refined Song-inspired celadon chicken/yam/lily soup bowl, wooden table, tea cup, blossom branch, soft window light, no text/UI. 东方卷轴内食物灵感。 |
| gallery-collage-v4.webp | Portrait 2:3, tactile torn ivory paper and black ink, vermilion/cobalt/yellow fragments, plaster sculpture fragment, photoreal herb roast chicken bowl, no text/UI. 现代艺廊首页拼贴。 |

压缩：Sharp 等比缩至 750 px 宽、WebP quality 72，未裁切为假界面或把用户数据烘焙进图片。资源包约 991 KB；主包仅保存路径，使用微信分包异步 require 加载 ready.js 后展示图片。接口或资源不可用时保留真实业务入口并允许重试。

原有澄明沙拉、东方山水继续使用；澄明、东方、艺廊的食物主图标注为灵感，水滴中的餐食用于装饰雕塑，均不冒充用户上传记录。
