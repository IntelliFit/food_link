package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

func MigrateCanteenCollectors(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return MigrateCanteenCollectorScopes(ctx, tx) })
}

// MigrateCanteenCollectorScopes extends existing collector grants without
// rewriting campus applications or creating fake school directory entries.
func MigrateCanteenCollectorScopes(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).AutoMigrate(&migrationdo.CampusCollectorApplicationDO{}, &migrationdo.CampusCollectorScopeDO{}); err != nil {
		return err
	}
	for _, table := range []string{"campus_collector_applications", "campus_collector_scopes"} {
		if err := db.WithContext(ctx).Exec("ALTER TABLE " + table + " ALTER COLUMN school_id DROP NOT NULL").Error; err != nil {
			return err
		}
		status := "pending"
		if table == "campus_collector_scopes" {
			status = "active"
		}
		index := "uk_" + table + "_venue_scope"
		query := fmt.Sprintf("CREATE UNIQUE INDEX IF NOT EXISTS %s ON %s (user_id, venue_type, LOWER(BTRIM(organization_name)), LOWER(BTRIM(scope_canteen_name))) WHERE school_id IS NULL AND status = '%s'", index, table, status)
		if err := db.WithContext(ctx).Exec(query).Error; err != nil {
			return err
		}
		constraint := table + "_venue_scope_check"
		var exists bool
		if err := db.WithContext(ctx).Raw("SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid = ?::regclass AND conname = ?)", table, constraint).Scan(&exists).Error; err != nil {
			return err
		}
		if !exists {
			check := "ALTER TABLE " + table + " ADD CONSTRAINT " + constraint + " CHECK ((venue_type = 'university' AND school_id IS NOT NULL) OR (venue_type IN ('community','corporate','office_park') AND school_id IS NULL AND campus_id IS NULL AND canteen_id IS NULL AND BTRIM(organization_name) <> ''))"
			if err := db.WithContext(ctx).Exec(check).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
