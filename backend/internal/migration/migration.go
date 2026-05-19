package migration

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	migrationdo "food_link/backend/internal/migration/do"

	"gorm.io/gorm"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func AutoMigrate(ctx context.Context, db *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	qSchema := quoteIdent(schema)
	if err := db.WithContext(ctx).Exec("CREATE SCHEMA IF NOT EXISTS " + qSchema).Error; err != nil {
		return fmt.Errorf("create schema: %w", err)
	}
	if err := db.WithContext(ctx).Exec("CREATE EXTENSION IF NOT EXISTS pgcrypto").Error; err != nil {
		return fmt.Errorf("create pgcrypto extension: %w", err)
	}
	if err := db.WithContext(ctx).Exec("SET search_path TO " + qSchema).Error; err != nil {
		return fmt.Errorf("set search path: %w", err)
	}
	if err := db.WithContext(ctx).AutoMigrate(migrationdo.AllModels()...); err != nil {
		return fmt.Errorf("auto migrate models: %w", err)
	}
	if err := ensureConstraints(ctx, db); err != nil {
		return err
	}
	if err := ensureIndexes(ctx, db); err != nil {
		return err
	}
	if err := ensureTriggers(ctx, db); err != nil {
		return err
	}
	return nil
}

func quoteIdent(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}

func ensureConstraints(ctx context.Context, db *gorm.DB) error {
	for _, sql := range []string{
		`ALTER TABLE user_credit_bonus_events DROP CONSTRAINT IF EXISTS user_credit_bonus_events_user_id_bonus_type_bonus_date_key`,
		dropAndAddCheck("weapp_user", "weapp_user_gender_check", `gender IS NULL OR gender = ANY (ARRAY['male'::text,'female'::text,'other'::text,''::text])`),
		dropAndAddCheck("weapp_user", "weapp_user_activity_level_check", `activity_level IS NULL OR activity_level = ANY (ARRAY['sedentary'::text,'light'::text,'moderate'::text,'active'::text,'very_active'::text,''::text])`),
		dropAndAddCheck("weapp_user", "weapp_user_execution_mode_check", `execution_mode IS NULL OR execution_mode = ANY (ARRAY['standard'::text,'strict'::text])`),
		dropAndAddCheck("analysis_tasks", "analysis_tasks_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text,'cancelled'::text,'timed_out'::text,'violated'::text])`),
		dropAndAddCheck("analysis_tasks", "analysis_tasks_task_type_check", `task_type = ANY (ARRAY['food'::text,'food_text'::text,'precision_plan'::text,'precision_item_estimate'::text,'precision_aggregate'::text,'health_report'::text,'public_food_library_text'::text,'exercise'::text,'expiry_recognize'::text,'expiry_notification'::text]) OR task_type ~ '^(food|food_text|precision_plan|precision_item_estimate|precision_aggregate|health_report|public_food_library_text|exercise|expiry_recognize|expiry_notification)_debug(_[a-z0-9_]+)?$'`),
		dropAndAddCheck("analysis_feedback_samples", "analysis_feedback_samples_feedback_type_check", `feedback_type = ANY (ARRAY['correction'::text,'retry'::text,'manual_entry'::text,'failed'::text])`),
		dropAndAddCheck("user_food_records", "user_food_records_meal_type_check", `meal_type = ANY (ARRAY['breakfast'::text,'morning_snack'::text,'lunch'::text,'afternoon_snack'::text,'dinner'::text,'evening_snack'::text,'snack'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_source_type_check", `source_type = ANY (ARRAY['image'::text,'text'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_execution_mode_check", `execution_mode = ANY (ARRAY['standard'::text,'strict'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_status_check", `status = ANY (ARRAY['collecting'::text,'estimating'::text,'needs_user_input'::text,'needs_retake'::text,'done'::text,'cancelled'::text,'failed'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_round_index_check", `round_index >= 1`),
		dropAndAddCheck("precision_session_rounds", "precision_session_rounds_actor_role_check", `actor_role = ANY (ARRAY['user'::text,'assistant'::text,'system'::text])`),
		dropAndAddCheck("precision_session_rounds", "precision_session_rounds_round_index_check", `round_index >= 1`),
		dropAndAddCheck("precision_item_estimates", "precision_item_estimates_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text])`),
		dropAndAddCheck("precision_item_estimates", "precision_item_estimates_round_index_check", `round_index >= 1`),
		dropAndAddCheck("precision_item_estimates", "precision_item_estimates_item_index_check", `item_index >= 0`),
		dropAndAddCheck("public_food_library", "public_food_library_status_check", `status = ANY (ARRAY['pending'::text,'published'::text,'rejected'::text,'user_deleted'::text,'deleted'::text])`),
		dropAndAddCheck("public_food_library", "public_food_library_taste_rating_check", `taste_rating IS NULL OR (taste_rating >= 1 AND taste_rating <= 5)`),
		dropAndAddCheck("public_food_library_comments", "public_food_library_comments_rating_check", `rating IS NULL OR (rating >= 1 AND rating <= 5)`),
		dropAndAddCheck("feed_interaction_notifications", "feed_interaction_notifications_type_check", `notification_type = ANY (ARRAY['like_received'::text,'comment_received'::text,'reply_received'::text,'comment_rejected'::text])`),
		dropAndAddCheck("comment_tasks", "comment_tasks_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text,'violated'::text])`),
		dropAndAddCheck("comment_tasks", "comment_tasks_type_check", `comment_type = ANY (ARRAY['feed'::text,'public_food_library'::text])`),
		dropAndAddCheck("food_expiry_items", "food_expiry_items_storage_type_check", `storage_type = ANY (ARRAY['room_temp'::text,'refrigerated'::text,'frozen'::text])`),
		dropAndAddCheck("food_expiry_items", "food_expiry_items_source_type_check", `source_type = ANY (ARRAY['manual'::text,'ocr'::text,'ai'::text])`),
		dropAndAddCheck("food_expiry_items", "food_expiry_items_status_check", `status = ANY (ARRAY['active'::text,'consumed'::text,'discarded'::text])`),
		dropAndAddCheck("food_expiry_notification_jobs", "food_expiry_notification_jobs_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'sent'::text,'failed'::text,'cancelled'::text])`),
		dropAndAddCheck("food_expiry_notification_jobs", "food_expiry_notification_jobs_retry_count_check", `retry_count >= 0`),
		dropAndAddCheck("food_expiry_notification_jobs", "food_expiry_notification_jobs_max_retry_count_check", `max_retry_count >= 0`),
		dropAndAddCheck("friend_requests", "friend_requests_no_self", `from_user_id <> to_user_id`),
		dropAndAddCheck("friend_requests", "friend_requests_status_check", `status = ANY (ARRAY['pending'::text,'accepted'::text,'rejected'::text])`),
		dropAndAddCheck("user_friends", "user_friends_no_self", `user_id <> friend_id`),
		dropAndAddCheck("user_weight_records", "user_weight_records_weight_kg_check", `weight_kg >= 20 AND weight_kg <= 300`),
		dropAndAddCheck("user_weight_records", "user_weight_records_source_type_check", `source_type = ANY (ARRAY['manual'::text,'imported'::text,'ai'::text])`),
		dropAndAddCheck("user_water_logs", "user_water_logs_amount_ml_check", `amount_ml > 0 AND amount_ml <= 5000`),
		dropAndAddCheck("user_water_logs", "user_water_logs_source_type_check", `source_type = ANY (ARRAY['manual'::text,'imported'::text,'ai'::text])`),
		dropAndAddCheck("user_body_metric_settings", "user_body_metric_settings_water_goal_ml_check", `water_goal_ml >= 500 AND water_goal_ml <= 10000`),
		dropAndAddCheck("user_exercise_logs", "user_exercise_logs_calories_burned_check", `calories_burned >= 0 AND calories_burned <= 5000`),
		dropAndAddCheck("ai_stats_insights", "ai_stats_insights_range_type_check", `range_type = ANY (ARRAY['week'::text,'month'::text])`),
		dropAndAddCheck("membership_plan_config", "membership_plan_config_tier_check", `tier IS NULL OR tier = ANY (ARRAY['light'::text,'standard'::text,'advanced'::text])`),
		dropAndAddCheck("membership_plan_config", "membership_plan_config_period_check", `period IS NULL OR period = ANY (ARRAY['monthly'::text,'quarterly'::text,'yearly'::text])`),
		dropAndAddCheck("user_invite_referrals", "user_invite_referrals_status_check", `status = ANY (ARRAY['pending_qualified'::text,'reward_active'::text,'reward_completed'::text,'reward_blocked'::text,'cancelled'::text])`),
		dropAndAddCheck("user_credit_bonus_events", "user_credit_bonus_events_bonus_type_check", `bonus_type = ANY (ARRAY['share_poster'::text])`),
		dropAndAddCheck("user_credit_bonus_events", "user_credit_bonus_events_credits_check", `credits >= 0`),
		dropAndAddCheck("user_earned_credit_ledger", "user_earned_credit_ledger_balance_after_check", `balance_after >= 0`),
		addFK("analysis_tasks_user_id_fkey", "analysis_tasks", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("analysis_feedback_samples_user_id_fkey", "analysis_feedback_samples", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("analysis_feedback_samples_source_task_id_fkey", "analysis_feedback_samples", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("analysis_feedback_samples_correction_task_id_fkey", "analysis_feedback_samples", "correction_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("analysis_feedback_samples_root_task_id_fkey", "analysis_feedback_samples", "root_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("user_food_records_user_id_fkey", "user_food_records", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_food_records_source_task_id_fkey", "user_food_records", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("food_nutrition_aliases_food_id_fkey", "food_nutrition_aliases", "food_id", "food_nutrition_library", "id", "CASCADE"),
		addFK("packaged_food_aliases_food_id_fkey", "packaged_food_aliases", "food_id", "packaged_food_library", "id", "CASCADE"),
		addFK("food_unresolved_logs_task_id_fkey", "food_unresolved_logs", "task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("critical_samples_weapp_user_id_fkey", "critical_samples_weapp", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("precision_sessions_user_id_fkey", "precision_sessions", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("precision_sessions_current_task_id_fkey", "precision_sessions", "current_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("precision_session_rounds_session_id_fkey", "precision_session_rounds", "session_id", "precision_sessions", "id", "CASCADE"),
		addFK("precision_item_estimates_session_id_fkey", "precision_item_estimates", "session_id", "precision_sessions", "id", "CASCADE"),
		addFK("precision_item_estimates_source_task_id_fkey", "precision_item_estimates", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("public_food_library_user_id_fkey", "public_food_library", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_source_record_id_fkey", "public_food_library", "source_record_id", "user_food_records", "id", "SET NULL"),
		addFK("public_food_library_likes_user_id_fkey", "public_food_library_likes", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_likes_library_item_id_fkey", "public_food_library_likes", "library_item_id", "public_food_library", "id", "CASCADE"),
		addFK("public_food_library_collections_user_id_fkey", "public_food_library_collections", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_collections_library_item_id_fkey", "public_food_library_collections", "library_item_id", "public_food_library", "id", "CASCADE"),
		addFK("public_food_library_comments_user_id_fkey", "public_food_library_comments", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_comments_library_item_id_fkey", "public_food_library_comments", "library_item_id", "public_food_library", "id", "CASCADE"),
		addFK("public_food_library_feedback_user_id_fkey", "public_food_library_feedback", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_feedback_library_item_id_fkey", "public_food_library_feedback", "library_item_id", "public_food_library", "id", "SET NULL"),
		addFK("feed_likes_user_id_fkey", "feed_likes", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("feed_likes_record_id_fkey", "feed_likes", "record_id", "user_food_records", "id", "CASCADE"),
		addFK("feed_comments_user_id_fkey", "feed_comments", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("feed_comments_record_id_fkey", "feed_comments", "record_id", "user_food_records", "id", "CASCADE"),
		addFK("feed_comments_parent_comment_id_fkey", "feed_comments", "parent_comment_id", "feed_comments", "id", "CASCADE"),
		addFK("feed_comments_reply_to_user_id_fkey", "feed_comments", "reply_to_user_id", "weapp_user", "id", "SET NULL"),
		addFK("feed_interaction_notifications_recipient_user_id_fkey", "feed_interaction_notifications", "recipient_user_id", "weapp_user", "id", "CASCADE"),
		addFK("feed_interaction_notifications_actor_user_id_fkey", "feed_interaction_notifications", "actor_user_id", "weapp_user", "id", "SET NULL"),
		addFK("feed_interaction_notifications_record_id_fkey", "feed_interaction_notifications", "record_id", "user_food_records", "id", "CASCADE"),
		addFK("feed_interaction_notifications_comment_id_fkey", "feed_interaction_notifications", "comment_id", "feed_comments", "id", "CASCADE"),
		addFK("feed_interaction_notifications_parent_comment_id_fkey", "feed_interaction_notifications", "parent_comment_id", "feed_comments", "id", "CASCADE"),
		addFK("comment_tasks_user_id_fkey", "comment_tasks", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_expiry_items_user_id_fkey", "food_expiry_items", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_expiry_notification_jobs_user_id_fkey", "food_expiry_notification_jobs", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("food_expiry_notification_jobs_expiry_item_id_fkey", "food_expiry_notification_jobs", "expiry_item_id", "food_expiry_items", "id", "CASCADE"),
		addFK("friend_requests_from_user_id_fkey", "friend_requests", "from_user_id", "weapp_user", "id", "CASCADE"),
		addFK("friend_requests_to_user_id_fkey", "friend_requests", "to_user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_friends_user_id_fkey", "user_friends", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_friends_friend_id_fkey", "user_friends", "friend_id", "weapp_user", "id", "CASCADE"),
		addFK("user_weight_records_user_id_fkey", "user_weight_records", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_water_logs_user_id_fkey", "user_water_logs", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_body_metric_settings_user_id_fkey", "user_body_metric_settings", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_exercise_logs_user_id_fkey", "user_exercise_logs", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("ai_stats_insights_user_id_fkey", "ai_stats_insights", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pro_memberships_user_id_fkey", "user_pro_memberships", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pro_memberships_current_plan_code_fkey", "user_pro_memberships", "current_plan_code", "membership_plan_config", "code", "SET NULL"),
		addFK("pro_membership_payment_records_user_id_fkey", "pro_membership_payment_records", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("pro_membership_payment_records_plan_code_fkey", "pro_membership_payment_records", "plan_code", "membership_plan_config", "code", "RESTRICT"),
		addFK("user_invite_referrals_inviter_user_id_fkey", "user_invite_referrals", "inviter_user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_invite_referrals_invitee_user_id_fkey", "user_invite_referrals", "invitee_user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_credit_bonus_events_user_id_fkey", "user_credit_bonus_events", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_credit_bonus_events_source_record_id_fkey", "user_credit_bonus_events", "source_record_id", "user_food_records", "id", "SET NULL"),
		addFK("user_earned_credit_ledger_user_id_fkey", "user_earned_credit_ledger", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("membership_share_rewards_user_id_fkey", "membership_share_rewards", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("membership_share_rewards_record_id_fkey", "membership_share_rewards", "record_id", "user_food_records", "id", "CASCADE"),
		addFK("user_recipes_user_id_fkey", "user_recipes", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_health_documents_user_id_fkey", "user_health_documents", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_mode_switch_logs_user_id_fkey", "user_mode_switch_logs", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("test_prompt_history_prompt_id_fkey", "test_prompt_history", "prompt_id", "test_prompts", "id", "CASCADE"),
		addFK("test_batches_dataset_id_fkey", "test_batches", "dataset_id", "test_datasets", "id", "CASCADE"),
	} {
		if sql == "" {
			continue
		}
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("apply constraint/index statement: %w", err)
		}
	}
	return nil
}

func ensureIndexes(ctx context.Context, db *gorm.DB) error {
	for _, sql := range []string{
		`CREATE UNIQUE INDEX IF NOT EXISTS precision_item_estimates_session_round_item_key_key ON precision_item_estimates (session_id, round_index, item_key)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_food_records_user_task_unique ON user_food_records (user_id, source_task_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS public_food_library_likes_unique ON public_food_library_likes (user_id, library_item_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS public_food_library_collections_unique ON public_food_library_collections (user_id, library_item_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS feed_likes_unique ON feed_likes (user_id, record_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS food_expiry_notification_jobs_item_template_schedule_unique ON food_expiry_notification_jobs (expiry_item_id, template_id, scheduled_at)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pair ON friend_requests (from_user_id, to_user_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_friends_unique ON user_friends (user_id, friend_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ai_stats_insights_user_range_date_unique ON ai_stats_insights (user_id, range_type, generated_date)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_user_credit_bonus_share_poster_record ON user_credit_bonus_events (user_id, bonus_type, bonus_date, source_record_id) WHERE bonus_type = 'share_poster' AND source_record_id IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_earned_credit_ledger_user_reason_source ON user_earned_credit_ledger (user_id, reason, source_key) WHERE source_key IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_weight_records_user_client_record_id ON user_weight_records (user_id, client_record_id) WHERE client_record_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_user_food_records_hidden_from_feed ON user_food_records (hidden_from_feed) WHERE hidden_from_feed = false`,
	} {
		if sql == "" {
			continue
		}
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("apply index statement: %w", err)
		}
	}
	return nil
}

func ensureTriggers(ctx context.Context, db *gorm.DB) error {
	for _, sql := range []string{
		`CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql`,
		`DROP TRIGGER IF EXISTS trigger_update_food_expiry_notification_jobs_updated_at ON food_expiry_notification_jobs`,
		`CREATE TRIGGER trigger_update_food_expiry_notification_jobs_updated_at BEFORE UPDATE ON food_expiry_notification_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`,
		`DROP TRIGGER IF EXISTS trigger_update_user_recipes_updated_at ON user_recipes`,
		`CREATE TRIGGER trigger_update_user_recipes_updated_at BEFORE UPDATE ON user_recipes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`,
	} {
		if sql == "" {
			continue
		}
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("apply trigger statement: %w", err)
		}
	}
	return nil
}

func dropAndAddCheck(table, name, expression string) string {
	return fmt.Sprintf(`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = '%s'
      AND conrelid = '%s'::regclass
  ) THEN
    ALTER TABLE %s DROP CONSTRAINT %s;
  END IF;
  ALTER TABLE %s ADD CONSTRAINT %s CHECK (%s);
END $$`, name, table, table, name, table, name, expression)
}

func addFK(name, table, column, refTable, refColumn, onDelete string) string {
	return fmt.Sprintf(`
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = '%s'
      AND conrelid = '%s'::regclass
  ) THEN
    ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s (%s) ON DELETE %s;
  END IF;
END $$`, name, table, table, name, column, refTable, refColumn, onDelete)
}
