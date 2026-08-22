package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"

	"gorm.io/gorm"
)

// MigrateUserFoodPhotoAnnotations creates only the additive table and indexes
// used by the admin photo-cleaning workflow. It intentionally skips the broad
// AutoMigrate backfills, seeds, constraints, and triggers.
func MigrateUserFoodPhotoAnnotations(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	model := &migrationdo.UserFoodPhotoAnnotationDO{}
	if err := db.WithContext(ctx).AutoMigrate(model); err != nil {
		return fmt.Errorf("auto migrate user food photo annotations: %w", err)
	}
	if !db.WithContext(ctx).Migrator().HasTable(model) {
		return fmt.Errorf("missing user_food_photo_annotations table after migration")
	}
	for _, index := range []string{
		"idx_user_food_photo_annotations_identity",
		"idx_user_food_photo_annotations_status",
		"idx_user_food_photo_annotations_labels",
	} {
		if !db.WithContext(ctx).Migrator().HasIndex(model, index) {
			return fmt.Errorf("missing user food photo annotation index after migration: %s", index)
		}
	}
	return nil
}
