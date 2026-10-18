package migration

import (
	"context"
	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// MigrateAnalytics is deliberately scoped: no business data backfills or migrations.
func MigrateAnalytics(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	if err := db.WithContext(ctx).AutoMigrate(&migrationdo.AdminAccountDO{}, &migrationdo.AnalyticsActivityDO{}, &migrationdo.AnalyticsDailyDO{}, &migrationdo.AnalyticsStateDO{}); err != nil {
		return err
	}
	return db.WithContext(ctx).Exec("INSERT INTO admin_analytics_state (id, started_at) VALUES (1, now()) ON CONFLICT (id) DO NOTHING").Error
}
