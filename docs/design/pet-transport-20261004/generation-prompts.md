# 出行素材生成提示记录

模式：内置 image_gen；透明背景；每个角色使用自己已有的动作图集作为唯一身份参考。没有更换生成 API、上传用户照片或调用即梦视频服务。

以下是太极小子、小麦和豆豆生成时共同使用的主体提示；每次再附上对应角色的脸、发型、服装和完整肢体要求。前三个角色遵循同样的构图与动作约束，但本记录不把摘要冒充逐字调用日志。

```text
Use case: identity-preserve. Production pet transport sprite sheet for 食探. Use the attached image as the ONLY character identity and visual style reference. Preserve exact face, hairstyle, proportions, outfit and warm game rendering. Square 2x2 grid on real transparent background. Each cell contains ONE complete rider with complete transport, facing right, 10% transparent margin, no ground/scenery/text/grid/glow.
TOP LEFT: upright electric kick-scooter stance: both hands hold the horizontal handlebar, both feet rest on teal scooter deck, knees soft, forward gaze. Full scooter stem, deck and both wheels.
TOP RIGHT: side-on maple skateboard coasting: low balanced stance with BOTH feet on deck, arms relaxed for balance.
BOTTOM LEFT: same skateboard, same position and scale and EXACT same head/torso position as top right: lead foot stays on deck, rear leg extends back/down to push against ground.
BOTTOM RIGHT: same skateboard and fixed lead foot: rear foot lifted and returning onto deck after push. Same head/torso position as top right.
The three skateboard cells are consecutive animation phases. LOCK head, torso, lead-foot contact and vehicle coordinates across cells; only trailing leg and tiny balancing arm movement may change. No extra limbs, missing feet, identity drift, outfits changing, body distortions, hovering or bicycle crank. No reference-held props; hands must be available for these tools. Clear silhouette for a 512x512 packed atlas.
```

| 角色 | 身份约束 |
| --- | --- |
| 原鬼鬼 | 棕色后梳短发、圆眼镜、黑色无袖上衣、米色长裤、棕色鞋；保留程序原形象 |
| 健文 | 黑色短发、方眼镜、红色外套、深灰长裤、运动鞋 |
| 华佗 | 白色发髻和胡须、浅色传统长袍；收起原手持药杖与药篮 |
| 太极小子 | 深棕色发髻、原练功服和深色长裤 |
| 小麦 | 金色卷发、绿色叶帽、浅绿色叶纹围裙、绿色靴子 |
| 豆豆 | 白兔、粉色长耳内侧、圆脸颊、绿色帽子和围裙；保留完整耳朵和双脚 |

选定输出的原文件名、程序资源路径和图文预览见 [交付说明](README.md)。最终文件为 256×256 透明 2×2 图集，未覆盖已有动作素材。512×512 是生成提示中提出的预期展示规格，最终为控制小程序体积缩小打包。
