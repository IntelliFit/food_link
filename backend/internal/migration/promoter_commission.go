package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// MigratePromoterCommission adds promoters, their user bindings, per-order
// commissions and withdrawal requests. It only creates new tables.
func MigratePromoterCommission(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return MigratePromoterCommissionTables(ctx, tx) })
}

func MigratePromoterCommissionTables(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).AutoMigrate(migrationdo.PromoterCommissionModels()...); err != nil {
		return fmt.Errorf("auto migrate promoter commission: %w", err)
	}
	// At most one withdrawal in flight per promoter, so two quick taps or two
	// devices cannot reserve the same balance twice.
	statement := `CREATE UNIQUE INDEX IF NOT EXISTS uk_promoter_withdrawals_in_flight
ON promoter_withdrawals (promoter_id)
WHERE status IN ('reviewing','approved','transferring')`
	if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
		return fmt.Errorf("create promoter withdrawal in-flight index: %w", err)
	}
	return nil
}
