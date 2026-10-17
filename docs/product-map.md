# 食物库、食堂与地图

2026-10-16依据当前源码整理，尚未做微信运行验收。这里记录信息架构，不代表所有入口在当前线上包可见。

| 名称 | 代码中的含义与入口 | 与其他模块的关系 |
| --- | --- | --- |
| 美食图谱 | `packageExtra/pages/food-library/index`，页面标题为美食图谱；“我的”服务入口指向此页 | 展示公共餐食及食堂条目，支持地图/列表、收藏、我的等模式 |
| 公共食物库 | `getPublicFoodLibraryList` 等API与 `PublicFoodLibraryItem` 数据模型 | 是图谱等页面读取的数据能力；不能把历史名称当作必须独立存在的导航页 |
| 校园食堂 | `venue_type=university` 等食堂数据；`packageExtra/pages/campus-canteen/index` 为目录，分享入口为 campus-food-share | 同一数据可在食堂目录、图谱、详情、录餐来源中出现 |
| 社区、园区与公司食堂 | 图谱保留场所类型，食堂目录及“我的”统一称“食堂”；批量上传支持 university/community/office_park/corporate | 与校园共用上传与版本记录；按各自机构或食堂申请批量授权，非校园不要求学校目录 |
| 美食地图 | food-library 页的 `viewMode=map`，通过 `getPublicFoodMapSpots` 聚合点位 | 是图谱的一种视图，同页可切列表；从录餐进入时默认列表，普通进入默认地图 |

路由由 `apps/wechat/src/app.config.ts` 注册，通过 `utils/subpackage-extra.ts` 的 `extraPkgUrl` 定位实际分包；不要将上表的逻辑路径当成独立根页面。

变更前核对“我的”入口、分享、食堂目录、详情、收藏/我的、地图点位与录餐选择路径。修改命名或会员限制时，明确哪些入口变化、哪些数据仍保留。来源收录不保证营业、供应、通行权限或营养值已经审核。

已确认范围：食堂包含校园、社区、园区和公司食堂，批量上传共用一个入口；是否另设一级导航与公共食物库命名不属于本次变更。

主要依据：`apps/wechat/src/pages/profile/index.tsx`、`packageExtra/pages/food-library/index.tsx`及其 `food-map.ts`、`packageExtra/pages/campus-canteen/index.config.ts`。后几个路径相对 `apps/wechat/src/`。
