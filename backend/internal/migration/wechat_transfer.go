package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// MigrateWechatTransfer adds the WeChat Pay merchant transfer bill table.
// It only creates a new table.
func MigrateWechatTransfer(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error { return MigrateWechatTransferTables(ctx, tx) })
}

func MigrateWechatTransferTables(ctx context.Context, db *gorm.DB) error {
	if err := db.WithContext(ctx).AutoMigrate(migrationdo.WechatTransferModels()...); err != nil {
		return fmt.Errorf("auto migrate wechat transfer bills: %w", err)
	}
	return nil
}
