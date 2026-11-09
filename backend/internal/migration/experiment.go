package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"

	"gorm.io/gorm"
)

// MigrateExperiments applies only the additive A/B experiment tables.
func MigrateExperiments(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return MigrateExperimentTables(ctx, tx) })
}

func MigrateExperimentTables(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).AutoMigrate(migrationdo.ExperimentModels()...); err != nil {
		return fmt.Errorf("auto migrate experiments: %w", err)
	}
	for _, check := range []string{
		dropAndAddCheck("experiments", "experiments_status_check", "status IN ('draft','running','stopped')"),
		dropAndAddCheck("experiments", "experiments_audience_check", "audience IN ('all','new_users')"),
		dropAndAddCheck("experiments", "experiments_variants_array_check", "jsonb_typeof(variants) = 'array'"),
		dropAndAddCheck("experiment_assignments", "experiment_assignments_excluded_reason_check", "excluded_reason IS NULL OR excluded_reason IN ('existing_user','duplicate_unit','account_deleted')"),
		dropAndAddCheck("app_events", "app_events_props_object_check", "jsonb_typeof(props) = 'object'"),
	} {
		if err := db.WithContext(ctx).Exec(check).Error; err != nil {
			return fmt.Errorf("add experiment check: %w", err)
		}
	}
	// One assignment per account per experiment, so two phones racing at
	// first login cannot put the same person in both arms.
	statement := `CREATE UNIQUE INDEX IF NOT EXISTS uk_experiment_assignments_user
ON experiment_assignments (experiment_key, user_id) WHERE user_id IS NOT NULL`
	if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
		return fmt.Errorf("create experiment user index: %w", err)
	}
	return nil
}
