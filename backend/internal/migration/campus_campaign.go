package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// MigrateCampusCampaign adds the club, campaign, member, campaign record and
// weighing-day tables. Everything is new; no existing row is touched.
func MigrateCampusCampaign(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return MigrateCampusCampaignTables(ctx, tx) })
}

func MigrateCampusCampaignTables(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).AutoMigrate(migrationdo.CampusCampaignModels()...); err != nil {
		return fmt.Errorf("auto migrate campus campaigns: %w", err)
	}
	return nil
}
