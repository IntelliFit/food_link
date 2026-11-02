package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// rewardTaskTypeCheck lists every reward_task_uploads.task_type;
// research_weight_sample rewards approved weighed benchmark samples.
const rewardTaskTypeCheck = `task_type = ANY (ARRAY['packaged_food_upload'::text,'public_food_upload'::text,'standard_food_upload'::text,'research_weight_sample'::text])`

// MigrateResearchWeightSamples adds the weighed benchmark sample table and
// allows its reward task type. It never rewrites existing rows.
func MigrateResearchWeightSamples(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return MigrateResearchWeightTables(ctx, tx) })
}

func MigrateResearchWeightTables(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).AutoMigrate(migrationdo.ResearchWeightModels()...); err != nil {
		return fmt.Errorf("auto migrate research weight samples: %w", err)
	}
	if !db.Migrator().HasTable("reward_task_uploads") {
		return nil
	}
	check := dropAndAddCheck("reward_task_uploads", "reward_task_uploads_task_type_check", rewardTaskTypeCheck)
	if err := db.WithContext(ctx).Exec(check).Error; err != nil {
		return fmt.Errorf("allow research weight reward tasks: %w", err)
	}
	return nil
}
