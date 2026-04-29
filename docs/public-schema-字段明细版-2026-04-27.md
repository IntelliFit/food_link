# public Schema 分层与职责（字段明细版）

## 说明

本文件用于沉淀 `food_link` 当前 `public` schema 的**业务分层 + 主要字段明细**，优先服务于：

- SQL 数据治理
- 后端字段对齐
- 新人快速理解实库

与 [数据库实库Schema分析报告](D:/files/food_link/docs/数据库实库Schema分析报告.md) 的区别：

- 那份更偏“实库现状分析 / 表级判断”
- 这份更偏“按业务域拆解字段职责”

另一个关键校正点：

- 当前 `weapp_user` 的注册时间字段在你的库里是 `create_time`
- 不是部分旧代码/旧 SQL 假设的 `created_at`

## 1) 用户域

### `weapp_user`（用户主表）

- 主键：`id`
- 唯一标识：`openid`（唯一）、`unionid`（可空唯一）
- 基础资料：`avatar`、`nickname`、`telephone`
- 体征与画像：`height`、`weight`、`birthday`、`gender`、`activity_level`
- 健康档案：`health_condition`（jsonb）
- 代谢参数：`bmr`、`tdee`
- 引导与目标：`onboarding_completed`、`diet_goal`
- 隐私设置：`searchable`、`public_records`
- 模式相关：`execution_mode`、`mode_set_by`、`mode_set_at`、`mode_reason`、`mode_commitment_days`、`mode_switch_count_30d`
- 账户权益：`points_balance`
- 邀请关系：`registration_invite_code`、`referred_by_user_id`
- 时间：`create_time`、`update_time`

### `user_health_documents`（用户健康报告 / OCR）

- 主键：`id`
- 关联：`user_id -> weapp_user.id`
- 文档信息：`document_type`、`image_url`
- 解析结果：`extracted_content`（jsonb）
- 时间：`created_at`

### `user_body_metric_settings`（用户体征设置）

- 主键：`user_id`
- 关联：`user_id -> weapp_user.id`
- 设置项：`water_goal_ml`
- 时间：`created_at`、`updated_at`

## 2) 饮食记录域

### `analysis_tasks`（异步分析任务）

- 主键：`id`
- 关联：`user_id`
- 任务维度：`task_type`（food / food_text / health_report 等）
- 输入：`image_url`、`text_input`、`image_paths`（jsonb）、`payload`（jsonb）
- 执行状态：`status`（pending / processing / done / failed / timed_out / violated / cancelled）
- 输出：`result`（jsonb）、`error_message`
- 审核：`is_violated`、`violation_reason`
- 时间：`created_at`、`updated_at`

### `user_food_records`（用户确认后的饮食记录）

- 主键：`id`
- 关联：`user_id`、`source_task_id`
- 记录信息：`meal_type`、`record_time`、`description`、`insight`
- 图片：`image_path`、`image_paths`（jsonb）
- 食物明细：`items`（jsonb）
- 营养汇总：`total_calories`、`total_protein`、`total_carbs`、`total_fat`、`total_weight_grams`
- 营养解释：`pfc_ratio_comment`、`absorption_notes`、`context_advice`
- 场景目标：`diet_goal`、`activity_timing`、`context_state`
- 信息流控制：`hidden_from_feed`
- 时间：`created_at`

### `food_analysis_records`（分析记录沉淀表，RLS 开启）

- 主键：`id`
- 关联：`user_id`、`analysis_task_id`
- 内容：`image_url`、`description`、`insight`、`items`
- 汇总：`total_calories`、`total_protein`、`total_carbs`、`total_fat`
- 分类：`meal_type`
- 时间：`created_at`、`updated_at`

## 3) 食物知识库域

### `food_nutrition_library`（标准营养库）

- 主键：`id`
- 名称：`canonical_name`、`normalized_name`（唯一）
- 三大营养素：`kcal_per_100g`、`protein_per_100g`、`carbs_per_100g`、`fat_per_100g`
- 扩展营养字段：`fiber_per_100g`、`sugar_per_100g`、`sodium_mg_per_100g`、`vitamin_*` 等
- 其他：`is_active`、`source`
- 时间：`created_at`、`updated_at`

### `food_nutrition_aliases`（别名映射）

- 主键：`id`
- 关联：`food_id -> food_nutrition_library.id`
- 别名：`alias_name`、`normalized_alias`（唯一）
- 时间：`created_at`、`updated_at`

### `food_unresolved_logs`（未命中食物日志）

- 主键：`id`
- 关联：`task_id`（可空）
- 名称：`raw_name`、`normalized_name`（唯一）
- 统计：`hit_count`、`first_seen_at`、`last_seen_at`
- 样本：`sample_payload`（jsonb）
- 时间：`created_at`、`updated_at`

## 4) 社交域

### `user_friends`

- 主键：`id`
- 关联：`user_id`、`friend_id`
- 时间：`created_at`

### `friend_requests`

- 主键：`id`
- 关联：`from_user_id`、`to_user_id`
- 状态：`status`（pending / accepted / rejected）
- 时间：`created_at`、`updated_at`

### `feed_likes`

- 主键：`id`
- 关联：`user_id`、`record_id -> user_food_records.id`
- 时间：`created_at`

### `feed_comments`

- 主键：`id`
- 关联：`user_id`、`record_id`
- 内容：`content`
- 楼中楼：`parent_comment_id`、`reply_to_user_id`
- 时间：`created_at`

### `feed_interaction_notifications`

- 主键：`id`
- 关联：`recipient_user_id`、`actor_user_id`、`record_id`、`comment_id`、`parent_comment_id`
- 通知类型：`notification_type`
- 展示：`content_preview`
- 已读：`is_read`、`read_at`
- 时间：`created_at`

## 5) 公共食物库 UGC 域

### `public_food_library`

- 主键：`id`
- 关联：`user_id`、`source_record_id`
- 内容：`food_name`、`description`、`insight`、`items`
- 图片：`image_path`、`image_paths`
- 营养：`total_calories`、`total_protein`、`total_carbs`、`total_fat`
- 商户与地理：`merchant_name`、`merchant_address`、`province`、`city`、`district`、`detail_address`、`latitude`、`longitude`
- 互动统计：`like_count`、`comment_count`、`collection_count`、`avg_rating`
- 质量与状态：`status`、`audit_reject_reason`、`published_at`
- 用户标注：`taste_rating`、`suitable_for_fat_loss`、`user_tags`、`user_notes`
- 时间：`created_at`、`updated_at`

### `public_food_library_likes`

- 主键：`id`
- 关联：`user_id`、`library_item_id`
- 时间：`created_at`

### `public_food_library_comments`

- 主键：`id`
- 关联：`user_id`、`library_item_id`
- 内容：`content`、`rating`
- 时间：`created_at`

### `public_food_library_collections`

- 主键：`id`
- 关联：`user_id`、`library_item_id`
- 时间：`created_at`

## 6) 会员与支付域

### `membership_plan_config`

- 主键：`code`
- 套餐字段：`name`、`tier`、`period`、`duration_months`
- 价格字段：`amount`、`original_amount`
- 权益：`daily_credits`
- 状态与排序：`is_active`、`sort_order`
- 描述：`description`
- 时间：`created_at`、`updated_at`

### `user_pro_memberships`

- 主键：`id`
- 唯一用户：`user_id`（唯一）
- 套餐与状态：`current_plan_code`、`status`
- 生命周期：`first_activated_at`、`current_period_start`、`expires_at`
- 支付信息：`last_paid_at`、`auto_renew`
- 配额：`daily_credits`
- 时间：`created_at`、`updated_at`

### `pro_membership_payment_records`

- 主键：`id`
- 关联：`user_id`、`plan_code`
- 订单：`order_no`（唯一）
- 金额：`amount`、`currency`、`duration_months`
- 支付渠道：`pay_channel`、`trade_type`
- 状态：`status`（pending / paid / failed / closed / refunded）
- 微信字段：`wx_openid`、`wx_prepay_id`、`wx_transaction_id`（唯一）、`wx_bank_type`
- 回调与扩展：`notify_payload`、`extra`
- 时间：`paid_at`、`closed_at`、`refunded_at`、`created_at`、`updated_at`

## 7) 激励 / 积分域

### `user_points_ledger`

- 主键：`id`
- 关联：`user_id`
- 账务：`delta`、`balance_after`
- 事件：`reason`、`meta`
- 时间：`created_at`

### `user_credit_bonus_events`

- 主键：`id`
- 关联：`user_id`、`source_record_id`
- 字段：`bonus_type`、`bonus_date`、`credits`、`meta`
- 时间：`created_at`、`updated_at`

### `user_invite_referrals`

- 主键：`id`
- 关联：`inviter_user_id`、`invitee_user_id`（唯一）
- 邀请：`invite_code`、`source_request_id`
- 状态流：`status`
- 资格与奖励周期：`first_effective_action_at`、`first_effective_action_type`、`reward_start_date`、`reward_end_date`
- 异常：`blocked_reason`
- 时间：`created_at`、`updated_at`

## 8) 健康行为域

### `user_weight_records`

- 主键：`id`
- 关联：`user_id`
- 记录：`recorded_on`、`weight_kg`
- 来源：`source_type`、`client_record_id`
- 备注：`note`
- 时间：`created_at`、`updated_at`

### `user_water_logs`

- 主键：`id`
- 关联：`user_id`
- 记录：`recorded_on`、`recorded_at`、`amount_ml`
- 来源：`source_type`
- 时间：`created_at`

### `user_exercise_logs`

- 主键：`id`
- 关联：`user_id`
- 内容：`exercise_desc`、`calories_burned`
- 日期时间：`recorded_on`、`recorded_at`
- AI 解释：`ai_reasoning`
- 时间：`created_at`

## 9) 保质期提醒域

### `food_expiry_items`

- 主键：`id`
- 关联：`user_id`
- 食物信息：`food_name`、`category`、`quantity_note`
- 存储：`storage_type`
- 时间与状态：`expire_date`、`opened_date`、`status`
- 来源：`source_type`
- 备注：`note`
- 时间：`created_at`、`updated_at`

### `user_food_expiry_items`

- 主键：`id`
- 关联：`user_id`
- 字段：`food_name`、`quantity_text`、`storage_location`、`note`
- 截止：`deadline_at`、`deadline_precision`
- 完成：`completed_at`
- 时间：`created_at`、`updated_at`

### `food_expiry_notification_jobs`

- 主键：`id`
- 关联：`user_id`、`expiry_item_id`
- 发送：`template_id`、`openid`
- 调度状态：`status`、`scheduled_at`、`sent_at`
- 重试：`retry_count`、`max_retry_count`、`last_error`
- 快照：`payload_snapshot`
- 时间：`created_at`、`updated_at`

## 10) 模型治理域

### `model_prompts`

- 主键：`id`
- 维度：`model_type`、`prompt_name`
- 内容：`prompt_content`
- 状态：`is_active`
- 说明：`description`
- 时间：`created_at`、`updated_at`

### `model_prompts_history`

- 主键：`id`
- 关联：`prompt_id`
- 快照：`model_type`、`prompt_name`、`prompt_content`
- 变更：`changed_at`、`change_reason`

## 11) 样本与质检域

### `critical_samples`

- 主键：`id`
- 关联：`user_id -> auth.users.id`
- 字段：`timestamp`、`food_name`、`image_url`
- 质量标注：`ai_weight`、`user_weight`、`deviation_percent`
- 时间：`created_at`

### `critical_samples_weapp`

- 主键：`id`
- 关联：`user_id -> weapp_user.id`
- 字段：`image_path`、`food_name`
- 质量标注：`ai_weight`、`user_weight`、`deviation_percent`
- 时间：`created_at`

## 12) 一个关键提醒

你现在有两套用户主键体系并存：

- `auth.users.id`
- `public.weapp_user.id`

比如：

- `critical_samples` 用的是 `auth.users`
- `critical_samples_weapp` 用的是 `weapp_user`

这在后续做统一权限、数据归档、样本治理时需要特别注意映射关系。
