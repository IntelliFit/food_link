package migration

import (
	"context"

	migrationdo "food_link/backend/internal/migration/do"

	"gorm.io/gorm"
)

// MigrateCampusMapLocations adds auditable coordinates to schools, campuses,
// and canteens without running unrelated data migrations. Coordinates are
// populated by the separate campus-map-location-backfill command afterwards.
func MigrateCampusMapLocations(ctx context.Context, db *gorm.DB) error {
	return db.WithContext(ctx).AutoMigrate(
		&migrationdo.SchoolDO{},
		&migrationdo.SchoolCampusDO{},
		&migrationdo.SchoolCanteenDO{},
	)
}
