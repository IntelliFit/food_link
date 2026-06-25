package migration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	migrationdo "food_link/backend/internal/migration/do"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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
	if err := db.WithContext(ctx).Exec("CREATE EXTENSION IF NOT EXISTS pg_trgm").Error; err != nil {
		return fmt.Errorf("create pg_trgm extension: %w", err)
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
	if err := ensureExerciseEnergySeed(ctx, db); err != nil {
		return err
	}
	if err := ensurePublicFoodTypeBackfill(ctx, db); err != nil {
		return err
	}
	if err := ensureTrialEntitlementBackfill(ctx, db); err != nil {
		return err
	}
	if err := ensureTriggers(ctx, db); err != nil {
		return err
	}
	if err := ensureSchoolsSeed(ctx, db); err != nil {
		return err
	}
	if err := ensureCampusDirectorySeed(ctx, db); err != nil {
		return err
	}
	if err := ensureCampusDirectoryImportBatchSeed(ctx, db); err != nil {
		return err
	}
	if err := ensureCampusDirectoryPendingResearchSeed(ctx, db); err != nil {
		return err
	}
	if err := ensurePublicFoodCampusDirectoryBackfill(ctx, db); err != nil {
		return err
	}
	if err := ensureMottoColumn(ctx, db); err != nil {
		return err
	}
	if err := ensurePublicRecordsDefault(ctx, db); err != nil {
		return err
	}
	if err := ensureRecipeIDColumn(ctx, db); err != nil {
		return err
	}
	if err := ensureAdminResolutionColumns(ctx, db); err != nil {
		return err
	}
	if err := ensureFoodWeightLabeledSamplesStructuredLabels(ctx, db); err != nil {
		return err
	}
	if err := ensurePaymentTestConfig(ctx, db); err != nil {
		return err
	}
	if err := ensureMembershipGrantConfig(ctx, db); err != nil {
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
		dropAndAddCheck("weapp_user", "weapp_user_execution_mode_check", `execution_mode IS NULL OR execution_mode = ANY (ARRAY['standard'::text,'standard_web_search'::text,'fast'::text,'fast_web_search'::text,'strict'::text,'strict_web_search'::text,'experimental'::text,'gemini35_flash'::text,'gemini35_flash_grouped'::text])`),
		dropAndAddCheck("weapp_user", "weapp_user_last_login_method_check", `last_login_method IS NULL OR last_login_method = ANY (ARRAY['wechat_miniprogram'::text,'wechat_app'::text,'password'::text,'sms_code'::text,'development_test_openid'::text,'debug_impersonate'::text])`),
		dropAndAddCheck("weapp_user", "weapp_user_telephone_format_check", `telephone IS NULL OR trim(telephone) = '' OR regexp_replace(trim(telephone), '[\s\-\(\)]', '', 'g') ~ '^(\+?86)?1[3-9][0-9]{9}$'`),
		`DELETE FROM user_feedback WHERE status = 'processing'`,
		`DELETE FROM feed_reports WHERE status = 'processing'`,
		dropAndAddCheck("user_feedback", "user_feedback_category_check", `category = ANY (ARRAY['bug'::text,'suggestion'::text,'experience'::text,'other'::text])`),
		dropAndAddCheck("user_feedback", "user_feedback_status_check", `status = ANY (ARRAY['open'::text,'resolved'::text,'closed'::text])`),
		dropAndAddCheck("user_feedback", "user_feedback_reward_credits_check", `reward_credits >= 0`),
		dropAndAddCheck("admin_accounts", "admin_accounts_status_check", `status = ANY (ARRAY['active'::text,'disabled'::text])`),
		dropAndAddCheck("analysis_tasks", "analysis_tasks_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text,'cancelled'::text,'timed_out'::text,'violated'::text])`),
		dropAndAddCheck("analysis_tasks", "analysis_tasks_task_type_check", `task_type = ANY (ARRAY['food'::text,'food_text'::text,'precision_plan'::text,'precision_item_estimate'::text,'precision_aggregate'::text,'health_report'::text,'public_food_library_text'::text,'exercise'::text,'expiry_recognize'::text,'expiry_notification'::text,'packaged_nutrition_label'::text,'packaged_product_extract'::text]) OR task_type ~ '^(food|food_text|precision_plan|precision_item_estimate|precision_aggregate|health_report|public_food_library_text|exercise|expiry_recognize|expiry_notification|packaged_nutrition_label|packaged_product_extract)_debug(_[a-z0-9_]+)?$'`),
		dropAndAddCheck("exercise_energy_library", "exercise_energy_library_review_status_check", `review_status = ANY (ARRAY['pending'::text,'active'::text,'disabled'::text])`),
		dropAndAddCheck("exercise_energy_library", "exercise_energy_library_met_value_check", `met_value > 0 AND met_value <= 30`),
		dropAndAddCheck("analysis_feedback_samples", "analysis_feedback_samples_feedback_type_check", `feedback_type = ANY (ARRAY['correction'::text,'retry'::text,'manual_entry'::text,'failed'::text,'weight_mismatch'::text,'nutrition_mismatch'::text,'suspect_distrust'::text,'record_corrected'::text])`),
		dropAndAddCheck("analysis_feedback_samples", "analysis_feedback_samples_resolution_state_check", `resolution_state = ANY (ARRAY['user_corrected'::text,'still_distrust'::text])`),
		dropAndAddCheck("user_food_records", "user_food_records_meal_type_check", `meal_type = ANY (ARRAY['breakfast'::text,'morning_snack'::text,'lunch'::text,'afternoon_snack'::text,'dinner'::text,'evening_snack'::text,'snack'::text])`),
		dropAndAddCheck("user_food_records", "user_food_records_entry_type_check", `entry_type = ANY (ARRAY['food_image'::text,'food_text'::text,'food_library'::text,'favorite_recipe'::text,'analyze_history'::text,'campus_canteen'::text,'public_food_library'::text,'unknown'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_source_type_check", `source_type = ANY (ARRAY['image'::text,'text'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_execution_mode_check", `execution_mode = ANY (ARRAY['standard'::text,'standard_web_search'::text,'fast'::text,'fast_web_search'::text,'strict'::text,'strict_web_search'::text,'experimental'::text,'gemini35_flash'::text,'gemini35_flash_grouped'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_status_check", `status = ANY (ARRAY['collecting'::text,'estimating'::text,'needs_user_input'::text,'needs_retake'::text,'done'::text,'cancelled'::text,'failed'::text])`),
		dropAndAddCheck("precision_sessions", "precision_sessions_round_index_check", `round_index >= 1`),
		dropAndAddCheck("precision_session_rounds", "precision_session_rounds_actor_role_check", `actor_role = ANY (ARRAY['user'::text,'assistant'::text,'system'::text])`),
		dropAndAddCheck("precision_session_rounds", "precision_session_rounds_round_index_check", `round_index >= 1`),
		dropAndAddCheck("precision_item_estimates", "precision_item_estimates_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text])`),
		dropAndAddCheck("precision_item_estimates", "precision_item_estimates_round_index_check", `round_index >= 1`),
		dropAndAddCheck("precision_item_estimates", "precision_item_estimates_item_index_check", `item_index >= 0`),
		dropAndAddCheck("public_food_library", "public_food_library_status_check", `status = ANY (ARRAY['pending'::text,'published'::text,'rejected'::text,'user_deleted'::text,'deleted'::text])`),
		dropAndAddCheck("public_food_library", "public_food_library_type_check", `type = ANY (ARRAY['common'::text,'campus'::text])`),
		dropAndAddCheck("public_food_library", "public_food_library_taste_rating_check", `taste_rating IS NULL OR (taste_rating >= 1 AND taste_rating <= 5)`),
		dropAndAddCheck("public_food_library", "public_food_library_price_type_check", `price_type IS NULL OR price_type = ANY (ARRAY['fixed'::text,'weight'::text,'range'::text,'combo'::text,'unknown'::text])`),
		dropAndAddCheck("public_food_library_comments", "public_food_library_comments_rating_check", `rating IS NULL OR (rating >= 1 AND rating <= 5)`),
		dropAndAddCheck("school_campuses", "school_campuses_status_check", `status = ANY (ARRAY['pending_review'::text,'active'::text,'inactive'::text,'deleted'::text])`),
		dropAndAddCheck("school_canteens", "school_canteens_status_check", `status = ANY (ARRAY['pending_review'::text,'active'::text,'inactive'::text,'rejected'::text,'deleted'::text])`),
		dropAndAddCheck("school_canteens", "school_canteens_confidence_level_check", `confidence_level IS NULL OR confidence_level = ANY (ARRAY['A'::text,'B'::text,'C'::text,'D'::text])`),
		dropAndAddCheck("canteen_windows", "canteen_windows_status_check", `status = ANY (ARRAY['active'::text,'inactive'::text,'deleted'::text])`),
		dropAndAddCheck("campus_canteen_applications", "campus_canteen_applications_status_check", `status = ANY (ARRAY['pending'::text,'approved'::text,'rejected'::text])`),
		dropAndAddCheck("campus_directory_import_batches", "campus_directory_import_batches_status_check", `status = ANY (ARRAY['pending_review'::text,'collecting'::text,'ready_for_review'::text,'approved'::text,'rejected'::text,'archived'::text])`),
		dropAndAddCheck("campus_directory_sources", "campus_directory_sources_review_status_check", `review_status = ANY (ARRAY['pending_review'::text,'approved'::text,'rejected'::text])`),
		dropAndAddCheck("campus_directory_sources", "campus_directory_sources_evidence_level_check", `evidence_level IS NULL OR evidence_level = ANY (ARRAY['A'::text,'B'::text,'C'::text,'D'::text])`),
		dropAndAddCheck("user_custom_foods", "user_custom_foods_status_check", `status = ANY (ARRAY['active'::text,'deleted'::text])`),
		dropAndAddCheck("user_custom_foods", "user_custom_foods_public_status_check", `public_status = ANY (ARRAY['private'::text,'pending'::text,'published'::text,'rejected'::text])`),
		dropAndAddCheck("feed_interaction_notifications", "feed_interaction_notifications_type_check", `notification_type = ANY (ARRAY['like_received'::text,'comment_received'::text,'reply_received'::text,'comment_rejected'::text])`),
		dropAndAddCheck("feed_likes", "feed_likes_target_type_check", `target_type = ANY (ARRAY['food_record'::text,'exercise_log'::text,'circle_post'::text])`),
		dropAndAddCheck("feed_comments", "feed_comments_target_type_check", `target_type = ANY (ARRAY['food_record'::text,'exercise_log'::text,'circle_post'::text])`),
		dropAndAddCheck("feed_interaction_notifications", "feed_interaction_notifications_target_type_check", `target_type = ANY (ARRAY['food_record'::text,'exercise_log'::text,'circle_post'::text])`),
		dropAndAddCheck("comment_tasks", "comment_tasks_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text,'violated'::text])`),
		dropAndAddCheck("comment_tasks", "comment_tasks_type_check", `comment_type = ANY (ARRAY['feed'::text,'public_food_library'::text])`),
		dropAndAddCheck("feed_reports", "feed_reports_status_check", `status = ANY (ARRAY['pending'::text,'resolved'::text,'rejected'::text])`),
		dropAndAddCheck("feed_reports", "feed_reports_reason_check", `reason = ANY (ARRAY['spam'::text,'porn'::text,'illegal'::text,'abuse'::text,'other'::text])`),
		dropAndAddCheck("feed_reports", "feed_reports_target_type_check", `target_type = ANY (ARRAY['food_record'::text,'exercise_log'::text,'circle_post'::text])`),
		dropAndAddCheck("food_expiry_items", "food_expiry_items_storage_type_check", `storage_type = ANY (ARRAY['room_temp'::text,'refrigerated'::text,'frozen'::text])`),
		dropAndAddCheck("food_expiry_items", "food_expiry_items_source_type_check", `source_type = ANY (ARRAY['manual'::text,'ocr'::text,'ai'::text])`),
		dropAndAddCheck("food_expiry_items", "food_expiry_items_status_check", `status = ANY (ARRAY['active'::text,'consumed'::text,'discarded'::text])`),
		dropAndAddCheck("food_expiry_notification_jobs", "food_expiry_notification_jobs_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'sent'::text,'failed'::text,'cancelled'::text])`),
		dropAndAddCheck("food_expiry_notification_jobs", "food_expiry_notification_jobs_retry_count_check", `retry_count >= 0`),
		dropAndAddCheck("food_expiry_notification_jobs", "food_expiry_notification_jobs_max_retry_count_check", `max_retry_count >= 0`),
		dropAndAddCheck("friend_requests", "friend_requests_no_self", `from_user_id <> to_user_id`),
		dropAndAddCheck("friend_requests", "friend_requests_status_check", `status = ANY (ARRAY['pending'::text,'accepted'::text,'rejected'::text])`),
		dropAndAddCheck("user_friends", "user_friends_no_self", `user_id <> friend_id`),
		dropAndAddCheck("private_messages", "private_messages_content_type_check", `content_type = ANY (ARRAY['text'::text,'image'::text,'system'::text])`),
		dropAndAddCheck("private_message_reports", "private_message_reports_reason_check", `reason = ANY (ARRAY['spam'::text,'porn'::text,'illegal'::text,'abuse'::text,'other'::text])`),
		dropAndAddCheck("private_message_reports", "private_message_reports_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'resolved'::text,'rejected'::text])`),
		dropAndAddCheck("user_weight_records", "user_weight_records_weight_kg_check", `weight_kg >= 20 AND weight_kg <= 300`),
		dropAndAddCheck("user_weight_records", "user_weight_records_source_type_check", `source_type = ANY (ARRAY['manual'::text,'imported'::text,'ai'::text])`),
		dropAndAddCheck("user_water_logs", "user_water_logs_amount_ml_check", `amount_ml > 0 AND amount_ml <= 5000`),
		dropAndAddCheck("user_water_logs", "user_water_logs_source_type_check", `source_type = ANY (ARRAY['manual'::text,'imported'::text,'ai'::text]) OR source_type ~ '^ai_food_record:[0-9a-fA-F-]{36}$'`),
		dropAndAddCheck("user_body_metric_settings", "user_body_metric_settings_water_goal_ml_check", `water_goal_ml >= 500 AND water_goal_ml <= 10000`),
		dropAndAddCheck("user_exercise_logs", "user_exercise_logs_calories_burned_check", `calories_burned >= 0 AND calories_burned <= 5000`),
		dropAndAddCheck("ai_stats_insights", "ai_stats_insights_range_type_check", `range_type = ANY (ARRAY['week'::text,'month'::text])`),
		dropAndAddCheck("ai_custom_focus_cards", "ai_custom_focus_cards_range_type_check", `range_type = ANY (ARRAY['week'::text,'month'::text])`),
		dropAndAddCheck("membership_plan_config", "membership_plan_config_tier_check", `tier IS NULL OR tier = ANY (ARRAY['light'::text,'standard'::text,'advanced'::text])`),
		dropAndAddCheck("membership_plan_config", "membership_plan_config_period_check", `period IS NULL OR period = ANY (ARRAY['monthly'::text,'quarterly'::text,'yearly'::text])`),
		dropAndAddCheck("pro_membership_payment_records", "pro_membership_payment_records_status_check", `status = ANY (ARRAY['pending'::text,'paid'::text,'failed'::text,'cancelled'::text,'expired'::text,'closed'::text,'refunded'::text])`),
		dropAndAddCheck("membership_payment_test_settings", "membership_payment_test_settings_id_check", `id = 'default'`),
		dropAndAddCheck("user_invite_referrals", "user_invite_referrals_status_check", `status = ANY (ARRAY['pending_qualified'::text,'reward_active'::text,'reward_completed'::text,'reward_blocked'::text,'cancelled'::text])`),
		dropAndAddCheck("user_membership_grants", "user_membership_grants_grant_days_check", `grant_days > 0`),
		dropAndAddCheck("user_membership_grants", "user_membership_grants_status_check", `status = ANY (ARRAY['applied'::text,'cancelled'::text])`),
		dropAndAddCheck("user_membership_grants", "user_membership_grants_role_check", `role IS NULL OR role = ANY (ARRAY['inviter'::text,'invitee'::text])`),
		dropAndAddCheck("user_pets", "user_pets_level_check", `level >= 1`),
		dropAndAddCheck("user_pets", "user_pets_experience_check", `experience >= 0`),
		dropAndAddCheck("user_pets", "user_pets_total_events_check", `total_events >= 0`),
		dropAndAddCheck("food_weight_labeled_samples", "food_weight_labeled_samples_label_type_check", `label_type = ANY (ARRAY['total'::text,'items'::text,'unlabeled'::text])`),
		dropAndAddCheck("food_weight_labeled_samples", "food_weight_labeled_samples_status_check", `status = ANY (ARRAY['labeled'::text,'unlabeled'::text])`),
		dropAndAddCheck("benchmark_runs", "benchmark_runs_status_check", `status = ANY (ARRAY['pending'::text,'running'::text,'done'::text,'failed'::text,'cancelled'::text])`),
		dropAndAddCheck("benchmark_run_samples", "benchmark_run_samples_status_check", `status = ANY (ARRAY['pending'::text,'processing'::text,'done'::text,'failed'::text,'cancelled'::text])`),
		addFK("benchmark_runs_created_by_fkey", "benchmark_runs", "created_by", "admin_accounts", "id", "SET NULL"),
		dropAndAddCheck("user_pet_events", "user_pet_events_event_type_check", `event_type = ANY (ARRAY['offline_review'::text])`),
		dropAndAddCheck("user_pet_events", "user_pet_events_habit_score_check", `habit_score >= 0`),
		dropAndAddCheck("user_pet_events", "user_pet_events_rewards_check", `exp_reward >= 0 AND credit_reward >= 0 AND credit_reward <= 2`),
		dropAndAddCheck("user_pet_daily_scores", "user_pet_daily_scores_score_check", `habit_score >= 0 AND exp_gained >= 0`),
		dropAndAddCheck("user_credit_bonus_events", "user_credit_bonus_events_bonus_type_check", `bonus_type = ANY (ARRAY['share_poster'::text])`),
		dropAndAddCheck("user_credit_bonus_events", "user_credit_bonus_events_credits_check", `credits >= 0`),
		dropAndAddCheck("reward_task_uploads", "reward_task_uploads_task_type_check", `task_type = ANY (ARRAY['packaged_food_upload'::text,'public_food_upload'::text])`),
		dropAndAddCheck("reward_task_uploads", "reward_task_uploads_status_check", `status = ANY (ARRAY['pending'::text,'succeeded'::text,'failed'::text])`),
		dropAndAddCheck("reward_task_uploads", "reward_task_uploads_reward_credits_check", `reward_credits >= 0`),
		dropAndAddCheck("user_earned_credit_ledger", "user_earned_credit_ledger_balance_after_check", `balance_after >= 0`),
		addFK("analysis_tasks_user_id_fkey", "analysis_tasks", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_feedback_user_id_fkey", "user_feedback", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_feedback_reward_ledger_id_fkey", "user_feedback", "reward_ledger_id", "user_earned_credit_ledger", "id", "SET NULL"),
		addFK("analysis_feedback_samples_user_id_fkey", "analysis_feedback_samples", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("analysis_feedback_samples_source_task_id_fkey", "analysis_feedback_samples", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("analysis_feedback_samples_correction_task_id_fkey", "analysis_feedback_samples", "correction_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("analysis_feedback_samples_root_task_id_fkey", "analysis_feedback_samples", "root_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("analysis_feedback_samples_source_record_id_fkey", "analysis_feedback_samples", "source_record_id", "user_food_records", "id", "SET NULL"),
		addFK("user_food_records_user_id_fkey", "user_food_records", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_food_records_source_task_id_fkey", "user_food_records", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("user_circle_posts_user_id_fkey", "user_circle_posts", "user_id", "weapp_user", "id", "CASCADE"),
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
		addFK("public_food_library_analysis_task_id_fkey", "public_food_library", "analysis_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("school_campuses_school_id_fkey", "school_campuses", "school_id", "schools", "id", "CASCADE"),
		addFK("school_canteens_school_id_fkey", "school_canteens", "school_id", "schools", "id", "CASCADE"),
		addFK("school_canteens_campus_id_fkey", "school_canteens", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("canteen_windows_school_id_fkey", "canteen_windows", "school_id", "schools", "id", "CASCADE"),
		addFK("canteen_windows_campus_id_fkey", "canteen_windows", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("canteen_windows_canteen_id_fkey", "canteen_windows", "canteen_id", "school_canteens", "id", "CASCADE"),
		addFK("campus_canteen_applications_user_id_fkey", "campus_canteen_applications", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("campus_canteen_applications_school_id_fkey", "campus_canteen_applications", "school_id", "schools", "id", "CASCADE"),
		addFK("campus_canteen_applications_campus_id_fkey", "campus_canteen_applications", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("campus_canteen_applications_canteen_id_fkey", "campus_canteen_applications", "canteen_id", "school_canteens", "id", "SET NULL"),
		addFK("campus_directory_sources_batch_id_fkey", "campus_directory_sources", "batch_id", "campus_directory_import_batches", "id", "SET NULL"),
		addFK("campus_directory_sources_school_id_fkey", "campus_directory_sources", "school_id", "schools", "id", "CASCADE"),
		addFK("campus_directory_sources_campus_id_fkey", "campus_directory_sources", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("campus_directory_sources_canteen_id_fkey", "campus_directory_sources", "canteen_id", "school_canteens", "id", "SET NULL"),
		addFK("public_food_library_school_id_fkey", "public_food_library", "school_id", "schools", "id", "SET NULL"),
		addFK("public_food_library_campus_id_fkey", "public_food_library", "campus_id", "school_campuses", "id", "SET NULL"),
		addFK("public_food_library_canteen_id_fkey", "public_food_library", "canteen_id", "school_canteens", "id", "SET NULL"),
		addFK("public_food_library_window_id_fkey", "public_food_library", "window_id", "canteen_windows", "id", "SET NULL"),
		addFK("public_food_library_likes_user_id_fkey", "public_food_library_likes", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_likes_library_item_id_fkey", "public_food_library_likes", "library_item_id", "public_food_library", "id", "CASCADE"),
		addFK("public_food_library_collections_user_id_fkey", "public_food_library_collections", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_collections_library_item_id_fkey", "public_food_library_collections", "library_item_id", "public_food_library", "id", "CASCADE"),
		addFK("public_food_library_comments_user_id_fkey", "public_food_library_comments", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_comments_library_item_id_fkey", "public_food_library_comments", "library_item_id", "public_food_library", "id", "CASCADE"),
		addFK("public_food_library_comments_parent_comment_id_fkey", "public_food_library_comments", "parent_comment_id", "public_food_library_comments", "id", "CASCADE"),
		addFK("public_food_library_comments_reply_to_user_id_fkey", "public_food_library_comments", "reply_to_user_id", "weapp_user", "id", "SET NULL"),
		addFK("public_food_library_feedback_user_id_fkey", "public_food_library_feedback", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("public_food_library_feedback_library_item_id_fkey", "public_food_library_feedback", "library_item_id", "public_food_library", "id", "SET NULL"),
		addFK("user_custom_foods_user_id_fkey", "user_custom_foods", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_custom_foods_public_food_item_id_fkey", "user_custom_foods", "public_food_item_id", "public_food_library", "id", "SET NULL"),
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
		addFK("exercise_energy_aliases_activity_id_fkey", "exercise_energy_aliases", "activity_id", "exercise_energy_library", "id", "CASCADE"),
		addFK("ai_stats_insights_user_id_fkey", "ai_stats_insights", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("ai_custom_focus_cards_user_id_fkey", "ai_custom_focus_cards", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pro_memberships_user_id_fkey", "user_pro_memberships", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pro_memberships_current_plan_code_fkey", "user_pro_memberships", "current_plan_code", "membership_plan_config", "code", "SET NULL"),
		addFK("user_membership_grants_user_id_fkey", "user_membership_grants", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_membership_grants_plan_code_fkey", "user_membership_grants", "plan_code", "membership_plan_config", "code", "RESTRICT"),
		addFK("user_membership_grants_referral_id_fkey", "user_membership_grants", "referral_id", "user_invite_referrals", "id", "SET NULL"),
		addFK("pro_membership_payment_records_user_id_fkey", "pro_membership_payment_records", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("pro_membership_payment_records_plan_code_fkey", "pro_membership_payment_records", "plan_code", "membership_plan_config", "code", "RESTRICT"),
		addFK("membership_payment_test_users_user_id_fkey", "membership_payment_test_users", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_invite_referrals_inviter_user_id_fkey", "user_invite_referrals", "inviter_user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_invite_referrals_invitee_user_id_fkey", "user_invite_referrals", "invitee_user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pets_user_id_fkey", "user_pets", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pet_events_user_id_fkey", "user_pet_events", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_pet_events_pet_id_fkey", "user_pet_events", "pet_id", "user_pets", "id", "CASCADE"),
		addFK("user_pet_daily_scores_user_id_fkey", "user_pet_daily_scores", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_credit_bonus_events_user_id_fkey", "user_credit_bonus_events", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("user_credit_bonus_events_source_record_id_fkey", "user_credit_bonus_events", "source_record_id", "user_food_records", "id", "SET NULL"),
		addFK("reward_task_uploads_user_id_fkey", "reward_task_uploads", "user_id", "weapp_user", "id", "CASCADE"),
		addFK("reward_task_uploads_source_task_id_fkey", "reward_task_uploads", "source_task_id", "analysis_tasks", "id", "SET NULL"),
		addFK("reward_task_uploads_packaged_food_id_fkey", "reward_task_uploads", "packaged_food_id", "packaged_food_library", "id", "SET NULL"),
		addFK("reward_task_uploads_public_food_item_id_fkey", "reward_task_uploads", "public_food_item_id", "public_food_library", "id", "SET NULL"),
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
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS app_openid text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS app_unionid text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS username text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS password_hash text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS password_set_at timestamptz`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS last_login_method text`,
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS last_login_at timestamptz`,
		`UPDATE weapp_user SET username = lower(trim(username)) WHERE username IS NOT NULL AND username <> lower(trim(username))`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_weapp_user_app_openid ON weapp_user (app_openid) WHERE app_openid IS NOT NULL AND app_openid <> ''`,
		`CREATE INDEX IF NOT EXISTS idx_weapp_user_app_unionid ON weapp_user (app_unionid) WHERE app_unionid IS NOT NULL AND app_unionid <> ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_weapp_user_username ON weapp_user (lower(username)) WHERE username IS NOT NULL AND username <> ''`,
		`CREATE INDEX IF NOT EXISTS idx_weapp_user_telephone ON weapp_user (telephone) WHERE telephone IS NOT NULL AND telephone <> ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_weapp_user_telephone_normalized_unique ON weapp_user ((
CASE
  WHEN regexp_replace(trim(telephone), '[\s\-\(\)]', '', 'g') ~ '^\+?86(1[3-9][0-9]{9})$'
    THEN regexp_replace(regexp_replace(trim(telephone), '[\s\-\(\)]', '', 'g'), '^\+?86', '')
  ELSE regexp_replace(trim(telephone), '[\s\-\(\)]', '', 'g')
END
)) WHERE telephone IS NOT NULL AND trim(telephone) <> ''`,
		`ALTER TABLE membership_plan_config ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true`,
		`ALTER TABLE membership_plan_config ADD COLUMN IF NOT EXISTS is_test_plan boolean NOT NULL DEFAULT false`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_membership_payment_test_users_user_id ON membership_payment_test_users (user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_membership_payment_test_users_created_at ON membership_payment_test_users (created_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_membership_grants_source_key ON user_membership_grants (source_key)`,
		`CREATE INDEX IF NOT EXISTS idx_user_membership_grants_user_created ON user_membership_grants (user_id, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_user_membership_grants_referral_role ON user_membership_grants (referral_id, role)`,
		`ALTER TABLE packaged_food_library DROP CONSTRAINT IF EXISTS packaged_food_library_normalized_name_key`,
		`DROP INDEX IF EXISTS uni_packaged_food_library_normalized_name`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS product_key text NOT NULL DEFAULT ''`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS display_name text NOT NULL DEFAULT ''`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS search_text text NOT NULL DEFAULT ''`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS product_family_key text NOT NULL DEFAULT ''`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS spec_text text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS barcode text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS flavor_text text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS package_category text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS ingredients_text text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS source_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS ocr_raw_text text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS nutrition_basis_unit text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS energy_unit_raw text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS raw_label_payload jsonb NOT NULL DEFAULT '{}'::jsonb`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS conversion_status text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS extract_confidence numeric NOT NULL DEFAULT 0`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS field_confidence jsonb NOT NULL DEFAULT '{}'::jsonb`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS ingest_method text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS net_content_value numeric NOT NULL DEFAULT 0`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS net_content_unit text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS unit_count numeric NOT NULL DEFAULT 0`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS unit_content_value numeric NOT NULL DEFAULT 0`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS unit_content_unit text`,
		`ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'active'`,
		`ALTER TABLE food_nutrition_library ADD COLUMN IF NOT EXISTS image_path text`,
		`ALTER TABLE food_nutrition_library ADD COLUMN IF NOT EXISTS image_paths jsonb NOT NULL DEFAULT '[]'::jsonb`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS analysis_task_id uuid`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_analysis_task_id ON public_food_library (analysis_task_id)`,
		`ALTER TABLE packaged_food_aliases DROP CONSTRAINT IF EXISTS packaged_food_aliases_normalized_alias_key`,
		`DROP INDEX IF EXISTS uni_packaged_food_aliases_normalized_alias`,
		`DROP INDEX IF EXISTS packaged_food_aliases_normalized_alias_key`,
		`ALTER TABLE reward_task_uploads ADD COLUMN IF NOT EXISTS source_key text`,
		`ALTER TABLE user_exercise_logs ADD COLUMN IF NOT EXISTS image_url text`,
		`ALTER TABLE user_exercise_logs ADD COLUMN IF NOT EXISTS exercise_type text`,
		`ALTER TABLE user_exercise_logs ADD COLUMN IF NOT EXISTS exercise_items jsonb NOT NULL DEFAULT '[]'::jsonb`,
		`ALTER TABLE user_exercise_logs ALTER COLUMN exercise_items SET DEFAULT '[]'::jsonb`,
		`UPDATE user_exercise_logs SET exercise_items = '[]'::jsonb WHERE exercise_items IS NULL`,
		`ALTER TABLE user_exercise_logs ALTER COLUMN exercise_items SET NOT NULL`,
		`ALTER TABLE user_exercise_logs ADD COLUMN IF NOT EXISTS hidden_from_feed boolean NOT NULL DEFAULT false`,
		`ALTER TABLE user_food_records ADD COLUMN IF NOT EXISTS entry_type text`,
		`ALTER TABLE feed_likes ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'food_record'`,
		`ALTER TABLE feed_likes ADD COLUMN IF NOT EXISTS target_id uuid`,
		`UPDATE feed_likes SET target_type = 'food_record', target_id = record_id WHERE target_id IS NULL AND record_id IS NOT NULL`,
		`ALTER TABLE feed_likes ALTER COLUMN record_id DROP NOT NULL`,
		`ALTER TABLE feed_likes ALTER COLUMN target_id SET NOT NULL`,
		`ALTER TABLE feed_comments ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'food_record'`,
		`ALTER TABLE feed_comments ADD COLUMN IF NOT EXISTS target_id uuid`,
		`UPDATE feed_comments SET target_type = 'food_record', target_id = record_id WHERE target_id IS NULL AND record_id IS NOT NULL`,
		`ALTER TABLE feed_comments ALTER COLUMN record_id DROP NOT NULL`,
		`ALTER TABLE feed_comments ALTER COLUMN target_id SET NOT NULL`,
		`ALTER TABLE feed_interaction_notifications ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'food_record'`,
		`ALTER TABLE feed_interaction_notifications ADD COLUMN IF NOT EXISTS target_id uuid`,
		`UPDATE feed_interaction_notifications SET target_type = 'food_record', target_id = record_id WHERE target_id IS NULL AND record_id IS NOT NULL`,
		`ALTER TABLE ai_stats_insights ADD COLUMN IF NOT EXISTS generation_count integer NOT NULL DEFAULT 1`,
		`ALTER TABLE user_credit_bonus_events ADD COLUMN IF NOT EXISTS source_scope text`,
		`ALTER TABLE user_credit_bonus_events ADD COLUMN IF NOT EXISTS source_key text`,
		`UPDATE user_credit_bonus_events
SET source_scope = COALESCE(NULLIF(source_scope, ''), 'meal_record'),
    source_key = COALESCE(NULLIF(source_key, ''), 'meal_record:' || source_record_id::text),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'source_scope', COALESCE(NULLIF(source_scope, ''), 'meal_record'),
      'source_key', COALESCE(NULLIF(source_key, ''), 'meal_record:' || source_record_id::text)
    )
WHERE bonus_type = 'share_poster'
  AND source_record_id IS NOT NULL
  AND COALESCE(source_key, '') = ''`,
		`UPDATE packaged_food_library
SET product_key = LOWER(
  regexp_replace(
    COALESCE(NULLIF(brand, ''), '') ||
    COALESCE(NULLIF(product_name, ''), '') ||
    COALESCE(NULLIF(flavor_text, ''), '') ||
    COALESCE(
      NULLIF(spec_text, ''),
      CASE
        WHEN COALESCE(net_weight_g, 0) > 0 THEN regexp_replace(trim(to_char(net_weight_g, 'FM999999990.00')), '[^[:alnum:]]', '', 'g') || 'g'
        ELSE ''
      END
    ),
    '[^[:alnum:]]',
    '',
    'g'
  )
)
WHERE COALESCE(product_key, '') = ''`,
		`UPDATE packaged_food_library
SET net_content_value = COALESCE(NULLIF(net_content_value, 0), NULLIF(net_weight_g, 0), 0),
    net_content_unit = COALESCE(NULLIF(net_content_unit, ''), CASE WHEN COALESCE(net_weight_g, 0) > 0 THEN 'g' ELSE NULL END),
    display_name = COALESCE(NULLIF(display_name, ''), trim(concat_ws(' ',
      NULLIF(brand, ''),
      NULLIF(product_name, ''),
      NULLIF(flavor_text, ''),
      CASE
        WHEN COALESCE(net_weight_g, 0) > 0 THEN regexp_replace(trim(to_char(net_weight_g, 'FM999999990.00')), '\.?0+$', '') || 'g'
        ELSE NULLIF(spec_text, '')
      END
    ))),
    product_family_key = COALESCE(NULLIF(product_family_key, ''), lower(regexp_replace(COALESCE(NULLIF(brand, ''), '') || COALESCE(NULLIF(product_name, ''), ''), '[^[:alnum:]]', '', 'g'))),
    search_text = COALESCE(NULLIF(search_text, ''), trim(concat_ws(' ',
      NULLIF(brand, ''),
      NULLIF(product_name, ''),
      NULLIF(flavor_text, ''),
      NULLIF(spec_text, ''),
      NULLIF(barcode, ''),
      NULLIF(package_category, ''),
      NULLIF(display_name, ''),
      NULLIF(ocr_raw_text, '')
    ))),
    review_status = COALESCE(NULLIF(review_status, ''), 'active')
WHERE COALESCE(display_name, '') = ''
   OR COALESCE(search_text, '') = ''
   OR COALESCE(product_family_key, '') = ''
   OR COALESCE(net_content_value, 0) = 0
   OR COALESCE(review_status, '') = ''`,
		`DROP INDEX IF EXISTS idx_packaged_food_library_product_key`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_product_key ON packaged_food_library (product_key)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_display_name ON packaged_food_library (display_name)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_family_key ON packaged_food_library (product_family_key)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_review_status ON packaged_food_library (review_status)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_aliases_normalized_alias ON packaged_food_aliases (normalized_alias)`,
		`CREATE INDEX IF NOT EXISTS idx_packaged_food_library_barcode ON packaged_food_library (barcode) WHERE barcode IS NOT NULL AND barcode <> ''`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_task_uploads_source_key ON reward_task_uploads (source_key) WHERE source_key IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS precision_item_estimates_session_round_item_key_key ON precision_item_estimates (session_id, round_index, item_key)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_food_records_user_task_unique ON user_food_records (user_id, source_task_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS public_food_library_likes_unique ON public_food_library_likes (user_id, library_item_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS public_food_library_collections_unique ON public_food_library_collections (user_id, library_item_id)`,
		`ALTER TABLE public_food_library_comments ADD COLUMN IF NOT EXISTS parent_comment_id uuid`,
		`ALTER TABLE public_food_library_comments ADD COLUMN IF NOT EXISTS reply_to_user_id uuid`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_parent_comment_id ON public_food_library_comments (parent_comment_id)`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_reply_to_user_id ON public_food_library_comments (reply_to_user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_comments_item_parent_created ON public_food_library_comments (library_item_id, parent_comment_id, created_at)`,
		`ALTER TABLE feed_likes DROP CONSTRAINT IF EXISTS feed_likes_unique`,
		`DROP INDEX IF EXISTS feed_likes_unique`,
		`CREATE UNIQUE INDEX IF NOT EXISTS feed_likes_unique_target ON feed_likes (user_id, target_type, target_id)`,
		`CREATE INDEX IF NOT EXISTS idx_feed_comments_target_created_at ON feed_comments (target_type, target_id, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_feed_interaction_notifications_target ON feed_interaction_notifications (target_type, target_id)`,
		`CREATE INDEX IF NOT EXISTS idx_user_circle_posts_user_created_hidden ON user_circle_posts (user_id, created_at DESC) WHERE hidden_from_feed = false`,
		`CREATE UNIQUE INDEX IF NOT EXISTS food_expiry_notification_jobs_item_template_schedule_unique ON food_expiry_notification_jobs (expiry_item_id, template_id, scheduled_at)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_requests_pair ON friend_requests (from_user_id, to_user_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_friends_unique ON user_friends (user_id, friend_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_follows_unique ON user_follows (follower_id, followee_id)`,
		`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz`,
		`ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS deleted_by_user_id uuid`,
		`CREATE INDEX IF NOT EXISTS idx_private_messages_conversation ON private_messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_private_messages_unread ON private_messages (receiver_id, sender_id) WHERE is_read = false`,
		`CREATE INDEX IF NOT EXISTS idx_private_messages_active_conversation ON private_messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC) WHERE deleted_at IS NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_private_message_reports_reporter_message_unique ON private_message_reports (reporter_user_id, message_id)`,
		`CREATE INDEX IF NOT EXISTS idx_private_message_reports_reported_status ON private_message_reports (reported_user_id, status, created_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ai_stats_insights_user_range_date_unique ON ai_stats_insights (user_id, range_type, generated_date)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS ai_custom_focus_cards_user_range_focus_unique ON ai_custom_focus_cards (user_id, range_type, focus_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_user_credit_bonus_share_poster_record ON user_credit_bonus_events (user_id, bonus_type, bonus_date, source_record_id) WHERE bonus_type = 'share_poster' AND source_record_id IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_user_credit_bonus_share_poster_source_key ON user_credit_bonus_events (user_id, bonus_type, bonus_date, source_key) WHERE bonus_type = 'share_poster' AND source_key IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_earned_credit_ledger_user_reason_source ON user_earned_credit_ledger (user_id, reason, source_key) WHERE source_key IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_pets_user_id_unique ON user_pets (user_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_pet_events_user_date_type_unique ON user_pet_events (user_id, event_date, event_type)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS user_pet_daily_scores_user_date_unique ON user_pet_daily_scores (user_id, score_date)`,
		`CREATE INDEX IF NOT EXISTS idx_pet_chat_sessions_user_updated ON pet_chat_sessions (user_id, range_type, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_pet_chat_sessions_user_status ON pet_chat_sessions (user_id, status, updated_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_pet_chat_messages_session_created ON pet_chat_messages (session_id, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_pet_chat_messages_user_created ON pet_chat_messages (user_id, created_at DESC)`,
		addFK("fk_pet_chat_messages_session", "pet_chat_messages", "session_id", "pet_chat_sessions", "id", "CASCADE"),
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_food_weight_labeled_samples_batch_sample ON food_weight_labeled_samples (batch_name, sample_name)`,
		`CREATE INDEX IF NOT EXISTS idx_food_weight_labeled_samples_batch ON food_weight_labeled_samples (batch_name)`,
		`CREATE INDEX IF NOT EXISTS idx_food_weight_labeled_samples_label_type ON food_weight_labeled_samples (label_type)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_runs_status ON benchmark_runs (status)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created_at ON benchmark_runs (created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_run_samples_run_id ON benchmark_run_samples (run_id)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_run_samples_sample_id ON benchmark_run_samples (sample_id)`,
		`CREATE INDEX IF NOT EXISTS idx_benchmark_run_samples_task_id ON benchmark_run_samples (task_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_weight_records_user_client_record_id ON user_weight_records (user_id, client_record_id) WHERE client_record_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_user_food_records_hidden_from_feed ON user_food_records (hidden_from_feed) WHERE hidden_from_feed = false`,
		// Campus food library columns
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS is_campus_food boolean NOT NULL DEFAULT false`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS school_id uuid`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS campus_id uuid`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS canteen_id uuid`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS window_id uuid`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS school_name text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS campus_name text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS canteen_name text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS floor text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS window_name text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price numeric`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_type text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_min numeric`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_max numeric`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_unit text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS price_collected_at timestamptz`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS portion_description text`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS is_campus_highlight boolean NOT NULL DEFAULT false`,
		`ALTER TABLE public_food_library ADD COLUMN IF NOT EXISTS campus_location_text text`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_is_campus ON public_food_library (is_campus_food)`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_school_id ON public_food_library (school_id) WHERE school_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_campus_id ON public_food_library (campus_id) WHERE campus_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_canteen_id ON public_food_library (canteen_id) WHERE canteen_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_window_id ON public_food_library (window_id) WHERE window_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_school ON public_food_library (school_name) WHERE school_name IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_canteen ON public_food_library (canteen_name) WHERE canteen_name IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_campus_highlight ON public_food_library (is_campus_highlight) WHERE is_campus_highlight = true`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_campus_published ON public_food_library (is_campus_food, status, published_at) WHERE is_campus_food = true`,
		`CREATE INDEX IF NOT EXISTS idx_public_food_library_price_type ON public_food_library (price_type) WHERE price_type IS NOT NULL`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_school_campuses_school_name_active ON school_campuses (school_id, lower(name)) WHERE status <> 'deleted'`,
		`DROP INDEX IF EXISTS idx_school_canteens_campus_name_active`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_school_canteens_campus_name_active ON school_canteens (school_id, COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) WHERE status NOT IN ('deleted', 'rejected')`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_canteen_windows_canteen_name_active ON canteen_windows (canteen_id, lower(name)) WHERE status <> 'deleted'`,
		`CREATE INDEX IF NOT EXISTS idx_school_canteens_school_status ON school_canteens (school_id, status, sort_order, name)`,
		`CREATE INDEX IF NOT EXISTS idx_school_campuses_school_status ON school_campuses (school_id, status, sort_order, name)`,
		`CREATE INDEX IF NOT EXISTS idx_campus_canteen_applications_school_status ON campus_canteen_applications (school_id, status, created_at DESC)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_campus_directory_import_batches_name_unique ON campus_directory_import_batches (name)`,
		`CREATE INDEX IF NOT EXISTS idx_campus_directory_import_batches_status ON campus_directory_import_batches (status, created_at DESC)`,
		`CREATE INDEX IF NOT EXISTS idx_campus_directory_sources_batch_status ON campus_directory_sources (batch_id, review_status, created_at DESC) WHERE batch_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_campus_directory_sources_url ON campus_directory_sources (source_url)`,
		// Analysis tasks search text column + index for name-based search
		`ALTER TABLE analysis_tasks ADD COLUMN IF NOT EXISTS search_text text`,
		`UPDATE analysis_tasks SET search_text = COALESCE(NULLIF(text_input, ''), result->'items'->0->>'name', result->>'description', '') WHERE search_text IS NULL OR search_text = ''`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_tasks_user_search_gin ON analysis_tasks USING gin (search_text gin_trgm_ops)`,
		// Community search trigram indexes for keyword matching
		`CREATE INDEX IF NOT EXISTS idx_weapp_user_nickname_gin ON weapp_user USING gin (nickname gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_user_food_records_desc_gin ON user_food_records USING gin ((COALESCE(description, '')) gin_trgm_ops) WHERE hidden_from_feed = false`,
		`CREATE INDEX IF NOT EXISTS idx_user_exercise_logs_desc_gin ON user_exercise_logs USING gin ((COALESCE(exercise_desc, '')) gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_exercise_energy_library_search_gin ON exercise_energy_library USING gin (((COALESCE(canonical_name, '') || ' ' || COALESCE(category, '') || ' ' || COALESCE(evidence, ''))) gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_exercise_energy_aliases_alias_gin ON exercise_energy_aliases USING gin ((COALESCE(alias_name, '')) gin_trgm_ops)`,
		`CREATE INDEX IF NOT EXISTS idx_user_circle_posts_search_gin ON user_circle_posts USING gin (((COALESCE(title, '') || ' ' || COALESCE(body, ''))) gin_trgm_ops)`,
		// Analysis feedback samples extra columns/indexes for frontend tracking
		`ALTER TABLE analysis_feedback_samples ADD COLUMN IF NOT EXISTS resolution_state text NOT NULL DEFAULT 'user_corrected'`,
		`ALTER TABLE analysis_feedback_samples ADD COLUMN IF NOT EXISTS source_record_id uuid`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_feedback_samples_source_record_id ON analysis_feedback_samples (source_record_id)`,
		`CREATE INDEX IF NOT EXISTS idx_analysis_feedback_samples_resolution_state ON analysis_feedback_samples (resolution_state)`,
		// School badge logo URL
		`ALTER TABLE schools ADD COLUMN IF NOT EXISTS logo_url text`,
		// Circle posts: title/body split + extended nutrition fields
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS title text`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS body text`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS fiber numeric(10,2)`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS sugar numeric(10,2)`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS sodium_mg numeric(10,2)`,
		`ALTER TABLE user_circle_posts ADD COLUMN IF NOT EXISTS total_weight_grams numeric(10,2)`,
		`UPDATE user_circle_posts SET body = content WHERE body IS NULL AND content IS NOT NULL AND content <> ''`,
		`UPDATE user_circle_posts SET content = '' WHERE content IS NULL`,
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
		`DROP TRIGGER IF EXISTS trigger_update_user_circle_posts_updated_at ON user_circle_posts`,
		`CREATE TRIGGER trigger_update_user_circle_posts_updated_at BEFORE UPDATE ON user_circle_posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`,
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

func ensurePublicFoodTypeBackfill(ctx context.Context, db *gorm.DB) error {
	sql := `
UPDATE public_food_library
SET type = CASE WHEN COALESCE(is_campus_food, false) THEN 'campus' ELSE 'common' END
WHERE type IS NULL OR type = '' OR (type = 'common' AND COALESCE(is_campus_food, false) = true)
`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("backfill public_food_library type: %w", err)
	}
	return nil
}

func ensureTrialEntitlementBackfill(ctx context.Context, db *gorm.DB) error {
	sql := `
WITH ranked_users AS (
  SELECT
    id,
    openid,
    unionid,
    create_time,
    ROW_NUMBER() OVER (
      ORDER BY create_time IS NULL ASC, create_time ASC, id ASC
    ) AS registration_rank
  FROM weapp_user
  WHERE openid IS NOT NULL AND openid <> ''
),
prepared AS (
  SELECT
    gen_random_uuid() AS id,
    id AS first_user_id,
    openid,
    unionid,
    COALESCE(create_time, now()) AS first_registered_at,
    CASE
      WHEN registration_rank <= 1000 THEN registration_rank
      ELSE NULL
    END AS early_user_rank,
    CASE
      WHEN registration_rank <= 500 THEN 60
      WHEN registration_rank <= 1000 THEN 30
      ELSE 3
    END AS trial_days_total,
    CASE
      WHEN registration_rank <= 500 THEN 'founding_top_500_bonus_month'
      WHEN registration_rank <= 1000 THEN 'early_first_1000'
      ELSE 'regular_new_user'
    END AS trial_policy,
    now() AS created_at,
    now() AS updated_at
  FROM ranked_users
)
INSERT INTO user_trial_entitlements (
  id,
  first_user_id,
  openid,
  unionid,
  first_registered_at,
  early_user_rank,
  trial_days_total,
  trial_policy,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.first_user_id,
  p.openid,
  p.unionid,
  p.first_registered_at,
  p.early_user_rank,
  p.trial_days_total,
  p.trial_policy,
  p.created_at,
  p.updated_at
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1
  FROM user_trial_entitlements e
  WHERE e.openid = p.openid
     OR (p.unionid IS NOT NULL AND e.unionid = p.unionid)
);`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("backfill user trial entitlements: %w", err)
	}
	return nil
}

func ensureSchoolsSeed(ctx context.Context, db *gorm.DB) error {
	var count int64
	if err := db.WithContext(ctx).Raw("SELECT COUNT(*) FROM schools").Scan(&count).Error; err != nil {
		return fmt.Errorf("count schools: %w", err)
	}
	if count > 0 {
		return nil
	}

	data, err := os.ReadFile("data/schools_seed.json")
	if err != nil {
		return fmt.Errorf("read schools seed file: %w", err)
	}

	var seeds []struct {
		Name     string  `json:"name"`
		Province *string `json:"province"`
		City     *string `json:"city"`
		Level    *string `json:"level"`
		Is985    *bool   `json:"is_985"`
		Is211    *bool   `json:"is_211"`
	}
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("parse schools seed file: %w", err)
	}

	for _, s := range seeds {
		do := migrationdo.SchoolDO{
			Name:     s.Name,
			Province: s.Province,
			City:     s.City,
			Level:    s.Level,
			Is985:    s.Is985,
			Is211:    s.Is211,
			Status:   "active",
		}
		if err := db.WithContext(ctx).Create(&do).Error; err != nil {
			return fmt.Errorf("insert school %q: %w", s.Name, err)
		}
	}
	return nil
}

type campusDirectorySeed struct {
	School    string              `json:"school"`
	SourceURL string              `json:"source_url"`
	Campuses  []campusSeed        `json:"campuses"`
	Canteens  []campusCanteenSeed `json:"canteens"`
}

type campusSeed struct {
	Name      string `json:"name"`
	SourceURL string `json:"source_url"`
}

type campusCanteenSeed struct {
	Campus string `json:"campus"`
	Name   string `json:"name"`
}

type campusDirectoryImportBatchSeed struct {
	Name          string `json:"name"`
	Region        string `json:"region"`
	SourceScope   string `json:"source_scope"`
	Status        string `json:"status"`
	TotalSchools  int    `json:"total_schools"`
	TotalCampuses int    `json:"total_campuses"`
	TotalCanteens int    `json:"total_canteens"`
	TotalWindows  int    `json:"total_windows"`
	TotalSources  int    `json:"total_sources"`
	Notes         string `json:"notes"`
}

type campusDirectoryPendingResearchSeed struct {
	BatchName   string                        `json:"batch_name"`
	Region      string                        `json:"region"`
	SourceScope string                        `json:"source_scope"`
	Schools     []campusDirectoryResearchItem `json:"schools"`
}

type campusDirectoryResearchItem struct {
	School       string                           `json:"school"`
	ReviewStatus string                           `json:"review_status"`
	Campuses     []campusDirectoryResearchCampus  `json:"campuses"`
	Canteens     []campusDirectoryResearchCanteen `json:"canteens"`
	Notes        []string                         `json:"notes"`
}

type campusDirectoryResearchCampus struct {
	Name      string   `json:"name"`
	Aliases   []string `json:"aliases"`
	Address   string   `json:"address"`
	SourceURL string   `json:"source_url"`
}

type campusDirectoryResearchCanteen struct {
	Campus          string   `json:"campus"`
	Name            string   `json:"name"`
	Aliases         []string `json:"aliases"`
	LocationText    string   `json:"location_text"`
	BuildingOrFloor string   `json:"building_or_floor"`
	ServiceType     string   `json:"service_type"`
	Audience        string   `json:"audience"`
	OpeningHoursRaw string   `json:"opening_hours_raw"`
	SourceURL       string   `json:"source_url"`
	SourceTitle     string   `json:"source_title"`
	SourceOrg       string   `json:"source_org"`
	SourceType      string   `json:"source_type"`
	EvidenceLevel   string   `json:"evidence_level"`
	EvidenceExcerpt string   `json:"evidence_excerpt"`
	ReviewStatus    string   `json:"review_status"`
}

func ensureCampusDirectoryImportBatchSeed(ctx context.Context, db *gorm.DB) error {
	data, err := os.ReadFile("data/campus_directory_import_batches_seed.json")
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read campus directory import batch seed file: %w", err)
	}
	var seeds []campusDirectoryImportBatchSeed
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("parse campus directory import batch seed file: %w", err)
	}
	for _, seed := range seeds {
		name := strings.TrimSpace(seed.Name)
		if name == "" {
			continue
		}
		status := strings.TrimSpace(seed.Status)
		if status == "" {
			status = "pending_review"
		}
		row := migrationdo.CampusDirectoryImportBatchDO{
			Name:          name,
			Region:        stringPtr(strings.TrimSpace(seed.Region)),
			SourceScope:   stringPtr(strings.TrimSpace(seed.SourceScope)),
			Status:        status,
			TotalSchools:  seed.TotalSchools,
			TotalCampuses: seed.TotalCampuses,
			TotalCanteens: seed.TotalCanteens,
			TotalWindows:  seed.TotalWindows,
			TotalSources:  seed.TotalSources,
			Notes:         stringPtr(strings.TrimSpace(seed.Notes)),
		}
		if err := db.WithContext(ctx).Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "name"}}, DoNothing: true}).Create(&row).Error; err != nil {
			return fmt.Errorf("insert campus directory import batch %q: %w", name, err)
		}
	}
	return nil
}

func ensureCampusDirectoryPendingResearchSeed(ctx context.Context, db *gorm.DB) error {
	data, err := os.ReadFile("data/campus_directory_pending_research_seed.json")
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read campus directory pending research seed file: %w", err)
	}
	var seeds []campusDirectoryPendingResearchSeed
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("parse campus directory pending research seed file: %w", err)
	}
	for _, batchSeed := range seeds {
		batchName := strings.TrimSpace(batchSeed.BatchName)
		if batchName == "" {
			continue
		}
		batchID, err := ensureCampusDirectoryPendingBatch(ctx, db, batchSeed)
		if err != nil {
			return err
		}
		for _, schoolSeed := range batchSeed.Schools {
			if err := ensureCampusDirectoryPendingSchoolResearch(ctx, db, batchID, schoolSeed); err != nil {
				return err
			}
		}
	}
	return nil
}

func ensureCampusDirectoryPendingBatch(ctx context.Context, db *gorm.DB, seed campusDirectoryPendingResearchSeed) (string, error) {
	totalCampuses := 0
	totalCanteens := 0
	totalSources := 0
	noteParts := make([]string, 0, len(seed.Schools))
	for _, school := range seed.Schools {
		totalCampuses += len(school.Campuses)
		totalCanteens += len(school.Canteens)
		for _, canteen := range school.Canteens {
			if strings.TrimSpace(canteen.SourceURL) != "" {
				totalSources++
			}
		}
		for _, note := range school.Notes {
			if trimmed := strings.TrimSpace(note); trimmed != "" {
				noteParts = append(noteParts, strings.TrimSpace(school.School)+": "+trimmed)
			}
		}
	}
	row := migrationdo.CampusDirectoryImportBatchDO{
		Name:          strings.TrimSpace(seed.BatchName),
		Region:        stringPtr(strings.TrimSpace(seed.Region)),
		SourceScope:   stringPtr(strings.TrimSpace(seed.SourceScope)),
		Status:        "pending_review",
		TotalSchools:  len(seed.Schools),
		TotalCampuses: totalCampuses,
		TotalCanteens: totalCanteens,
		TotalSources:  totalSources,
		Notes:         stringPtr(strings.Join(noteParts, "\n")),
	}
	if row.SourceScope == nil {
		row.SourceScope = stringPtr("学校官网、后勤/总务、餐饮服务中心、校园地图、迎新指南、官方采购公告")
	}
	if err := db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "name"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"region", "source_scope", "status", "total_schools", "total_campuses", "total_canteens", "total_sources", "notes", "updated_at",
		}),
	}).Create(&row).Error; err != nil {
		return "", fmt.Errorf("upsert campus directory pending batch %q: %w", row.Name, err)
	}
	var saved struct {
		ID string
	}
	if err := db.WithContext(ctx).Table("campus_directory_import_batches").Select("id").Where("name = ?", row.Name).Take(&saved).Error; err != nil {
		return "", fmt.Errorf("find campus directory pending batch %q: %w", row.Name, err)
	}
	return saved.ID, nil
}

func ensureCampusDirectoryPendingSchoolResearch(ctx context.Context, db *gorm.DB, batchID string, seed campusDirectoryResearchItem) error {
	schoolName := strings.TrimSpace(seed.School)
	if schoolName == "" {
		return nil
	}
	var school struct {
		ID string
	}
	if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", schoolName, "active").Take(&school).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return fmt.Errorf("find school %q for pending research: %w", schoolName, err)
	}
	campusIDs := map[string]string{}
	for i, campus := range seed.Campuses {
		name := strings.TrimSpace(campus.Name)
		if name == "" {
			continue
		}
		status := normalizePendingReviewStatus(seed.ReviewStatus)
		row := migrationdo.SchoolCampusDO{
			SchoolID:  school.ID,
			Name:      name,
			Aliases:   campus.Aliases,
			Address:   stringPtr(strings.TrimSpace(campus.Address)),
			SourceURL: stringPtr(strings.TrimSpace(campus.SourceURL)),
			Status:    status,
			SortOrder: i + 1,
		}
		if err := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return fmt.Errorf("insert pending campus %q/%q: %w", schoolName, name, err)
		}
		var saved struct {
			ID string
		}
		if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, name, "deleted").Take(&saved).Error; err != nil {
			return fmt.Errorf("find pending campus %q/%q: %w", schoolName, name, err)
		}
		campusIDs[name] = saved.ID
		for _, alias := range campus.Aliases {
			alias = strings.TrimSpace(alias)
			if alias != "" {
				campusIDs[alias] = saved.ID
			}
		}
	}
	for i, canteen := range seed.Canteens {
		name := strings.TrimSpace(canteen.Name)
		if name == "" {
			continue
		}
		var campusID *string
		if id := campusIDs[strings.TrimSpace(canteen.Campus)]; id != "" {
			campusID = &id
		}
		confidence := normalizeCampusEvidenceLevel(canteen.EvidenceLevel)
		row := migrationdo.SchoolCanteenDO{
			SchoolID:        school.ID,
			CampusID:        campusID,
			Name:            name,
			Aliases:         canteen.Aliases,
			LocationText:    stringPtr(strings.TrimSpace(canteen.LocationText)),
			BuildingOrFloor: stringPtr(strings.TrimSpace(canteen.BuildingOrFloor)),
			ServiceType:     stringPtr(strings.TrimSpace(canteen.ServiceType)),
			Audience:        stringPtr(strings.TrimSpace(canteen.Audience)),
			MealPeriods:     []string{},
			OpeningHoursRaw: stringPtr(strings.TrimSpace(canteen.OpeningHoursRaw)),
			PaymentMethods:  []string{},
			SourceURL:       stringPtr(strings.TrimSpace(canteen.SourceURL)),
			SourceOrg:       stringPtr(strings.TrimSpace(canteen.SourceOrg)),
			SourceType:      stringPtr(strings.TrimSpace(canteen.SourceType)),
			ConfidenceLevel: &confidence,
			Status:          normalizePendingReviewStatus(canteen.ReviewStatus),
			ReviewNote:      stringPtr("公开资料采集待后台审核"),
			SortOrder:       i + 1,
		}
		if row.Status == "" {
			row.Status = "pending_review"
		}
		if err := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return fmt.Errorf("insert pending canteen %q/%q: %w", schoolName, name, err)
		}
		canteenID, err := findCampusDirectoryCanteenID(ctx, db, school.ID, campusID, name)
		if err != nil {
			return fmt.Errorf("find pending canteen %q/%q: %w", schoolName, name, err)
		}
		if err := ensureCampusDirectoryPendingSource(ctx, db, batchID, school.ID, campusID, canteenID, canteen); err != nil {
			return err
		}
	}
	return nil
}

func findCampusDirectoryCanteenID(ctx context.Context, db *gorm.DB, schoolID string, campusID *string, name string) (*string, error) {
	query := db.WithContext(ctx).Table("school_canteens").Select("id").Where("school_id = ? AND lower(name) = lower(?) AND status NOT IN ?", schoolID, name, []string{"deleted", "rejected"})
	if campusID == nil {
		query = query.Where("campus_id IS NULL")
	} else {
		query = query.Where("campus_id = ?", *campusID)
	}
	var saved struct {
		ID string
	}
	if err := query.Take(&saved).Error; err != nil {
		return nil, err
	}
	return &saved.ID, nil
}

func ensureCampusDirectoryPendingSource(ctx context.Context, db *gorm.DB, batchID string, schoolID string, campusID *string, canteenID *string, seed campusDirectoryResearchCanteen) error {
	sourceURL := strings.TrimSpace(seed.SourceURL)
	if sourceURL == "" {
		return nil
	}
	var count int64
	query := db.WithContext(ctx).Table("campus_directory_sources").Where("school_id = ? AND source_url = ?", schoolID, sourceURL)
	if canteenID == nil {
		query = query.Where("canteen_id IS NULL")
	} else {
		query = query.Where("canteen_id = ?", *canteenID)
	}
	if err := query.Count(&count).Error; err != nil {
		return fmt.Errorf("count campus directory source %q: %w", sourceURL, err)
	}
	evidenceLevel := normalizeCampusEvidenceLevel(seed.EvidenceLevel)
	batchIDPtr := batchID
	row := migrationdo.CampusDirectorySourceDO{
		BatchID:         &batchIDPtr,
		SchoolID:        schoolID,
		CampusID:        campusID,
		CanteenID:       canteenID,
		SourceURL:       sourceURL,
		SourceTitle:     stringPtr(strings.TrimSpace(seed.SourceTitle)),
		SourceOrg:       stringPtr(strings.TrimSpace(seed.SourceOrg)),
		SourceType:      stringPtr(strings.TrimSpace(seed.SourceType)),
		EvidenceLevel:   &evidenceLevel,
		EvidenceExcerpt: stringPtr(strings.TrimSpace(seed.EvidenceExcerpt)),
		ReviewStatus:    "pending_review",
	}
	if count > 0 {
		updates := map[string]any{
			"batch_id":         row.BatchID,
			"source_title":     row.SourceTitle,
			"source_org":       row.SourceOrg,
			"source_type":      row.SourceType,
			"evidence_level":   row.EvidenceLevel,
			"evidence_excerpt": row.EvidenceExcerpt,
			"review_status":    row.ReviewStatus,
			"updated_at":       gorm.Expr("now()"),
		}
		return query.Updates(updates).Error
	}
	if err := db.WithContext(ctx).Create(&row).Error; err != nil {
		return fmt.Errorf("insert campus directory source %q: %w", sourceURL, err)
	}
	return nil
}

func normalizePendingReviewStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "active", "inactive", "rejected", "deleted":
		return strings.TrimSpace(status)
	default:
		return "pending_review"
	}
}

func normalizeCampusEvidenceLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "a", "high", "official", "official_high", "official_direct", "official_dining_page", "official_logistics", "official_logistics_page", "official_campus_dining_page", "official_named_with_hours", "official_named_status", "official_named_location", "official_procurement_named", "official_freshman_guide", "official_welcome_guide", "official_service_guide", "official_logistics_service_guide":
		return "A"
	case "b", "medium", "official_medium", "official_news", "official_procurement", "official_procurement_notice", "official_logistics_procurement", "official_logistics_notice", "official_logistics_news", "official_logistics_homepage", "official_campus_notice", "official_notice", "official_exam_notice", "official_phone_directory", "official_account_named_list", "official_facility_location", "official_index", "official_planned", "official_campus_status_only", "official_campus_construction_procurement", "official_logistics_notice_index", "official_service_portal":
		return "B"
	case "c", "low", "secondary", "secondary_procurement_direct", "procurement_proxy_pdf", "official_department_news", "official_college_news", "official_career_notice", "official_indirect":
		return "C"
	default:
		return "D"
	}
}

func ensureCampusDirectorySeed(ctx context.Context, db *gorm.DB) error {
	data, err := os.ReadFile("data/campus_directory_seed.json")
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read campus directory seed file: %w", err)
	}
	var seeds []campusDirectorySeed
	if err := json.Unmarshal(data, &seeds); err != nil {
		return fmt.Errorf("parse campus directory seed file: %w", err)
	}
	for _, schoolSeed := range seeds {
		schoolName := strings.TrimSpace(schoolSeed.School)
		if schoolName == "" {
			continue
		}
		var school struct {
			ID string
		}
		if err := db.WithContext(ctx).Table("schools").Select("id").Where("name = ? AND status = ?", schoolName, "active").Take(&school).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return fmt.Errorf("find school %q: %w", schoolName, err)
		}
		campusIDs := map[string]string{}
		for i, campus := range schoolSeed.Campuses {
			name := strings.TrimSpace(campus.Name)
			if name == "" {
				continue
			}
			sourceURL := strings.TrimSpace(campus.SourceURL)
			row := migrationdo.SchoolCampusDO{
				SchoolID:  school.ID,
				Name:      name,
				Aliases:   []string{},
				Status:    "active",
				SortOrder: i + 1,
			}
			if sourceURL != "" {
				row.SourceURL = &sourceURL
			}
			if err := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return fmt.Errorf("insert campus %q/%q: %w", schoolName, name, err)
			}
			var saved struct {
				ID string
			}
			if err := db.WithContext(ctx).Table("school_campuses").Select("id").Where("school_id = ? AND lower(name) = lower(?) AND status <> ?", school.ID, name, "deleted").Take(&saved).Error; err != nil {
				return fmt.Errorf("find campus %q/%q: %w", schoolName, name, err)
			}
			campusIDs[name] = saved.ID
		}
		for i, canteen := range schoolSeed.Canteens {
			name := strings.TrimSpace(canteen.Name)
			if name == "" {
				continue
			}
			var campusID *string
			if id := campusIDs[strings.TrimSpace(canteen.Campus)]; id != "" {
				campusID = &id
			}
			sourceURL := strings.TrimSpace(schoolSeed.SourceURL)
			sourceOrg := schoolName
			confidence := "B"
			row := migrationdo.SchoolCanteenDO{
				SchoolID:        school.ID,
				CampusID:        campusID,
				Name:            name,
				Aliases:         []string{},
				MealPeriods:     []string{},
				PaymentMethods:  []string{},
				Status:          "active",
				SortOrder:       i + 1,
				SourceOrg:       &sourceOrg,
				SourceType:      stringPtr("official"),
				ConfidenceLevel: &confidence,
			}
			if sourceURL != "" {
				row.SourceURL = &sourceURL
			}
			if err := db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return fmt.Errorf("insert canteen %q/%q: %w", schoolName, name, err)
			}
		}
	}
	return nil
}

func ensurePublicFoodCampusDirectoryBackfill(ctx context.Context, db *gorm.DB) error {
	statements := []string{
		`
		UPDATE public_food_library p
		SET school_id = s.id
		FROM schools s
		WHERE p.school_id IS NULL
		  AND NULLIF(trim(p.school_name), '') IS NOT NULL
		  AND s.status = 'active'
		  AND lower(trim(p.school_name)) = lower(s.name)
		`,
		`
		UPDATE public_food_library p
		SET campus_id = sc.id
		FROM school_campuses sc
		WHERE p.campus_id IS NULL
		  AND p.school_id IS NOT NULL
		  AND NULLIF(trim(p.campus_name), '') IS NOT NULL
		  AND sc.school_id = p.school_id
		  AND sc.status = 'active'
		  AND lower(trim(p.campus_name)) = lower(sc.name)
		`,
		`
		UPDATE public_food_library p
		SET canteen_id = (
			SELECT c.id
			FROM school_canteens c
			WHERE c.school_id = p.school_id
			  AND c.status = 'active'
			  AND lower(trim(p.canteen_name)) = lower(c.name)
			  AND (p.campus_id IS NULL OR c.campus_id = p.campus_id OR c.campus_id IS NULL)
			ORDER BY CASE WHEN c.campus_id = p.campus_id THEN 0 ELSE 1 END, c.sort_order ASC, c.name ASC
			LIMIT 1
		)
		WHERE p.canteen_id IS NULL
		  AND p.school_id IS NOT NULL
		  AND NULLIF(trim(p.canteen_name), '') IS NOT NULL
		  AND EXISTS (
			SELECT 1
			FROM school_canteens c
			WHERE c.school_id = p.school_id
			  AND c.status = 'active'
			  AND lower(trim(p.canteen_name)) = lower(c.name)
			  AND (p.campus_id IS NULL OR c.campus_id = p.campus_id OR c.campus_id IS NULL)
		  )
		`,
		`
		UPDATE public_food_library p
		SET window_id = (
			SELECT w.id
			FROM canteen_windows w
			WHERE w.canteen_id = p.canteen_id
			  AND w.status = 'active'
			  AND lower(trim(p.window_name)) = lower(w.name)
			  AND (NULLIF(trim(p.floor), '') IS NULL OR NULLIF(trim(w.floor), '') IS NULL OR lower(trim(p.floor)) = lower(trim(w.floor)))
			ORDER BY CASE WHEN lower(trim(p.floor)) = lower(trim(w.floor)) THEN 0 ELSE 1 END, w.sort_order ASC, w.name ASC
			LIMIT 1
		)
		WHERE p.window_id IS NULL
		  AND p.canteen_id IS NOT NULL
		  AND NULLIF(trim(p.window_name), '') IS NOT NULL
		  AND EXISTS (
			SELECT 1
			FROM canteen_windows w
			WHERE w.canteen_id = p.canteen_id
			  AND w.status = 'active'
			  AND lower(trim(p.window_name)) = lower(w.name)
			  AND (NULLIF(trim(p.floor), '') IS NULL OR NULLIF(trim(w.floor), '') IS NULL OR lower(trim(p.floor)) = lower(trim(w.floor)))
		  )
		`,
	}
	for _, sql := range statements {
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("backfill public food campus directory ids: %w", err)
		}
	}
	return nil
}

func stringPtr(value string) *string {
	return &value
}

type exerciseEnergySeed struct {
	Name      string
	Norm      string
	Category  string
	Intensity string
	MET       float64
	Aliases   []string
	Evidence  string
}

func ensureExerciseEnergySeed(ctx context.Context, db *gorm.DB) error {
	seeds := []exerciseEnergySeed{
		{Name: "深蹲", Norm: "深蹲", Category: "strength", Intensity: "high", MET: 5.0, Aliases: []string{"杠铃深蹲", "深蹲训练"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "杠铃深蹲", Norm: "杠铃深蹲", Category: "strength", Intensity: "high", MET: 5.0, Aliases: []string{"40kg杠铃深蹲", "负重深蹲"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "卧推", Norm: "卧推", Category: "strength", Intensity: "high", MET: 4.5, Aliases: []string{"杠铃卧推", "卧推训练"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "高位下拉", Norm: "高位下拉", Category: "strength", Intensity: "moderate", MET: 4.0, Aliases: []string{"龙门架高位下拉", "下拉"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "龙门架高位下拉", Norm: "龙门架高位下拉", Category: "strength", Intensity: "moderate", MET: 4.0, Aliases: []string{"宽握高位下拉"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "坐姿划船", Norm: "坐姿划船", Category: "strength", Intensity: "moderate", MET: 4.0, Aliases: []string{"器械划船", "划船训练"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "哑铃推举", Norm: "哑铃推举", Category: "strength", Intensity: "high", MET: 4.5, Aliases: []string{"肩推", "哑铃肩推", "推举"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "弯举", Norm: "弯举", Category: "strength", Intensity: "moderate", MET: 3.5, Aliases: []string{"杠铃弯举", "哑铃弯举", "二头弯举"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "臂弯举", Norm: "臂弯举", Category: "strength", Intensity: "moderate", MET: 3.5, Aliases: []string{"手臂弯举", "二头肌弯举"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "绳索下压", Norm: "绳索下压", Category: "strength", Intensity: "moderate", MET: 3.5, Aliases: []string{"直杆下压", "三头下压"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "跑步机", Norm: "跑步机", Category: "cardio", Intensity: "high", MET: 8.3, Aliases: []string{"跑步机跑步", "坡度跑", "跑步"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "跑步机跑步", Norm: "跑步机跑步", Category: "cardio", Intensity: "high", MET: 8.3, Aliases: []string{"跑步机有氧"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "卷腹", Norm: "卷腹", Category: "strength", Intensity: "moderate", MET: 3.8, Aliases: []string{"仰卧卷腹", "腹部卷腹"}, Evidence: "基础核心训练 MET 种子"},
		{Name: "垫上卷腹", Norm: "垫上卷腹", Category: "strength", Intensity: "moderate", MET: 3.8, Aliases: []string{"垫上腹部卷腹"}, Evidence: "基础核心训练 MET 种子"},
		{Name: "平板支撑", Norm: "平板支撑", Category: "strength", Intensity: "moderate", MET: 3.0, Aliases: []string{"平板", "plank"}, Evidence: "基础核心训练 MET 种子"},
		{Name: "背部伸展", Norm: "背部伸展", Category: "strength", Intensity: "moderate", MET: 3.5, Aliases: []string{"背伸", "罗马椅背伸"}, Evidence: "基础力量训练 MET 种子"},
		{Name: "拉伸", Norm: "拉伸", Category: "flexibility", Intensity: "low", MET: 2.3, Aliases: []string{"静态拉伸", "放松拉伸"}, Evidence: "基础拉伸训练 MET 种子"},
		{Name: "全身肌群拉伸", Norm: "全身肌群拉伸", Category: "flexibility", Intensity: "low", MET: 2.3, Aliases: []string{"全身拉伸", "多肌群拉伸"}, Evidence: "基础拉伸训练 MET 种子"},
		{Name: "慢跑", Norm: "慢跑", Category: "cardio", Intensity: "moderate", MET: 7.0, Aliases: []string{"跑步30分钟", "轻松跑"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "跳绳", Norm: "跳绳", Category: "cardio", Intensity: "high", MET: 10.0, Aliases: []string{"跳绳训练"}, Evidence: "基础有氧训练 MET 种子"},
		{Name: "壶铃训练", Norm: "壶铃训练", Category: "strength", Intensity: "high", MET: 8.0, Aliases: []string{"壶铃摆动", "壶铃"}, Evidence: "基础力量循环训练 MET 种子"},
	}
	for _, seed := range seeds {
		if err := db.WithContext(ctx).Exec(`
			INSERT INTO exercise_energy_library (
				canonical_name,
				normalized_name,
				category,
				intensity,
				met_value,
				source,
				evidence,
				review_status,
				is_active
			)
			VALUES (?, ?, ?, ?, ?, 'system_seed', ?, 'active', true)
			ON CONFLICT (normalized_name) DO UPDATE SET
				category = EXCLUDED.category,
				intensity = EXCLUDED.intensity,
				met_value = EXCLUDED.met_value,
				source = CASE
					WHEN exercise_energy_library.source = 'system_seed' THEN EXCLUDED.source
					ELSE exercise_energy_library.source
				END,
				evidence = CASE
					WHEN exercise_energy_library.source = 'system_seed' THEN EXCLUDED.evidence
					ELSE exercise_energy_library.evidence
				END,
				review_status = CASE
					WHEN exercise_energy_library.review_status = 'pending' THEN 'active'
					ELSE exercise_energy_library.review_status
				END,
				is_active = true,
				updated_at = now()
		`, seed.Name, seed.Norm, seed.Category, seed.Intensity, seed.MET, seed.Evidence).Error; err != nil {
			return fmt.Errorf("seed exercise energy activity %s: %w", seed.Name, err)
		}
		for _, alias := range append(seed.Aliases, seed.Name) {
			alias = strings.TrimSpace(alias)
			if alias == "" {
				continue
			}
			normalizedAlias := normalizeExerciseEnergySeedAlias(alias)
			if normalizedAlias == "" {
				continue
			}
			if err := db.WithContext(ctx).Exec(`
				INSERT INTO exercise_energy_aliases (activity_id, alias_name, normalized_alias)
				SELECT id, ?, ?
				FROM exercise_energy_library
				WHERE normalized_name = ?
				ON CONFLICT (normalized_alias) DO NOTHING
			`, alias, normalizedAlias, seed.Norm).Error; err != nil {
				return fmt.Errorf("seed exercise energy alias %s: %w", alias, err)
			}
		}
	}
	return nil
}

func normalizeExerciseEnergySeedAlias(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	replacer := strings.NewReplacer(" ", "", "\t", "", "\n", "", "\r", "", "-", "", "_", "", "，", "", "。", "", "、", "", "；", "", ":", "", "：", "", "(", "", ")", "", "（", "", "）", "")
	return replacer.Replace(value)
}

func ensureMottoColumn(ctx context.Context, db *gorm.DB) error {
	var exists int64
	if err := db.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_name = 'weapp_user' AND column_name = 'motto'
	`).Scan(&exists).Error; err != nil {
		return fmt.Errorf("check motto column exists: %w", err)
	}
	if exists > 0 {
		return nil
	}
	sql := `ALTER TABLE weapp_user ADD COLUMN motto TEXT`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("add motto column: %w", err)
	}
	return nil
}

func ensurePublicRecordsDefault(ctx context.Context, db *gorm.DB) error {
	result := db.WithContext(ctx).Exec(`
		UPDATE weapp_user
		SET public_records = TRUE
		WHERE public_records IS NULL
	`)
	if result.Error != nil {
		return fmt.Errorf("backfill public_records default: %w", result.Error)
	}
	return nil
}

func ensureRecipeIDColumn(ctx context.Context, db *gorm.DB) error {
	var exists int64
	if err := db.WithContext(ctx).Raw(`
		SELECT COUNT(*) FROM information_schema.columns
		WHERE table_name = 'user_food_records' AND column_name = 'recipe_id'
	`).Scan(&exists).Error; err != nil {
		return fmt.Errorf("check recipe_id column exists: %w", err)
	}
	if exists > 0 {
		return nil
	}
	sql := `ALTER TABLE user_food_records ADD COLUMN recipe_id uuid`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("add recipe_id column: %w", err)
	}
	return nil
}

func ensureAdminResolutionColumns(ctx context.Context, db *gorm.DB) error {
	columns := []string{
		`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS reward_credits integer NOT NULL DEFAULT 0`,
		`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS reward_ledger_id uuid`,
		`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS resolution_message text NOT NULL DEFAULT ''`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS resolution_note text NOT NULL DEFAULT ''`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS reward_credits integer NOT NULL DEFAULT 0`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS reward_ledger_id uuid`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS handled_by text`,
		`ALTER TABLE feed_reports ADD COLUMN IF NOT EXISTS handled_at timestamptz`,
	}
	for _, sql := range columns {
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("admin resolution column migration: %w", err)
		}
	}
	return nil
}

func ensureFoodWeightLabeledSamplesStructuredLabels(ctx context.Context, db *gorm.DB) error {
	sql := `
	ALTER TABLE food_weight_labeled_samples ALTER COLUMN items SET DEFAULT '{}'::jsonb;

	UPDATE food_weight_labeled_samples
	SET items = COALESCE((
		SELECT jsonb_object_agg(elem->>'name', (elem->>'weight_grams')::numeric)
		FROM jsonb_array_elements(items) AS elem
	), '{}'::jsonb)
	WHERE label_type = 'items'
	  AND jsonb_typeof(items) = 'array';

	UPDATE food_weight_labeled_samples
	SET items = CASE
		WHEN total_weight_grams IS NOT NULL THEN jsonb_build_object('__total__', total_weight_grams)
		ELSE '{}'::jsonb
	END
	WHERE label_type = 'total'
	  AND (jsonb_typeof(items) = 'array' OR items = '{}'::jsonb);

	UPDATE food_weight_labeled_samples
	SET items = '{}'::jsonb
	WHERE label_type = 'unlabeled'
	  AND jsonb_typeof(items) = 'array';
	`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("convert food_weight_labeled_samples items to structured labels: %w", err)
	}
	return nil
}

func ensurePaymentTestConfig(ctx context.Context, db *gorm.DB) error {
	sqls := []string{
		`INSERT INTO membership_payment_test_settings (id, enabled, created_at, updated_at)
VALUES ('default', false, now(), now())
ON CONFLICT (id) DO NOTHING`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_snapshot_taken_at timestamptz`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_cancelled_at timestamptz`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_cancelled_by text`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_restored_at timestamptz`,
		`ALTER TABLE membership_payment_test_users
  ADD COLUMN IF NOT EXISTS membership_restored_by text`,
		`INSERT INTO membership_plan_config (
  code,
  name,
  description,
  amount,
  duration_months,
  is_active,
  is_visible,
  is_test_plan,
  tier,
  period,
  daily_credits,
  original_amount,
  sort_order,
  created_at,
  updated_at
) VALUES (
  'test_one_cent_monthly',
  'Pay Test - 0.01 CNY',
  'Hidden one-cent payment test membership plan',
  0.01,
  1,
  true,
  false,
  true,
  'light',
  'monthly',
  8,
  NULL,
  9999,
  now(),
  now()
) ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  amount = EXCLUDED.amount,
  duration_months = EXCLUDED.duration_months,
  is_active = true,
  is_visible = false,
  is_test_plan = true,
  tier = EXCLUDED.tier,
  period = EXCLUDED.period,
  daily_credits = EXCLUDED.daily_credits,
  original_amount = EXCLUDED.original_amount,
  sort_order = EXCLUDED.sort_order,
  updated_at = now()`,
	}
	for _, sql := range sqls {
		if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
			return fmt.Errorf("ensure payment test config: %w", err)
		}
	}
	return nil
}

func ensureMembershipGrantConfig(ctx context.Context, db *gorm.DB) error {
	sql := `INSERT INTO membership_plan_config (
  code,
  name,
  description,
  amount,
  duration_months,
  is_active,
  is_visible,
  is_test_plan,
  tier,
  period,
  daily_credits,
  original_amount,
  sort_order,
  created_at,
  updated_at
) VALUES (
  'light_monthly',
  '轻度版月卡',
  '邀请赠送会员兜底套餐：每日 8 积分',
  0,
  1,
  true,
  false,
  false,
  'light',
  'monthly',
  8,
  NULL,
  9000,
  now(),
  now()
) ON CONFLICT (code) DO NOTHING`
	if err := db.WithContext(ctx).Exec(sql).Error; err != nil {
		return fmt.Errorf("ensure membership grant config: %w", err)
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
