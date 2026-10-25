# 食探「未来的你 · 寿命模拟」v1 设计稿

日期：2026-10-24。状态：**产品与接入设计，未实施、未发布**。本稿只新增文档和原型，没有修改代码、数据库、配置或部署。

- 需求来源：《循证交互式 Life Simulator / Lifespan Predictor：科学模型、数据体系与产品实施方案》（下称"需求文档"），以及用户已确认的方向。
- 引擎：参数表与参考实现由并行会话在 `D:\projects_mjw\lifespan-predictor` 建设（本稿写作时该目录尚未创建，字段以本稿第 4 节为对齐草案）。
- 交互原型：`D:\CodexWork\food_link\lifespan-ui\index.html`（示例数据，非真实计算）。

## 0. 一句话

> **你在食探记下的吃法，决定你能活多久。** 用你最近至少 14 天的真实饮食，把同一个你分成三条人生：照现在这样吃、把饮食吃对、放飞自我；拖动年龄，看三个你在体重、健康年数和活到各年龄的概率上怎么分开。

它是食探的招牌功能，不是独立计算器。它回答"为什么值得改、先改什么"，然后把用户送回食探已有的下一餐推荐和饮食方案去"怎么吃"。

### 命名

| 候选 | 评价 |
| --- | --- |
| **未来的你 · 寿命模拟**（推荐） | 情绪强、可分享；副标题明确"模拟"，避免"预测死亡日期"的语义 |
| 三个你 | 直接点出玩法，但单独出现时看不出是寿命 |
| 吃出来的寿命 | 卖点最直白，偏营销口号，适合作宣传语而不是功能名 |
| 寿命预测 / Lifespan Predictor | 不推荐对外使用：需求文档明确建议公共品牌避免"预测器"，也更容易被看作医疗用途 |

首页卡片标题用问题句："照现在这样吃，你会活成哪个自己？"，功能名"未来的你"，页面角标"寿命模拟"。

## 1. 三个你：怎么定义才公平、才可信

需求文档要求三个虚拟个体在分叉时**完全相同**（相同基线、相同病史、共享随机数），差异只来自策略。食探版本做的是"受控饮食实验"：

| 分支 | 食探文案 | 科学定义（策略函数） | 非饮食因素 |
| --- | --- | --- | --- |
| A | 照现在这样吃 | 最近 ≥14 天的饮食结构与能量平衡持续；体重沿 Hall 动态模型从当前体重与实测趋势外推 | 保持用户当前回答 |
| B | 把饮食吃对 | 只把证据最强的饮食因素调到目标（对应需求文档 B1 的饮食部分）；能量平衡回到维持或缓慢回到健康 BMI | **与 A 相同** |
| C | 放飞自我 | 从真实人群的不良饮食共同分布取一个现实组合（例如 CNHS/CKB 饮食较差五分位），而不是每项机械设最差；能量持续小幅盈余 | **与 A 相同** |

关键决定：

1. **默认只让饮食分叉。** 这样"差距来自吃法"这句话成立，也最贴合食探。吸烟、饮酒、活动、睡眠只作为三人共同的基线风险，不随分支改变。
2. **诚实的量级。** 只改饮食时平均寿命差通常是几年，不是几十年（CKB 2022 五项生活方式全部满足 vs 0–1 项，30 岁时差约 8 年，这还是五项合计）。页面要先展示分布和"活到 85 岁的概率"，而不是只秀一个"多活 X 年"。单次"跑一次人生"可以差很多，但必须标"一次随机结果"。
3. **"放飞自我"不能被设计成越惨越好。** 惨不惨是模型输出，不是设计目标；超出参数覆盖范围的输入显示"外推"标记。
4. **共享随机数**（common random numbers）：三人的"跑一次人生"用同一组隐藏随机数，C 在 57 岁心梗而 B 没有，才可以解释为风险不同，而不是骰子不同。
5. 后续可选"加上作息和运动"开关（全生活方式分叉，对应需求文档 B1/C 全量），但这会让差距不再只来自饮食，默认关闭，列为待拍板问题。

## 2. 数据映射

### 2.1 食探已有、可以直接用的数据

| 引擎输入 | 食探来源 | 用法与注意 |
| --- | --- | --- |
| 性别、年龄 | `weapp_user.gender`、`birthday`（`AgeFromBirthday`） | 基础死亡率分层。模型主要覆盖 30–79 岁；18–29 岁、80 岁以上显示外推标记；未满 18 岁不开放 |
| 身高、体重、BMI | 健康档案 `height`、`weight`；`user_weight_records` | 起始状态；用最近 14 天体重记录的中位数替代单次值 |
| 体重趋势 → 实际能量平衡 | `dashboard_service.calibrationSuggestion` 已有的 14 天窗口逻辑（≥7 天饮食记录、≥2 次体重且间隔 ≥7 天） | **A 的体重轨迹以实测体重趋势反推能量平衡**，而不是直接用记录的千卡：饮食记录普遍漏记，直接用会让 A 被模拟成持续消瘦 |
| 日常活动水平 | `daily_life_activity_level`（久坐/走动/站立/体力劳动） | Hall 模型的活动系数；不是"运动"本身 |
| 既往病史 | `health_condition.medical_history`：糖尿病、高血压、高血脂、痛风、甲状腺 | 基线疾病状态。当前缺心脏病/中风/癌症/慢阻肺，需在补问中加 |
| 饮食目标 | `diet_goal`（减重/保持/增重） | 只用于 B 的体重目标方向，不改变风险参数 |
| 饮食结构（每千卡密度） | 饮食记录的营养与食材：能量、蛋白、碳水、脂肪、纤维、钠、钾、钙等（`statsMicronutrientWeights` 与 v3 营养注册表已有 15 项扩展营养） | 用**每 1000 kcal 的密度**和食物组占比，不用绝对量，以降低漏记影响。缺失项不当 0（沿用 v3"未知不等于零"规则） |
| 食物组 | v3 的食物组线索（蔬菜、水果、全谷物、红肉/加工肉、豆类、含糖饮料等） | 对应 CKB/中国模拟研究的饮食因子；目前是菜名/食材线索，不是按克数的完整 FFQ，需标"估算" |
| 睡眠 | `SleepRecord.duration_minutes`、`bedtime`/`wake_time` | 近 28 天 ≥7 晚时用中位时长与规律性；否则用补问 |
| 运动 | `user_exercise_logs.duration_min`、`exercise_type` | 近 28 天折算每周中高强度分钟；记录很少时用补问，记录作为下限 |
| 体检报告 | `report_extract.indicators`（OCR：名称/值/单位） | 第二层精度：血压、血脂、血糖/HbA1c。需要名称归一化，只取有日期且单位可识别的值 |

### 2.2 14 天平均规则（避免每天乱跳）

- 计算窗口：截至上周日 24:00（北京时间）的最近 28 天，**至少 14 天跨度**。
- 有效记录日：当天 ≥2 餐，或已记录能量 ≥ 当日目标的 50%。
- 有效记录日 ≥7 天才算"饮食数据就绪"；不足时页面可用补问里的"饮食速答"先出一个低把握度的版本，并显示"再记 N 天会更准"。
- 每周一随"上周回顾"刷新一次。中途修改档案或补问答案时允许手动重算，但同一输入哈希命中缓存不重复计算。
- 版本化：每份结果带 `input_hash`、`engine_version`、`params_version`；模型升级导致的变化显示"模型更新"，不当成身体变化（需求文档"不是你的身体突然少了两年，而是模型升级了"）。

### 2.3 还缺、要补问的（30 秒快速问题）

一次最多 6 题，单选为主，全部可选"不想说"（缺失时用同年龄性别人群分布并降低完整度）：

| 题目 | 选项 | 进入引擎的变量 |
| --- | --- | --- |
| 你吸烟吗？ | 从不 / 已戒（戒了几年） / 现在吸（每天约几支） | 吸烟状态、支/天、戒烟年数 |
| 你喝酒多吗？ | 基本不喝 / 每周 1–2 次 / 每周 3 次以上；常喝啤酒/葡萄酒/白酒 | 折算 g 乙醇/天（换算系数进参数表） |
| 每周专门运动多久？ | 几乎不 / <150 分钟 / 150–300 分钟 / >300 分钟 | MET-h/周或中高强度分钟（与运动记录取较大者） |
| 平时一晚睡多久？ | <6 / 6–7 / 7–8 / 8–9 / >9 小时 | 睡眠时长（有 ≥7 晚记录时跳过此题） |
| 是否被诊断过？（多选） | 心脏病 / 中风 / 癌症 / 慢阻肺 / 无 | 补齐基线疾病状态（糖尿病、高血压已在健康档案） |
| 最近一次血压？（可跳过） | 不知道 / 正常 / 偏高 / 输入数值 | 收缩压；没有就用人群分布 |

"信息完整度"实时显示（例："模型信息完整度 42% → 68%"），对应需求文档的渐进式采集。第二层（腰围、血脂、HbA1c、家族史）放到结果页"让结果更准"里，优先从体检报告 OCR 预填。

## 3. 引擎怎么接

```text
lifespan-predictor（另一会话）              food_link 后端（Go）
 ├─ params/  参数注册表 (CSV/JSON)   ──复制+校验哈希──▶ internal/lifespan/params/*.json  (go:embed)
 ├─ reference/ 参考实现              ──导出──────────▶ internal/lifespan/testdata/golden/*.json
 └─ golden vectors（输入→输出）                        internal/lifespan/engine  (Go 移植)
                                                       internal/lifespan/service (取数、14 天聚合、缓存)
                                                       internal/lifespan/handler (/api/lifespan/*)
```

1. **一份参数表，两份实现。** 参数表是唯一事实来源，字段沿用需求文档 Registry（`parameter_id`、`endpoint`、`effect_metric`、`estimate`、`ci`、`lag_function`、`double_count_group`、`evidence_type`、`china_specific`、`source`、`status`），另加 `estimated: true/false` 与 `estimate_note`（没有论文、合理估计的参数必须标注）。Go 端用 `go:embed` 打包，启动时校验 `params_sha256` 与引擎会话发布的一致。
2. **Go 只移植，不另造公式。** 版本号 `engine_version` 跟随参考实现；Go 端任何偏离都要回到参考实现先改。
3. **黄金向量对照。** 参考实现导出 ≥200 组覆盖边界的"输入 → 输出"（年龄 18/30/50/79/85、男女、吸烟各档、BMI 16–40、缺失值、外推输入），Go 单测逐条比较：生存概率绝对误差 ≤0.001、预期寿命误差 ≤0.05 年、单次人生（同 seed）事件序列完全一致。随机数生成器与 seed 派生规则必须在两边写成同一算法（建议 PCG32/SplitMix64，按 `seed + branch + life_index` 派生，不能用各语言默认随机库）。
4. **确定性曲线 + 抽样人生分开。** 三条生存曲线、健康年数、寿命分布用生命表/危险率积分直接算（无 Monte Carlo 噪声、毫秒级）；"跑一次人生"才用随机抽样。若引擎需要 Monte Carlo 才能出健康年数，每分支 2,000 条、年步长，在 Go 中预计 <50 ms，可同步返回。
5. **不重复计算。** 饮食通过体重/BMI 产生的效应与饮食质量的直接效应分在不同 `double_count_group`，引擎在组合层检查；食探层不再额外乘任何系数。
6. **与现有"健康指数"关系。** 分析页的健康指数（高血压/糖尿病/心血管/体重分）是饮食评分，不是寿命模型。两者共享同一份 14 天饮食事实，但不得互相换算；文案上分别叫"健康指数"和"寿命模拟"。

## 4. 接口约定（与引擎会话对齐的字段草案）

### 4.1 引擎输入 `LifespanInput`

```jsonc
{
  "schema_version": "lifespan-input-1",
  "as_of": "2026-10-19",                 // 窗口截止日（上周日）
  "person": { "sex": "male", "age_years": 32.4, "height_cm": 175, "weight_kg": 78.2 },
  "weight_trend": { "kg_per_week": 0.12, "days_span": 21, "records": 5 },  // 可为 null
  "activity": { "daily_life_level": "sedentary", "exercise_min_per_week": 90, "source": "answer|logs|both" },
  "smoking": { "status": "never|former|current|unknown", "cig_per_day": null, "years_since_quit": null },
  "alcohol": { "g_ethanol_per_day": 8, "status": "none|occasional|regular|unknown" },
  "sleep": { "hours_median": 6.3, "regularity_sd_min": 52, "source": "records|answer|unknown" },
  "conditions": ["hypertension"],        // 枚举：diabetes, hypertension, hyperlipidemia, chd, stroke, cancer, copd
  "biomarkers": { "sbp_mmhg": null, "ldl_mmol": null, "hba1c_pct": null },
  "diet": {
    "window_days": 28, "valid_days": 16,
    "kcal_logged_mean": 1850,            // 仅供参考，不直接驱动体重
    "per_1000kcal": { "fiber_g": 8.1, "sodium_mg": 2400, "potassium_mg": 1100, "protein_g": 42, "sat_fat_g": 13, "free_sugar_g": 22 },
    "food_groups_servings_per_day": { "vegetables": 2.1, "fruit": 0.4, "whole_grains": 0.3, "red_processed_meat": 1.6, "legumes": 0.5, "fish": 0.2, "sugary_drinks": 0.6 },
    "field_coverage": { "sodium_mg": 0.71, "fiber_g": 0.83 }   // 有数值的记录占比；<0.5 视为未知
  },
  "branches": ["current", "diet_right", "diet_loose"],
  "seed": 182772
}
```

### 4.2 引擎输出 `LifespanResult`

```jsonc
{
  "model": { "engine_version": "lifesim-cn-0.1.0", "params_version": "evidence-2026-10-25", "params_sha256": "…", "input_hash": "…", "seed": 182772, "computed_at": "…" },
  "applicability": { "age_in_range": true, "extrapolated_inputs": ["sleep.hours_median"], "completeness_pct": 68 },
  "branches": [
    {
      "key": "current",
      "policy": { "diet": {…实际使用的饮食取值…}, "energy_balance_kcal": 60 },
      "life_expectancy": { "median": 81.6, "mean": 80.9, "p10": 69.0, "p90": 91.5 },
      "healthy_years": { "median_age_until_major_disease": 68.2 },
      "survival": [ { "age": 33, "p_alive": 0.999, "p_alive_disease_free": 0.99 } ],   // 每 1 岁
      "trajectory": [ { "age": 33, "weight_kg": 78.4, "bmi": 25.6 } ],
      "death_age_histogram": { "bin_years": 2, "start_age": 30, "density": [ … ] }
    }
  ],
  "top_changes": [
    { "factor": "sodium", "label": "少盐", "current": 2400, "target": 1500, "unit": "mg/1000kcal",
      "gain_years": { "median": 0.9, "low": 0.3, "high": 1.6 }, "gain_p85_pct": 2.1,
      "evidence": ["CN Cohort", "RCT"], "parameter_ids": ["DIET_NA_01"] }
  ],
  "warnings": [ { "code": "EXTRAPOLATED", "field": "sleep.hours_median", "message": "…" } ]
}
```

单次人生：

```jsonc
{ "seed": 551203, "branches": [ { "key": "diet_loose", "death_age": 72, "events": [ { "age": 54, "type": "hypertension" }, { "age": 61, "type": "chd" } ] } ] }
```

`events.type` 枚举需与引擎对齐：`hypertension`、`diabetes`、`chd`、`stroke`、`cancer`、`copd`、`disability`、`death`；每条可带 `model_note`（来源参数 ID）。

### 4.3 食探对外 API（Go，`/api/lifespan`，RequireJWT）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/lifespan/status` | `needs_consent` / `needs_answers` / `insufficient_diet`（含还差几天）/ `ready`；完整度；首页卡片用的最小摘要（三分支中位寿命、活到 85 岁概率、本周变化、模型版本）。不含任何原始健康值 |
| POST | `/api/lifespan/consent` | `{ "consent_version": "lifespan-consent-1", "granted": true }`；撤回走 DELETE |
| PUT | `/api/lifespan/answers` | 快速问题答案，服务端白名单校验枚举和数值范围 |
| GET | `/api/lifespan/simulation?as_of=` | 完整结果（4.2）+ 每条 `top_changes` 的跳转动作 `action` |
| POST | `/api/lifespan/life-run` | `{ "seed": null }`，服务端生成 seed 并返回一次人生；同 seed 可复现 |
| DELETE | `/api/lifespan/data` | 撤回同意并删除答案和缓存结果 |

`action` 示例：`{ "type": "next_meal", "route": "/pages/index/index", "params": { "focus": "low_sodium" } }`、`{ "type": "nutrition_plan", "route": "/packageExtra/pages/nutrition-plans/index", "params": { "plan": "dash" } }`。首页 preview 现在没有 `focus` 参数，第一版可先跳到首页下一餐区域并带一行提示，第二阶段再给 preview 增加可选关注项（必须走 v3 引擎的营养计划，不另写打分）。

### 4.4 缓存与存储（需迁移，实施前须用户确认目标库）

| 表 | 内容 |
| --- | --- |
| `user_lifespan_consents` | user_id、consent_version、granted_at、withdrawn_at |
| `user_lifespan_answers` | user_id、answers(jsonb，白名单字段)、updated_at |
| `user_lifespan_results` | user_id、as_of、input_hash、engine_version、params_version、seed、summary(jsonb)、result(jsonb)、created_at；唯一键 (user_id, as_of, input_hash, engine_version) |

- 读请求先查 `(user_id, 当前 as_of, input_hash, engine_version)`；命中直接返回，不命中同步计算并写入。
- 只保留每人最近 12 周结果，用于"本周比上周"对比；更早的自动清理。
- 这些都是线上共享库的新表，**建表与任何写入前要先向用户说明并获得确认**；本地联调可用临时 PostgreSQL。

## 5. 页面结构和交互流程

### 5.1 入口

1. **首页卡片**（主包，`pages/index/components/LifespanEntryCard`，放在 `StatsEntry` 附近，可由 `HomeModuleManager` 隐藏）：
   - 就绪：「未来的你 · 寿命模拟」，三条迷你曲线 + 一句"照现在这样吃，活到 85 岁的概率 46%；把饮食吃对 61%"。
   - 未就绪："再记 4 天饮食，就能看到三个你"进度条；未同意时只显示功能介绍，不显示任何估算。
2. **上周回顾**（`packageRecap`）：新增一张卡片"未来的你本周变化"——"把饮食吃对"与"照现在这样吃"的差距本周 +0.2 年、主因"蔬菜多了"；点击进模拟页。模型版本变化时写"模型更新"而不是"你变好/变差"。

### 5.2 模拟页（独立分包 `packageLifespan/pages/index`）

自上而下：

1. 头部：标题、"基于你最近 28 天中的 16 天饮食记录"、完整度、"模拟估算，不用于诊断"。
2. **三个你**：三张并排人物卡（示意形象 + 当前年龄下的体重/BMI/活到此年龄概率/健康状态）。形象标"示意"。
3. **年龄滑块**（当前年龄 → 100）：拖动时三张卡和曲线上的游标同步更新。
4. **曲线切换**：存活概率 / 健康存活（无重大慢病）/ 体重 / 寿命分布。每张图一句话读法（例："到 80 岁，照现在这样吃约 55% 仍在世"）。
5. **健康年数条**：三条横条，健康年 + 带病年。
6. **最值得改的三件事**：按 `top_changes` 排序，每条写现在 → 目标、平均多 X 年（范围）、证据徽标，按钮"让下一餐少盐一点"跳下一餐推荐或饮食方案。
7. **跑一次人生**：生成一条共享随机数的三人人生时间线（事件 + 去世年龄），提示"这只是一次随机结果，不是你的命运"，可再跑一次；"做成分享卡片"。
8. 底部"数据与依据"：数据来源、补问入口、参数来源列表、模型版本、删除数据。

### 5.3 首次流程

首页卡片 → 介绍页（玩法 + 数据用途 + 单独同意勾选）→ 快速问题（≤6 题，可跳过）→ 饮食天数够则直接出结果，不够则出低把握度版本并提示继续记录。

### 5.4 分享卡片

Canvas 2D 生成，复用 `packageRecap/pages/recap/poster.ts` 的绘制与预览/保存/分享模式：

- 默认内容：三条人生的结局一句话（"放飞自我的我：54 岁高血压，72 岁离开；把饮食吃对的我：91 岁还在散步"）、标题"同一个我，三种吃法"、小程序码、"模拟估算，不用于诊断"。
- 默认**不含**体重、BMI、疾病史、真实年龄；用户可逐项打开。先预览完整图片，再决定保存或发送。

## 6. 分包和体积

- 主包只增加首页入口卡片（一个组件 + 少量样式 + `api.ts` 两个方法），目标 ≤6 KB（构建后）。主包仍须 <2 MB，合入前以 `build:weapp` 生产构建实测前后差值，dev 构建体积不可作依据。
- 模拟页与问卷放**新的独立分包** `packageLifespan`，不放 `packageExtra`（注释已说明后者接近上限）。
- 图表**不用 ECharts**（`packageStatsMetabolic` 因 ECharts 单独成包约 600 KB dev 体积），改用 Canvas 2D 手绘折线/面积图，代码估计 8–15 KB。人物形象用 CSS/少量 SVG 或小 PNG（每张 ≤15 KB）。分包预计 60–150 KB。
- 引擎在后端，前端不打包参数表与模型代码。
- 分享卡片的二维码沿用现有小程序码能力，不新增依赖。

## 7. 隐私和同意

健康、体重、病史、吸烟饮酒属于敏感个人信息（PIPL）。设计要求：

1. **单独同意**：第一次进入时单独勾选，说明目的（"用于在食探内生成寿命情景模拟"）、用到哪些数据、保存多久、如何撤回；不与注册或会员协议捆绑；不同意不影响食探其他功能。
2. **最小必要**：只读第 2 节列出的字段；补问全部可跳过；血压/化验值为可选。
3. **隔离与权限**：答案和结果存在独立表，按 user_id 访问；管理后台默认不展示；日志只记录状态码、版本和耗时，不记录答案和结果数值。
4. **不外发**：模拟数据不发给大模型、不进第三方统计；分享卡片默认不含健康数值。
5. **撤回与删除**：设置里"删除寿命模拟数据"即时删除答案和缓存结果，撤回同意后不再计算。
6. **未成年人**：未满 18 岁不开放；年龄缺失时先补生日。
7. **隐私政策与微信隐私保护指引**需同步更新新的处理目的（上线前法务确认）。

## 8. 宣传边界

| 可以说 | 不能说 |
| --- | --- |
| "用你在食探记下的饮食，模拟三种吃法下的未来" | "AI 算出你会活到 86 岁" / "预测你的死亡年龄" |
| "照现在这样吃 vs 把饮食吃对：在这个模型里，活到 85 岁的概率差多少" | "吃对就能多活 10 年"（任何确定性承诺） |
| "参数来自中国大型队列（如 CKB）和公开研究，每个数字都能查到来源" | "经过临床验证" / "医学级" / "国家认证" |
| "一次随机人生，用来感受概率，不是命运" | 把单次人生结果当成个人预测宣传 |
| "模拟估算，不用于诊断" | "诊断""筛查""治疗""降低你的患病风险 X%" |
| "差距主要来自饮食，因为其他习惯在三个你之间保持一致" | "只要用食探就能延寿" |

页面、分享卡片、海报、短视频统一带"模拟估算，不用于诊断"。若宣传中出现具体年数，需注明"模型平均估计，范围 X–Y 年"。是否构成医疗器械取决于宣称用途，保持 wellness/教育定位，上线前做一次合规确认。

## 9. 分阶段实施

| 阶段 | 内容 | 依赖 / 验收 |
| --- | --- | --- |
| P0 对齐（本周） | 确定 4.1/4.2 字段、事件枚举、随机数算法、版本号格式；引擎会话出参数表 v0 与参考实现 | 两会话字段一致；参数表每行有来源或"估计"标注 |
| P1 Go 移植 | `internal/lifespan/engine` + 黄金向量单测；`cmd/lifespan-replay` 只读回放（复用 diet-replay 的只读事务模式）对若干测试账号生成结果到 `.local-state` | 黄金向量全过；回放无写入；结果量级与参考实现、中国模拟研究（理想情景约 +4.8/+5.4 年）方向一致 |
| P2 数据与接口 | 迁移三张表（**先经用户确认**）、同意/补问/模拟/单次人生/删除接口、14 天聚合与缓存 | 接口测试；日志不含健康数值 |
| P3 小程序 | `packageLifespan` 页面、首页卡片（灰度白名单）、同意页与补问 | weapp-devtools 截图验收；主包体积差 ≤6 KB |
| P4 传播 | 跑一次人生分享卡片、上周回顾卡片 | 分享图默认无健康数值；周更不乱跳 |
| P5 校准与放量 | 内部用户反馈、参数复核、文案合规确认后逐步放量 | 用户能复述"这是模拟不是预测"；无投诉性误解 |

上线、部署和镜像推送都由用户单独决定。

## 10. 待用户拍板

1. 功能名是否用"未来的你 · 寿命模拟"。
2. 默认只让饮食分叉（诚实、差距约几年）还是同时提供"加上作息和运动"开关（差距更大、但不再只是饮食）。
3. "放飞自我"取人群较差饮食五分位（推荐）还是用户可拖动的自定义程度（需外推标记）。
4. 饮食记录不足 7 天时，是否允许用"饮食速答"先出低把握度版本。
5. 是否需要会员门槛（例如免费看三条曲线，会员看三件事和不限次"跑一次人生"）。
6. 新建三张表的时机与目标库。
