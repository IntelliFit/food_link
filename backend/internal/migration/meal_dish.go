package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// MigrateMealDish adds the meal-to-canteen-dish prompt table and the
// anonymous canteen location samples. It only creates new tables.
func MigrateMealDish(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return MigrateMealDishTables(ctx, tx) })
}

func MigrateMealDishTables(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).AutoMigrate(migrationdo.MealDishModels()...); err != nil {
		return fmt.Errorf("auto migrate meal dish prompts: %w", err)
	}
	return nil
}
