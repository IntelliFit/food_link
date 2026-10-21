package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// campusSourceChannelCheck lists every channel that may create campus catalog
// batches and items; canteen_capture is the window capture flow.
const campusSourceChannelCheck = `source_channel = ANY (ARRAY['admin_batch'::text,'user_single'::text,'collector_batch'::text,'legacy_public'::text,'import'::text,'canteen_capture'::text])`

// analysisTaskTypeCheck lists every analysis_tasks.task_type the workers
// accept, plus their _debug variants; canteen_menu_extract reads capture menus.
const analysisTaskTypeCheck = `task_type = ANY (ARRAY['food'::text,'food_text'::text,'precision_plan'::text,'precision_item_estimate'::text,'precision_aggregate'::text,'health_report'::text,'public_food_library_text'::text,'exercise'::text,'custom_focus'::text,'expiry_recognize'::text,'expiry_notification'::text,'packaged_nutrition_label'::text,'packaged_product_extract'::text,'canteen_menu_extract'::text]) OR task_type ~ '^(food|food_text|precision_plan|precision_item_estimate|precision_aggregate|health_report|public_food_library_text|exercise|custom_focus|expiry_recognize|expiry_notification|packaged_nutrition_label|packaged_product_extract)_debug(_[a-z0-9_]+)?$'`

// MigrateCanteenCapture adds the window capture sessions, their photos and the
// collector earnings ledger, and allows the canteen_capture source channel on
// the existing catalog tables. It never rewrites existing rows.
func MigrateCanteenCapture(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return MigrateCanteenCaptureTables(ctx, tx) })
}

func MigrateCanteenCaptureTables(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).AutoMigrate(migrationdo.CanteenCaptureModels()...); err != nil {
		return fmt.Errorf("auto migrate canteen capture: %w", err)
	}
	// One paid reward per window: a later visit to the same window is still
	// accepted as data but cannot earn the window reward again.
	statement := `CREATE UNIQUE INDEX IF NOT EXISTS uk_canteen_collector_ledger_window_reward
ON canteen_collector_ledger (window_key)
WHERE entry_type = 'window_reward' AND status IN ('confirmed','rate_pending')`
	if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
		return fmt.Errorf("create canteen window reward index: %w", err)
	}
	// Published capture items reuse the catalog tables, whose CHECK lists the
	// allowed source channels.
	if !db.Migrator().HasTable("campus_food_collection_batches") || !db.Migrator().HasTable("campus_food_catalog_items") {
		return nil
	}
	for _, check := range []string{
		dropAndAddCheck("campus_food_collection_batches", "campus_food_collection_batches_source_channel_check", campusSourceChannelCheck),
		dropAndAddCheck("campus_food_catalog_items", "campus_food_catalog_items_source_channel_check", campusSourceChannelCheck),
	} {
		if err := db.WithContext(ctx).Exec(check).Error; err != nil {
			return fmt.Errorf("extend campus source channels: %w", err)
		}
	}
	// The menu reading task is stored in analysis_tasks, whose CHECK lists the
	// task types the workers accept.
	if db.Migrator().HasTable("analysis_tasks") {
		check := dropAndAddCheck("analysis_tasks", "analysis_tasks_task_type_check", analysisTaskTypeCheck)
		if err := db.WithContext(ctx).Exec(check).Error; err != nil {
			return fmt.Errorf("allow canteen menu extract tasks: %w", err)
		}
	}
	return nil
}
