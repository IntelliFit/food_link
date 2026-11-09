package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"

	"gorm.io/gorm"
)

// MigrateContentConfigs applies only the additive admin content config table.
func MigrateContentConfigs(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return MigrateContentConfigTables(ctx, tx) })
}

func MigrateContentConfigTables(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).AutoMigrate(&migrationdo.AppContentConfigDO{}); err != nil {
		return fmt.Errorf("auto migrate content configs: %w", err)
	}
	check := dropAndAddCheck("app_content_configs", "app_content_configs_value_object_check", "jsonb_typeof(value) = 'object'")
	if err := db.WithContext(ctx).Exec(check).Error; err != nil {
		return fmt.Errorf("add content config check: %w", err)
	}
	return nil
}
