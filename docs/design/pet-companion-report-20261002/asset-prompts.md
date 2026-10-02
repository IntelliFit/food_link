# 配图来源与制作说明

图文报告使用程序原素材、原创信息图及两幅新生成的场景背景。所有候选界面均明确标注“非小程序实拍”。图中星光、等级、订单与进度为示例。

## 程序原素材

| 本报告文件 | 原仓库路径 | 用途 |
| --- | --- | --- |
| assets/current-guigui-sprite.png | apps/wechat/src/assets/pets/companions/companion-fbd87f73-v1.png | 鬼鬼原精灵图集；截取原帧，不重新生成脸和身形 |
| assets/room.jpg | apps/wechat/src/packagePetStudio/assets/growth-room-v1.jpg | 小屋与故事场景 |
| assets/lake.jpg | apps/wechat/src/packagePetStudio/assets/adventure-lake-v1.jpg | 现有冒险场景参考 |
| assets/scarf.png | apps/wechat/src/packagePetStudio/assets/explorer-scarf-v1.png | 现有围巾物品预览 |
| assets/props.png | apps/wechat/src/packagePetStudio/assets/adventure-props-v1.png | 现有冒险道具参考 |
| assets/xiaomai.png | apps/wechat/src/assets/pets/xiaomai-01.png | 其他模板素材参考，不作为鬼鬼替代形象 |

页面展示的待机和行走帧来自上述图集。奔跑、落地、递餐、拾取等完整肢体动作是未来制作目标，未用缩放静态图冒充完成效果。照片宠物须有独立身份、多姿态一致性与动作适配校验。

## 新增场景

2026-10-02使用本会话可调用的图像生成工具制作无角色背景；不是视频，不使用QQ素材。原图转换为JPEG以便离线分享；角色、文字与可交互区域由文档渲染单独组合。

### assets/kitchen-concept.jpg

生成提示词：

> Use case: stylized concept. Create a warm, sophisticated lakeside cottage food cart scene with three clearly identifiable workstations: a wooden preparation counter on the left, a brass stove and soup pot in the center, and a ceramic plating counter on the right. Broad three-quarter view, low counter, open area for the existing character to be placed separately. Arched window, cream plaster, walnut wood, sage accents, amber light, steam and vegetables. Premium painterly illustration with believable materials, cozy rather than childish. Landscape 16:9. No humans, animals, characters, interface, text, numbers, logos or watermarks. Background only; the exact original pixel pet will be composited separately.

布局示意只保留一个热加工工位；游戏同时管理备餐、热加工与装盘三个不同阶段，单灶不能同时煮两道菜。角色原帧站在工作区，仅演示身份与位置。

### assets/map-concept.jpg

生成提示词：

> Use case: stylized concept. Create a warm pet-growth chapter map, a handcrafted premium painterly illustration with soft realistic materials. An idyllic lakeside village path connects three distinct locations: a cottage on the left, a stone bridge in the center, and a food cart or cafe on the right. Daisies and a picnic bench in the foreground, a lake and forested hills in the distance. Leave an open lower area for interface overlays. Warm morning light, cream, honey wood, sage green and lake blue. Landscape 16:9. No humans, animals, characters, text, numbers, interface, logos or watermarks. The existing original character sprite will be placed separately.

该图用于说明章节地图与候选路线；并不意味着横向冒险机关已制作或接入小程序。

## 结构图与界面

`figures/*.svg` 是原创可编辑信息图；同名PNG供PDF使用。`build_web.mjs` 用HTML/CSS生成十个候选界面PNG，原角色通过图集帧映射呈现。界面没有真实账号信息或真实匹配对手。未来玩法及奖品请以报告正文规则为准。
