# 宠物成长与湖畔冒险素材

生成方式：内置 `image_gen`，使用 `imagegen` 技能。未使用 API/CLI；没有重绘原宠物角色。美术风格参考现有 `docs/design/pet-studio-20261001/reference.png` 与 `warm-room-v1.jpg` 的暖木、湖畔、奶油色与鼠尾草绿。

## 最终交付

| 文件（相对仓库根目录） | 尺寸 | 大小 | 用途 |
| --- | --- | --- | --- |
| apps/wechat/src/packagePetStudio/assets/adventure-lake-v1.jpg | 720 × 1279 | 198,843 bytes | 三条清晰跑道的纵版湖畔冒险背景 |
| apps/wechat/src/packagePetStudio/assets/growth-room-v1.jpg | 1100 × 825 | 211,251 bytes | 原生 4:3 成长小屋背景，中央宠物台和三处家具空间 |
| apps/wechat/src/packagePetStudio/assets/adventure-props-v1.png | 1024 × 768 | 76,541 bytes | 真透明 4 × 3 道具图集，每格 256 × 256 |
| apps/wechat/src/packagePetStudio/assets/explorer-scarf-v1.png | 134 × 160 | 36,039 bytes | 真透明金芥末色短围巾 |

背景经 Sharp 等比缩小与 JPEG 压缩；图集等比缩小到 1024 × 768 后以透明调色板 PNG 压缩。围巾仅裁掉外部透明留白、等比缩小并增加 8 px 透明外边距，本体未被重绘或变形。生成原件保留在 Codex generated_images。纵版小屋草稿未交付，已通过图像工具重新构图为 4:3。

## 图集坐标与检查

列中心 x：128 / 384 / 640 / 896；行中心 y：128 / 384 / 640。原始图 1448 × 1086，各格 362 × 362。压缩后保持严格 4:3 与均等方格。

| 行 / 列（从 0 开始） | 物件 | 格内可见 alpha ≥ 32 的边界 [左, 上, 右, 下] |
| --- | --- | --- |
| 0 / 0 | 露叶 | [69, 84, 191, 209] |
| 0 / 1 | 金星 | [68, 88, 192, 205] |
| 0 / 2 | 岩石 | [68, 103, 194, 206] |
| 0 / 3 | 树桩 | [51, 94, 199, 210] |
| 1 / 0 | 盆栽 | [63, 57, 205, 200] |
| 1 / 1 | 提灯 | [87, 49, 175, 203] |
| 1 / 2 | 陶杯与书 | [59, 79, 196, 200] |
| 1 / 3 | 相框 | [64, 71, 192, 194] |
| 2 / 0 | 薄荷滑板 | [63, 51, 201, 170] |
| 2 / 1 | 橙金滑板 | [62, 51, 202, 172] |
| 2 / 2 | 湖岸徽章 | [71, 51, 188, 168] |
| 2 / 3 | 小水坑 | [54, 72, 204, 160] |

12 格均有完整物件，没有可见物件触碰格边；最小边距 45 px（约 17.6%），通过 12% 留白要求。每个可见物件的实际包围盒中心与格中心有小幅差异，尤其第一行向下约 18–27 px、第三行向上约 12–19 px；不得将这份检查误称为像素级完全居中。需要严格碰撞中心时，渲染层按上述包围盒中心补偿。背景位置：`background-size: 400% 300%`；列位置 `0 / 33.333% / 66.667% / 100%`，行位置 `0 / 50% / 100%`。

在工具输出与最终 PNG 上已查看角色缺失、构图、透明性及道具完整性；这份素材检查不代表原生游戏截图验收。

## 最终提示词与编辑记录

### 湖畔冒险背景

```text
Use case: stylized-concept
Asset type: production background for a portrait mobile pet adventure game, one single illustration, 9:16 portrait.
Primary request: a beautiful warm lakeside woodland path, suitable for a collectible pet adventure game.
Style/medium: polished storybook gouache blended with soft 2.5D miniature game-environment rendering, rich painterly details, softly rounded yet tasteful, high quality warm cozy game art. Match honey colored wood, soft sage plants, white wildflowers, blue lake and sunlit lakeside village atmosphere of a cozy French-window cottage.
Scene/backdrop: daytime blue lake alongside a woodland promenade, willow leaves framing upper corners, cream daisies and wildflowers only at the sides, stone bridge far in the upper third, distant small lakeside village and forested mountains.
Composition/framing: fixed portrait view, three broad clear runner lanes of a warm pale sandstone path fill the entire foreground bottom edge and continue straight toward a centered horizon at approximately 30 percent from the top. The path takes at least 75 percent of the image width in the bottom half. Three soft evenly spaced parallel lane seams make lane alignment readable but are not sharp painted road markings. The runner needs a very clear unobstructed center and bottom; no foreground props, no bend, no stairs. Beautiful scenery remains beside the path and beyond horizon.
Lighting/mood: gentle warm morning sunlight, sparkling inviting lake, joyful and peaceful exploration.
Color palette: creamy sandstone, honey sunlight, sage and leaf greens, soft sky blue and aquamarine water.
Constraints: scenery background only. NO characters, NO animals, NO collectible items, NO obstacles on path, NO signs, NO letters, NO UI, NO frames, NO logos, NO watermark. Path remains clear from bottom to horizon. Produce exactly one full-bleed portrait image, not a collage.
```

### 成长小屋（最终 4:3 重构）

```text
Use case: precise-object-edit
Asset type: full-bleed production background for a customizable pet home mobile game, ONE landscape image, 4:3 aspect ratio.
Input image: reference to retain the room's sunlit honey timber, cream curtains, blue lakeside village, flowers and gentle painterly game style.
Primary request: RECOMPOSE the illustrated cottage to a landscape 4:3 canvas for a 359 by 291 pixel game stage, not a crop of the portrait. Preserve the same warm cozy atmosphere and materials. The French window and distant lake occupy the top half. Lower half contains broad empty wooden floor with a small low round wood platform centered at approximately 62 percent of the height. Architecture at upper corners, tiny vines at far edges.
Composition constraints: explicitly use a 4:3 WIDE canvas; show more width of the interior. The entire bottom half and the floor areas left and right of the central pet platform must be open and EMPTY, ready for three separately rendered earned furniture slots. Do not place furniture in slot areas. Keep the central platform small enough to leave open floor to both sides and below it.
Keep: original quality, colors, light, window detail, lake and cottage character.
Avoid: characters, pets, UI, any text or logos, furniture, extra platforms, cropped corners, collage or borders.
Output one image only.
```

### 道具图集：初始生成

```text
Use case: stylized-concept
Asset type: ONE transparent PNG game sprite atlas, 4 equal columns by 3 equal rows, landscape 4:3 canvas.
Primary request: create 12 separate polished cozy adventure-game object sprites. Use a truly TRANSPARENT background. Each object is centered in its exact equal grid cell, never touches another cell, and fits inside 76 percent of that cell in both dimensions (12 percent or more empty margin all sides). No visible grid, no border, no text. All objects separate with clean alpha edges and consistent sunlit warm painterly soft-2.5D miniature game art, readable silhouette at 40 pixels. 1024 by 768 or 1536 by 1152 canvas if possible.
Row 1, left to right: [1] a luminous sage-green dew leaf collectible with one dewdrop; [2] a rounded golden five-point star collectible; [3] a small gray slate rock obstacle; [4] a small warm brown cut tree stump obstacle.
Row 2, left to right: [5] a leafy houseplant in a terracotta flowerpot; [6] a small cozy brass lantern with warm golden light; [7] a small cream ceramic mug beside two stacked teal and tan books, treated as one furniture object; [8] a miniature honey-wood picture frame with an abstract painted blue lake and sage hill, no letters.
Row 3, left to right: [9] a mint-green skateboard seen from slight overhead 3/4 view with visible small wheels, deck extends diagonally left-up to right-down; [10] a warm orange-gold skateboard in the same pose; [11] a small collectible round lakeshore badge enamel pin with a blue lake and green hill, no writing; [12] a shallow small aqua-blue puddle, seen from an overhead 3/4 view, suitable as a path hazard.
Critical composition: atlas has EXACTLY twelve equally spaced objects in a 4 by 3 row-column grid. Every sprite's center coincides with its cell center. Same amount of empty transparent margins. Each cell contains only the requested item, not a card or a circular backdrop. Do not add characters or extra objects. No floor surface, no baked shadow stretching to other cells, no mockup, no words, no logo, no watermark.
```

### 道具图集：缩小与居中编辑

```text
Use case: precise-object-edit
Asset type: one transparent game sprite atlas, same 4:3 landscape aspect and same exact 4 equal columns by 3 equal rows.
Input image: edit this atlas. Preserve all twelve object designs, colors and art style exactly.
Change ONLY each object's scale and placement: make every object about 20 percent smaller than in the reference, then CENTER its visible object bounding box on the exact center of its equal square cell. Every object must have at least 16 percent transparent margin to all four edges of its cell, without extending or cropping. This means that the plant, stumps, and skateboards also shrink to fit. Keep image a true transparent PNG, no checkerboard baked in.
Exact grid: 4 columns and 3 rows; object centers at x12.5%,37.5%,62.5%,87.5% and y16.667%,50%,83.333%. All twelve objects must be complete and isolated.
Row 1 leaf / gold star / rock / tree stump.
Row 2 plant / golden lantern / cup with two books / lake picture frame.
Row 3 mint skateboard / orange skateboard / lake badge / water puddle.
Constraints: do not change, add, remove, repaint or reorder the objects. Do not add any character, text, floor, backdrop, visible grid or cards. Transparent empty cell margins are essential. Exactly one atlas, no collage of alternate views.
```

### 道具图集：透明区清理编辑

```text
Use case: background-extraction
Asset type: EXACT SAME twelve-object 4-column by 3-row transparent game sprite atlas, same image proportions.
Input image: the edit target. Keep all twelve sprites at the same sizes, positions, row/column order, colors and details.
Primary request: clean the alpha transparency for production use. REMOVE all scattered speckles, flecks, stray ghost pixels and colored noise outside the main objects. Everything outside the twelve intact object silhouettes must be perfectly completely TRANSPARENT, alpha zero, with no stray marks. Each intact object keeps crisp antialiased edges. Preserve the open transparent centers where appropriate, including lantern handle and skateboard wheel gaps.
Keep: the same twelve leaf, star, rock, stump, plant, lantern, mug/books, frame, two skateboards, badge and puddle. Keep exact 4 by 3 grid and large cell margins. Do not repaint or enlarge, move, add or crop any main sprite.
Constraints: one full atlas image, true alpha transparency. No background color or checkerboard, no shadow background, no grid, no words, no extra ornaments. Clean isolated cutout sprites only.
```

### 探索围巾

```text
Use case: stylized-concept
Asset type: one small transparent PNG accessory to overlay on an existing pet avatar; no character drawn.
Primary request: a warm golden-mustard short knitted explorer scarf, isolated on a genuinely transparent background. This is a wearable accessory for an existing pixel-style glasses-wearing pet, rendered as a small chest/neck overlay at roughly 28 by 32 pixels.
Style: crisp clean silhouette with simplified tactile knitted wool detail, soft cozy warm game art, match a polished red wool scarf game accessory but golden mustard. Compact single loop round collar at the top, short ends hanging down at center; tiny tassels, consistent soft warm light. Front-facing upright.
Composition: scarf only, centered, fits a tall narrow rectangle about 7:8 aspect, around 75 percent height of canvas; no extra object, no mannequin, no head or body, no shadow backdrop. Neck opening is transparent. Leave comfortable transparent margins all around. Short ends do not hang farther than the accessory's own height. No trailing long ribbon.
Constraints: do not create or alter any pet or character. No face, human, animal, UI, text, logo, watermark, grid or border. Genuine alpha transparency.
```

## 原件来源

内置工具原件目录：`C:/Users/Oscar/.codex/generated_images/01a0f7ae-eaab-73c1-b631-0d04610a5edf`。

- 湖畔：`exec-f840499f-09d8-4e83-a0de-d3464cb011a1.png`。
- 小屋最终横版：`exec-13e50d59-ecbf-43c4-b357-8f73f6fc0eea.png`。
- 图集最终清理：`exec-55e06317-2af1-45dd-8c5f-0920f062b959.png`。
- 围巾：`exec-4db79e84-9615-4294-84e1-9a5c5ced4416.png`。
