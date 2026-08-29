# 高优先标准食物生成图

2026-08-22 通过 Codex 内置 imagegen 生成，用于网络候选因水印、匹配度或二次下载失败而无法安全回填的高优先标准食物。仓库保留 512×512 PNG 源图，正式访问使用 COS/CDN 中的对象。

| 文件 | 标准食物 | food_id |
|---|---|---|
| `hamburger.png` | 汉堡 | `5e084546-eea9-4068-a1ef-1c9ebabdd125` |
| `bell-peppers.png` | 彩椒 | `e18c5ee5-536a-4086-ad1b-8282ad663e91` |
| `chocolate.png` | 巧克力 | `42b49fc7-a7c0-4077-b423-84eabd951d78` |
| `mixed-vegetables.png` | 混合蔬菜 | `71caf7b9-23ca-41c2-b4f2-bf280ae95b96` |
| `cooked-lean-pork.png` | 瘦猪肉(熟) | `dd06241e-63b4-4c30-81fa-2a481a06cae3` |
| `plums.png` | 李子 | `ee1a2c40-0da6-49fe-a1d3-fabc0d29c7db` |
| `tofu-pudding.png` | 豆花 | `0c54e135-2c77-4727-8e06-d231e1e0d403` |
| `cooked-rice-noodles.png` | 米粉(熟) | `dc46704e-783b-4fee-bbb0-6c156a6df9d6` |
| `ham-cheese-sandwich.png` | 三明治(夹火腿、干酪) | `138105db-bfb9-4629-8947-a9e85b718e46` |
| `protein-shake.png` | 蛋白粉摇摇杯饮料 | `adeaad84-8778-4224-8648-2ea6306f4d54` |
| `lychee-flesh.png` | 荔枝(净肉) | `eb2701b1-1688-42f4-82df-2bf1136461b0` |

## 通用提示词

```text
Use case: product-mockup
Asset type: standard food library square thumbnail
Primary request: Create a photorealistic catalog food photograph for “<食物名>”.
Scene/backdrop: clean warm off-white tabletop, subtle neutral background.
Style/medium: realistic commercial food photography, natural texture, appetizing but truthful.
Composition/framing: square, food centered, medium close-up, enough margin for rounded-square and circular cropping.
Lighting/mood: soft diffused daylight, gentle shadow.
Constraints: one clear food subject; no people; no text; no logos; no brand marks; no watermark; no collage; no frame.
```

每张图另在 `Subject` 中写明食物的具体食材、熟制状态或切面要求。
