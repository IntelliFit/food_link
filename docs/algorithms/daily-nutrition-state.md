# 每日营养状态（Daily Nutrition State）

2026-11-04 起，推荐 Agent、分析页、宠物、记录结果页都读同一份“每日营养状态”，不再各算各的分。
引擎按用户、按天计算；Go 类型在 `backend/internal/health/domain/nutrition_state.go`，本文件是字段说明和接口约定。
设计稿：https://claude.ai/artifact/4fqSQUY3EpKuBdvzB9Djam

## 接口

### `GET /api/health/nutrition-state?date=YYYY-MM-DD`（需登录）

- `date` 省略时为今天（北京时间）。返回 `DailyNutritionState`，和 `/api/stats/summary` 同样直接返回 JSON 对象。
- 记录少于 2 天时 `coverage.enough_data=false`，`scores.overall` 为 `null`，但 `today`、`evidence_gaps` 照常返回。
- 数据缺失一律是“不知道”（`status: "unknown"`、`value: null`），不按 0 算。

示例（数字仅示意）：

```json
{
  "date": "2026-11-04",
  "generated_at": "2026-11-04T05:10:00Z",
  "coverage": { "recorded_days": 6, "meals": 15, "today_meals": 2, "nutrient_completeness": 0.72, "enough_data": true },
  "plan": { "goal": "fat_loss", "goal_label": "减脂", "energy_kcal": 1650, "protein_g": 95, "source": "saved_plan" },
  "today": [
    { "key": "protein", "label": "蛋白质", "unit": "g", "value": 52, "target": 95, "kind": "min", "status": "short", "gap": 43, "unknown_meals": 0 },
    { "key": "fiber", "label": "膳食纤维", "unit": "g", "value": 11, "target": 25, "kind": "min", "status": "short", "gap": 14, "unknown_meals": 0 },
    { "key": "vegetables", "label": "蔬菜", "unit": "份", "value": 1, "target": 3, "kind": "min", "status": "short", "gap": 2, "unknown_meals": 0 },
    { "key": "sodium", "label": "钠", "unit": "mg", "value": 1850, "target": 2000, "kind": "max", "status": "near_limit", "gap": 150, "unknown_meals": 1 },
    { "key": "added_sugar", "label": "添加糖", "unit": "g", "value": null, "target": 50, "kind": "max", "status": "unknown", "gap": 0, "unknown_meals": 1 }
  ],
  "gaps": [ { "key": "fiber", "label": "膳食纤维", "text": "纤维还差 14g", "severity": 0.56 } ],
  "next_meal": { "meal_type": "dinner", "label": "晚餐", "advice": "一份深色蔬菜 + 鱼或豆腐，汤和酱汁少一点", "fills": ["fiber", "protein"], "limits": ["sodium"] },
  "week": {
    "days": ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"],
    "habits": [ { "key": "vegetables", "label": "蔬菜够 3 份", "marks": ["hit", "hit", "miss", "hit", "hit", "hit", "today"], "hit": 5, "of": 6 } ],
    "counts": [ { "key": "fish_soy", "label": "鱼或豆制品", "value": 2, "target": 3, "unit": "次" } ],
    "vs_last_week": [ { "key": "vegetables", "label": "蔬菜够量", "last": 3, "this": 5, "unit": "天", "better": true } ]
  },
  "scores": {
    "overall": 64,
    "overall_last_week": 58,
    "focus": [ { "key": "hypertension", "title": "血压管理友好度", "score": 52, "reason": "钠 6 天里 4 天超标，钾只到目标一半", "evidence": ["钠 4/6 天超过 2000mg"] } ]
  },
  "evidence_gaps": [ { "key": "sodium_unknown", "text": "3 餐没有钠和糖的数据", "hint": "拍照时把汤和饮料也拍进去", "action": "record" } ],
  "context": { "weight_trend": { "kg_change": -0.6, "days": 14 }, "training_today": true, "water_ml_today": 500, "sleep_hours": null, "notes": ["周三、周五练腿", "不吃香菜"] },
  "headline": "这周蔬菜跟上了，盐还偏多：6 天里有 4 天钠超过 2000 毫克。",
  "findings": [ { "key": "sodium_over_days", "kind": "over", "text": "6 天里 4 天钠超过 2000 毫克", "value": "4/6" } ]
}
```

字段约定：

| 字段 | 取值 |
|---|---|
| `today[].key` | `energy` `protein` `fiber` `vegetables` `sodium` `added_sugar` `sat_fat` `potassium` `calcium` `water`（按数据有无返回，顺序即展示顺序） |
| `today[].kind` | `min`（至少达到）/ `max`（不超过）/ `range` |
| `today[].status` | `ok` `short` `near_limit` `over` `unknown` |
| `week.habits[].marks` | `hit` `miss` `today` `none`（那天没记录），长度等于 `week.days` |
| `scores.focus[].key` | 与分析页现有关注卡（health_index.go）一致：`hypertension` `diabetes` `cardio` `weight` `colorectal` `longevity` `micronutrient` |
| `evidence_gaps[].action` | `record` `weight` `water` `sleep` `none`，前端据此跳到对应记录页 |
| `headline` / `findings` | 引擎给出的有据可查的一句话和事实列表；宠物或模型可以换说法，但不得编造数字 |
| `focus` | 用户选的关注（最多 3 项，按用户的顺序）：`[{"key":"diabetes","title":"血糖稳定友好度","custom":false}]`；`gaps`、`next_meal`、`scores.focus` 的顺序和 `headline` 都优先照顾这几项 |

### 关注：`GET` / `PUT /api/health/focus`（需登录）

- 用户的「我在意的」，最多 3 项，存在 `health_condition.focus_keys`（不改表）。值是现有关注卡的 key（`hypertension` `diabetes` `cardio` `weight` `colorectal` `longevity` `micronutrient`），或自定义关注 `custom:<id>`（id 来自 `/api/user/health-focuses`）。
- `PUT` body `{"keys": ["hypertension", "custom:<id>"]}`，返回 `{"keys": [...]}`；超过 3 项、不认识的 key、不属于自己的自定义关注都返回 400；空数组清空。`GET` 返回 `{"keys": [...]}`。
- 引擎怎么用（`nutrition_state_focus.go`）：关注相关的缺口排前（血压 → 钠、钾、蔬菜；血糖 → 添加糖、纤维；心血管 → 饱和脂肪、钠、纤维；体重 → 热量、蛋白质；肠道 → 纤维、蔬菜；饮食习惯 → 蔬菜、蛋白质；微量营养 → 钙、钾）；关注了血压或血糖，下一顿就提醒少盐或少糖、主食换粗粮（和病史同样处理）；关注卡按用户顺序排在最前；一句话总结优先讲关注相关的问题。自定义关注只列出来，暂不参与排序（自由文本和营养素没有可靠的对应）。
- 推荐 Agent 的 `get_meal_context` 里 `nutrition_state.focus` 是这几项的名字。

### `GET /api/health/nutrition-state/meal-impact?record_id=<id>`（需登录）

返回 `MealImpact`：这条记录让当天各项从多少变到多少（`before` / `after` / `delta`，未知为 `null`），以及一句 `headline`（如“这一餐让纤维 +6g，今天还差 8g”）。只能查自己的记录。

### 宠物每日接口

`GET /api/pet/daily?date=YYYY-MM-DD`（需登录，`date` 省略为今天）。小程序底栏「小麦」（`pages/pet/index`）读它。底栏是 首页 · 小麦 · 拍照 · 圈子 · 我的：小麦替换了原来的「分析」格，完整分析 `pages/stats/index` 不再是 Tab，从小麦页「完整分析」`navigateTo` 进入。小麦页一屏五块：宠物 + `headline` + 心情；今天还差（`gaps`）+「让小麦挑一份」；今天的任务；本周分数（`week`）+「完整分析」；问小麦输入框。顶部「我在意的」改关注（`PUT /api/health/focus`）。`report`、`memories` 目前页面不展示（`report.reward` 只用来提示经验到账）。代码：`backend/internal/pet/service/pet_daily.go`、`pet_daily_task.go`。

每次读取同时取今天和昨天两份营养状态；任一份取失败只当它缺失，不让接口失败（`state_ready=false`，退回宠物原来的习惯分）。

| 字段 | 说明 |
|---|---|
| `pet` / `status` | 宠物档案和形象动作，和 `/api/pet/summary` 一样 |
| `headline` | 小麦那一句话：今天状态的 `headline`，没有就用 `report` 的句子 |
| `gaps` | 「今天还差」最多 3 行 `{key, label, text, status, percent, warn}`，按引擎 `gaps` 的顺序（关注的在前），不够 3 行时补上快到上限 / 超标的项；`text` 如“差 43 克”“快到上限”“超了 600 毫克”，`percent` = 今天的值 / 目标，`warn` 为限量项（画成橙色） |
| `meals_today` | 今天记了几餐 |
| `week` | `{score, last_week, delta, enough_data, habits}`：`scores.overall` / `overall_last_week` 和前两条 `week.habits`（“蔬菜够量 5/6 天”） |
| `focus` | 营养状态的 `focus` 原样（`[{key, title, custom}]`），给「我在意的」 |
| `mood` | `{key, label, reason, icon}`。顺序：2 天以上没记录 → `sleepy`；今天有超标（`status=over`，钠/添加糖/饱和脂肪/能量，取超得最多的）→ `salty` `sweet` `greasy` `full`；昨天超标同上；昨天喝水/蔬菜/纤维/蛋白质不足 → `thirsty` `craving_greens` `craving_protein`；否则 `happy` / `hungry`。`reason` 只引用状态里的数字，如“昨天钠 2600 毫克，超过 2000 毫克” |
| `report` | `{yesterday, today, facts, source, reward}`。`yesterday` = 昨天状态的 `headline`（空则用前两条 `findings`，没记录则说没记录；没有状态时用原来的离线小复盘文案）；`today` = 第一个 `gap` 的 `text` + `next_meal.advice`；`facts` = 昨天和今天 `findings[].text` 去重前 4 条。目前不经模型改写，全是引擎原句 |
| `report.reward` | `{exp, claimed_now}`：昨天离线小复盘（`user_pet_events.offline_review`）的经验。读这个接口时自动领取（复用原领取事务，幂等），`claimed_now=true` 表示这次刚领到。2026-11-06 起复盘只给经验、不给积分：新复盘 `credit_reward=0`，之前生成的复盘不论自动领还是在宠物页点领取都不再加积分，展示时去掉文案里的“带回 1 积分” |
| `task` | 今日任务，见下 |
| `water` | `{ml, goal_ml, cups, goal_cups, cup_ml: 250, known, is_task_goal}`，目标取 `today` 里 `water` 的 `target`，没有按 1500 毫升 |
| `next_meal` | `{meal_type, label, advice, starter_question}`，来自 `next_meal`；没有时按时钟给早餐/午餐/晚餐/夜宵 |
| `memories` | 「宠物记得」：`plan.goal_label` + “中”、体重趋势、今天有训练、`context.notes` 逐条，最多 8 条 |
| `state_ready` | 今天的营养状态是否取到 |

今日任务（`task`）：

- 当天第一次读取时选定，存在 `user_pet_daily_scores.score_details.daily_task`（不加表、不加字段），当天不再换。按引擎 `gaps` 的顺序（引擎已把用户关注的排在前面，所以任务对准关注里最该改的一项），取第一个有对应任务的：
  - 补充类 `fill`（`vegetables` 1 份、`fiber` 6g、`protein` 20g、`potassium` 600mg、`calcium` 250mg，缺口更小时取缺口）：今天的值比选定时多出这么多，或状态变成 `ok`，即完成；
  - 喝水 `water`：当天喝水达到目标；
  - 清淡一餐 `light`（`sodium` `added_sugar` `sat_fat` 和超标的 `energy`）：选定后新记的、有该项数据的餐，平均每餐增加不超过 800mg / 5g / 6g / 600kcal；
  - 都没有（或拿不到营养状态）→ `record_meal`：再记一餐。
- 字段：`key kind title reason unit progress goal done just_done exp_reward done_at action`（`action` 为 `record` 或 `water`，前端据此打开记录菜单或 +1 杯）。
- 完成判定在读接口时做（记录保存后再打开宠物页就会完成）。`repo.CompleteDailyTask` 用条件更新把 `done` 置真并在同一事务加 20 经验（同时累加当天 `exp_gained`），只有置真的那次发经验，所以重复读、并发读都只发一次；`just_done=true` 只出现在发经验的那次响应里。
- 重算习惯分（`UpdateDailyScore`）整体替换 `score_details` 时，数据库保留 `daily_task`。
- 只在今天创建和完成任务；查过去的日期只返回当天已存的任务。

## 埋点约定

用现成的 `experiments.track(name, props)`（`apps/wechat/src/utils/experiments.ts`，上报到 `POST /api/app-events`，表 `app_events`）。事件名 `^[a-z][a-z0-9_.]{1,63}$`，按 `<界面>_<动作>`：

- 分析页：`stats_view`（props: `tab`）、`stats_focus_open`（`key`）、`stats_next_meal_click`、`stats_evidence_click`（`action`）
- 小麦页：`pet_tab_view`（`logged_in`）、`pet_task_done`（`key`）、`pet_tool_click`（`tool`：`pick_meal` `ask` `stats` `dress` `water_cup` `task_<key>`）、`pet_note_open`（打开「我在意的」）、`pet_focus_save`（`count`）
- 记录结果页：`meal_impact_view`、`meal_impact_click`（`target`）

## 计算口径（引擎会话补充）

代码在 `backend/internal/health/service/nutrition_state*.go`、`nutrition_meal_impact.go`；单测 `nutrition_state_test.go`。

- **数据窗口**：所选日期往前 14 天的饮食记录（本周 7 天 + 上周 7 天，用于“比上周”），当天的饮食方案目标（没有方案用已保存目标或 TDEE 估算），近两年体重（取 3 周内首末两次算趋势）、本月喝水、当天运动、当天睡眠记录。
- **营养规则**：沿用 `diet_nutrient_plan.go`（WHO / WS/T 578：纤维 25g、钠 ≤2000mg、钾 3510mg、饱和脂肪 ≤10% 能量、添加糖 ≤10% 能量等）；特殊人群规则不变。
- **未知不当 0**：某餐缺某营养素，记在 `unknown_meals`；“不超过”类在已知部分未接近上限时状态是 `unknown`（下限值不能证明没超），已知部分已超就是 `over`。
- **蔬菜**：按菜名识别蔬菜，用记录重量 × 吃掉比例估算；荤素混合菜（如番茄炒蛋）按 40% 计；没有重量的菜不计（偏低估）。目标 300g（膳食指南 300–500g 的下限）。
- **本周规律**：蔬菜够 300 克、纤维过一半、钠没超上限、蛋白质够 90%、喝水够量；那天没记录或数据不够判断为 `none`；今天还没结束时，“至少”类没达到、“不超过”类没超都记 `today`。
- **分项分数**：每项由几个组成部分加权平均，缺数据的部分不参与（不当 0 分）：血压 = 钠超标天数 .5 + 钾 .25 + 蔬菜 .25；血糖 = 添加糖 .3 + 纤维 .3 + 全谷物 .2 + 晚 9 点后进食 .2；心血管 = 饱和脂肪 .35 + 钠 .25 + 鱼豆 .2 + 纤维 .2；体重 = 热量贴合度 .5 + 体重趋势 .3 + 蛋白质 .2；肠道 = 纤维 .5 + 蔬菜 .3 + 全谷物 .2；饮食习惯 = 记录与早餐 .4 + 蔬菜 .2 + 鱼豆 .2 + 进食时间 .2；微量营养 = 已记录微量营养素达标率均值。综合分 = 有分数的各项平均。记录不足 2 天不出分。
- **下一顿**：按时间推断餐次，那一餐已记录就顺延（12:20 记了午餐，13:10 看的是晚餐）；晚上 9 点后不给。缺蔬菜/纤维 → 一份深色蔬菜；缺蛋白质 → 鱼或豆腐（本周鱼豆不足 3 次时）；本周全谷物不足 3 次 → 主食换一半粗粮；钠接近或超过上限、或本周已有 3 天超标 → 汤和酱汁少一点。
- **按周收紧推荐**：推荐 Agent 的决策依据（`diet_decision_basis.go`）在今天之前 6 天里有 3 天以上钠超过上限时，把今天的钠上限从 2000mg 收紧到 1500mg（用户自己保存的计划不改），排序会偏向汤少、酱汁少的餐。
- **推荐 Agent 读同一份状态**：`get_meal_context` 的输出里多了 `nutrition_state`（今天的缺口、下一顿要补和要避开的、本周规律），见 `meal_nutrition_state.go`。
