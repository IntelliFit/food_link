# Food Link 数据库实库 Schema 分析报告

## 说明

本报告基于 `food_link` 当前 Supabase 实库 `ocijuywmkalfmfxquzzf` 的真实 `public` schema 整理，不再仅依赖仓库内 SQL 推断。

本次核对方式：

- 通过项目实际 `SUPABASE_URL` 读取 `rest/v1` 的 OpenAPI schema
- 对每张表补查真实行数
- 对部分疑似旧表补查最近写入时间

这意味着本报告反映的是：

- 当前线上实际存在的表
- 当前线上实际暴露的字段
- 当前线上大致数据规模

但本报告仍不覆盖：

- RLS 策略细节
- 触发器 / 函数 / 索引完整清单
- 非 `public` schema 对象

## 一、总体判断

当前 `public` schema 共 **32 张表**。这套库已经形成较完整的“饮食记录 + AI 分析 + 社区互动 + 健康档案 + 会员”闭环，但也明显存在**新旧模型并存**的问题。

当前最核心的现行业务主链是：

`weapp_user` -> `analysis_tasks` -> `user_food_records` -> `public_food_library`

其中：

- `analysis_tasks` 承担 AI 异步任务过程
- `user_food_records` 承担最终饮食记录事实
- `public_food_library` 承担从私人记录衍生出的公开内容

这条主链是清晰的。问题主要出在：历史旧表还没完全退场，导致 schema 语义不够收敛。

## 二、实库表清单与数据规模

### 1. 主要活跃表

| 表名 | 行数 | 简述 |
|---|---:|---|
| `weapp_user` | 507 | 用户主表 |
| `analysis_tasks` | 3100 | AI 异步分析任务 |
| `user_food_records` | 1952 | 用户饮食记录事实表 |
| `ai_stats_insights` | 1327 | 统计页 AI 洞察缓存 |
| `user_friends` | 274 | 好友关系 |
| `friend_requests` | 167 | 好友申请 |
| `feed_likes` | 118 | 圈子动态点赞 |
| `comment_tasks` | 104 | 评论审核任务 |
| `feed_comments` | 83 | 圈子动态评论 |
| `food_nutrition_library` | 122 | 营养词典主表 |
| `food_nutrition_aliases` | 69 | 营养词典别名表 |
| `user_mode_switch_logs` | 53 | 模式切换日志 |
| `content_violations` | 50 | 违规内容留痕 |
| `public_food_library` | 38 | 公共食物库主表 |
| `feed_interaction_notifications` | 27 | 圈子互动通知 |
| `user_recipes` | 25 | 私人食谱 |
| `user_health_documents` | 17 | 健康报告/OCR |
| `food_unresolved_logs` | 16 | 词典未命中日志 |
| `public_food_library_likes` | 15 | 公共食物库点赞 |

### 2. 小体量或疑似旧表

| 表名 | 行数 | 备注 |
|---|---:|---|
| `critical_samples_weapp` | 7 | 现行样本反馈表 |
| `meal_items` | 7 | 疑似旧明细模型 |
| `public_food_library_comments` | 2 | 现阶段量小但仍在用 |
| `pro_membership_payment_records` | 2 | 会员支付记录 |
| `user_pro_memberships` | 2 | 会员订阅状态 |
| `comment_tasks` `pending` | 0 | 当前无积压 |
| `public_food_library_collections` | 0 | 收藏功能表存在但未实际用起来 |
| `model_prompts_history` | 0 | 提示词历史未跑起来 |
| `staple_meals` | 0 | 疑似旧表 |
| `food_analysis_records` | 1 | 高疑似旧分析结果表 |
| `critical_samples` | 1 | 高疑似旧样本表 |
| `membership_plan_config` | 1 | 会员套餐配置表 |
| `meals` | 3 | 高疑似旧餐次表 |

## 三、按业务域拆分的真实结构

### 1. 用户与健康档案域

#### `weapp_user`

真实字段共 26 个：

- 身份：`id`、`openid`、`unionid`
- 资料：`avatar`、`nickname`、`telephone`
- 健康画像：`height`、`weight`、`birthday`、`gender`、`activity_level`、`health_condition`
- 代谢：`bmr`、`tdee`
- 产品状态：`onboarding_completed`、`diet_goal`
- 隐私配置：`searchable`、`public_records`
- 执行模式：`execution_mode`、`mode_set_by`、`mode_set_at`、`mode_reason`、`mode_commitment_days`、`mode_switch_count_30d`

判断：

- 这是当前真正的用户主表
- 但它已经不是纯账号表，而是“账号 + 健康档案 + 隐私设置 + 策略配置”混合体
- 这不是冗余问题，而是**主表膨胀问题**

#### `user_health_documents`

字段：

- `id`
- `user_id`
- `document_type`
- `image_url`
- `extracted_content`
- `created_at`

作用：

- 存用户体检报告/病例截图与 OCR 结果

#### `user_mode_switch_logs`

字段：

- `id`
- `user_id`
- `from_mode`
- `to_mode`
- `changed_by`
- `reason_code`
- `created_at`

判断：

- 不是废表
- 最新记录到 `2026-04-01`
- 说明模式切换日志在线上确实还在产生

#### `user_recipes`

字段包含：

- `recipe_name`
- `items`
- `total_calories` / `total_protein` / `total_carbs` / `total_fat`
- `tags`
- `meal_type`
- `is_favorite`
- `use_count`
- `last_used_at`

判断：

- 这是当前现行的“常吃组合/一键记录”能力

### 2. AI 分析与记录主链

#### `analysis_tasks`

真实字段 14 个：

- 基本：`id`、`user_id`、`task_type`、`status`
- 输入：`image_url`、`text_input`、`image_paths`、`payload`
- 输出：`result`、`error_message`
- 时间：`created_at`、`updated_at`
- 审核遗留：`is_violated`、`violation_reason`

真实类型分布：

- `food`: 2353
- `food_text`: 681
- `health_report`: 15

判断：

- 这是现行 AI 工作流的绝对中枢
- 也是整库最关键的过程表

#### `user_food_records`

真实字段 23 个：

- 核心：`user_id`、`meal_type`、`record_time`
- 内容：`image_path`、`image_paths`、`description`、`insight`、`items`
- 汇总：`total_calories`、`total_protein`、`total_carbs`、`total_fat`、`total_weight_grams`
- 深度分析扩展：`pfc_ratio_comment`、`absorption_notes`、`context_advice`
- 场景：`diet_goal`、`activity_timing`、`context_state`
- 来源与社交：`source_task_id`、`hidden_from_feed`

补充实况：

- 总记录 1952
- 其中 `source_task_id` 非空 1843
- 说明绝大多数饮食记录来自分析任务结果确认后落库
- `hidden_from_feed = true` 当前为 0，字段已在线上存在但还没实际用起来

判断：

- 当前最核心的事实表
- 和 `analysis_tasks` 不是重复关系，而是“结果确认后沉淀”的上下游关系

#### `ai_stats_insights`

字段：

- `user_id`
- `range_type`
- `generated_date`
- `data_fingerprint`
- `insight_text`

判断：

- 这是成熟且合理的缓存表
- 不冗余，职责清晰

### 3. 公共食物库域

#### `public_food_library`

真实字段 34 个，涵盖：

- 来源：`user_id`、`source_record_id`
- 内容：`image_path`、`image_paths`、`items`、`description`、`insight`
- 营养：`total_calories`、`total_protein`、`total_carbs`、`total_fat`
- 商户与地理：`merchant_name`、`merchant_address`、`detail_address`、`province`、`city`、`district`、`latitude`、`longitude`
- UGC 属性：`food_name`、`taste_rating`、`suitable_for_fat_loss`、`user_tags`、`user_notes`
- 状态与计数：`status`、`published_at`、`like_count`、`comment_count`、`avg_rating`、`collection_count`

实况：

- 总量 38
- `published` 36
- `pending` 2
- `source_record_id` 非空 28

判断：

- 这是标准的“私人记录 -> 审核/分享 -> 公共内容”模型
- 与 `user_food_records` 有关联但不冗余

#### `public_food_library_comments`

字段：

- `user_id`
- `library_item_id`
- `content`
- `rating`
- `created_at`

#### `public_food_library_likes`

字段：

- `user_id`
- `library_item_id`
- `created_at`

#### `public_food_library_collections`

字段：

- `user_id`
- `library_item_id`
- `created_at`

关键发现：

- `public_food_library_likes` 在线上真实存在并有数据（15 条）
- 但仓库里缺它的建表 SQL
- 这是一个明确的 **代码/线上实库/仓库迁移不一致** 信号

### 4. 社交与圈子域

#### `user_friends`

- 双向好友关系

#### `friend_requests`

- 好友申请

#### `feed_likes`

- 对 `user_food_records` 的点赞

#### `feed_comments`

真实字段：

- `user_id`
- `record_id`
- `content`
- `created_at`
- `parent_comment_id`
- `reply_to_user_id`

判断：

- 当前已经支持单层回复

#### `feed_interaction_notifications`

真实字段：

- `recipient_user_id`
- `actor_user_id`
- `record_id`
- `comment_id`
- `parent_comment_id`
- `notification_type`
- `content_preview`
- `is_read`
- `created_at`
- `read_at`

判断：

- 当前社区通知体系是完整可用的

### 5. 审核与违规治理域

#### `comment_tasks`

真实字段：

- `comment_type`
- `target_id`
- `content`
- `rating`
- `status`
- `result`
- `error_message`
- `is_violated`
- `violation_reason`
- `extra`

实况：

- 总量 104
- `feed` 99
- `public_food_library` 5
- `done` 82
- `violated` 15
- `pending` 0
- 最新记录时间到 `2026-04-01`

判断：

- 这不是已经死掉的空表
- 但它已经和当前产品方向发生冲突，因为评论主链近期已改为直接发布
- 它更像**刚退场、尚未收尾的历史任务表**

#### `content_violations`

真实字段：

- `violation_type`
- `violation_category`
- `violation_reason`
- `reference_id`
- `image_url`
- `text_content`

实况：

- 总量 50
- 最新记录到 `2026-03-30`
- 最新一条类型仍是 `comment`

判断：

- 这张表现在更像风控留痕和历史留档
- 不是完全没用，但已经不该继续扩成核心主链

### 6. 会员域

#### `membership_plan_config`

- 套餐配置，1 条

#### `user_pro_memberships`

- 用户当前会员状态，2 条

#### `pro_membership_payment_records`

- 支付订单明细，2 条

判断：

- 数据量小，但这是现行能力，不属于冗余表

### 7. 提示词与模型运营域

#### `model_prompts`

- 当前激活提示词配置，2 条

#### `model_prompts_history`

- 提示词历史，0 条

判断：

- 主表在线
- 历史表预留了，但目前未真正形成迭代闭环

### 8. 营养词典与命中修正域

#### `food_nutrition_library`

- 标准食物营养词典，122 条

#### `food_nutrition_aliases`

- 食物别名映射，69 条

#### `food_unresolved_logs`

- 未命中词日志，16 条
- 最近写入到 `2026-03-30`

判断：

- 这组表不是旧表，反而像一条正在成长的新能力链
- 它们的职责是“营养标准化支撑层”，不是“任务过程表”

## 四、明确存在的重叠与冗余

### 1. `food_analysis_records` 高概率已废弃

真实情况：

- 仅 1 条数据
- 最近更新时间停在 `2026-02-13`
- 字段语义与当前 `analysis_tasks + user_food_records` 组合高度重叠

判断：

- 它很像早期“分析结果直接落表”的旧方案
- 现在已经被现行链路替代

### 2. `meals` / `meal_items` / `staple_meals` 高概率是旧模型

真实情况：

- `meals`: 3
- `meal_items`: 7
- `staple_meals`: 0

语义冲突：

- `meals + meal_items` 是规范化拆表模型
- 当前现行记录模型已经变成 `user_food_records.items`
- 常吃组合则由 `user_recipes` 承担

判断：

- 这组表高度疑似历史遗留
- 当前不应继续往这组表上开发新能力

### 3. `critical_samples` 已被 `critical_samples_weapp` 取代

真实情况：

- `critical_samples`: 1
- `critical_samples_weapp`: 7

判断：

- `critical_samples` 大概率是旧表
- `critical_samples_weapp` 才是当前项目实际使用的样本反馈表

### 4. `comment_tasks` 属于正在退场的过渡表

它和 `feed_comments` / `public_food_library_comments` 不是完全重复，但从当前产品路径看：

- 真实评论现在已经更偏直接入库
- `comment_tasks` 审核中间层的必要性正在下降

判断：

- 不建议立即删
- 但应从“核心在线表”降级为“待清理兼容层”

## 五、当前 schema 的主要风险

### 1. 线上实库与仓库迁移不一致

已确认的一个明确例子：

- 线上存在 `public_food_library_likes`
- 仓库未找到对应建表 SQL

风险：

- 新环境无法一键还原线上结构
- 后续排查“为什么某接口线上有、本地没有”会越来越难

### 2. 新旧模型并存时间过长

当前至少存在三层并行历史：

- 旧餐次模型：`meals` / `meal_items` / `staple_meals`
- 旧分析结果模型：`food_analysis_records`
- 现行任务/事实模型：`analysis_tasks` / `user_food_records`

风险：

- 新人难判断哪张表是主表
- 代码维护中容易误用旧表

### 3. 用户主表过胖

`weapp_user` 已承载：

- 账号身份
- 健康画像
- 隐私配置
- 执行策略

风险：

- 任何一个子域扩展都会继续给主表加字段
- 长期会提高维护成本和接口耦合度

## 六、建议的治理优先级

### P0：先固定“现行真实 schema 基线”

建议输出一份正式基线，至少覆盖：

- 所有当前线上存在的主表
- 当前代码依赖的全部字段
- 所有当前状态枚举
- 当前真实存在但仓库未收口的表，如 `public_food_library_likes`

### P1：给旧表打标签，停止继续扩展

优先标记为“历史表/疑似废弃”的对象：

- `food_analysis_records`
- `meals`
- `meal_items`
- `staple_meals`
- `critical_samples`

### P1：观察 `comment_tasks` 的自然失活

建议连续观察一段时间：

- 是否还有新增写入
- 当前线上是否还有旧 worker 在消费
- 评论直接发布后，这张表是否还能归零

### P2：中长期再考虑拆分 `weapp_user`

可逐步拆成：

- 用户账号主表
- 健康画像表
- 隐私配置表
- 执行策略表

## 七、结论

如果只看“当前线上真实可运行”的角度，这套数据库已经有非常明确的主链路：

- 用户表：`weapp_user`
- AI 任务表：`analysis_tasks`
- 记录事实表：`user_food_records`
- 公开内容表：`public_food_library`

真正需要优先治理的，不是再继续加表，而是：

1. 收口现行 schema 基线
2. 补齐线上存在但仓库缺失的迁移
3. 明确标记并逐步淘汰旧模型表

从实库视角看，当前最明确的历史遗留表是：

- `food_analysis_records`
- `meals`
- `meal_items`
- `staple_meals`
- `critical_samples`

而 `comment_tasks`、`content_violations` 则更像“刚开始退场、但还留有历史写入痕迹”的兼容层。
