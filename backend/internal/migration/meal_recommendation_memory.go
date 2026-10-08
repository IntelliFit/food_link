package migration

import (
	"context"
	"food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// Narrow migration for rolling out recommendation feedback without unrelated schema changes.
func MigrateMealRecommendationMemory(ctx context.Context, db *gorm.DB) error {
	return db.WithContext(ctx).AutoMigrate(&do.MealRecommendationMemoryDO{})
}
