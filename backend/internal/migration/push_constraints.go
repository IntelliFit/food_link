package migration

import (
	"context"
	"fmt"

	migrationdo "food_link/backend/internal/migration/do"

	"gorm.io/gorm"
)

// MigratePushReminders only migrates the three reminder tables and their
// constraints. The transaction avoids running unrelated full-schema migrations.
func MigratePushReminders(ctx context.Context, db *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("提醒迁移数据库 schema 无效: %q", schema)
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return fmt.Errorf("设置提醒迁移 schema 失败: %w", err)
		}
		if err := tx.Exec("SET LOCAL lock_timeout = '5s'").Error; err != nil {
			return fmt.Errorf("设置提醒迁移锁等待上限失败: %w", err)
		}
		if err := tx.AutoMigrate(
			&migrationdo.PushPreferencesDO{},
			&migrationdo.PushDeviceDO{},
			&migrationdo.PushDeliveryDO{},
		); err != nil {
			return fmt.Errorf("提醒三表迁移失败: %w", err)
		}
		return ensurePushConstraints(ctx, tx)
	})
}

// Keep stable names and repeat-safe foreign keys in the normal migration command.
func ensurePushConstraints(ctx context.Context, db *gorm.DB) error {
	statements := []string{
		`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='push_reminder_preferences'::regclass AND conname='push_preferences_user_fk') THEN ALTER TABLE push_reminder_preferences ADD CONSTRAINT push_preferences_user_fk FOREIGN KEY (user_id) REFERENCES weapp_user(id) ON DELETE CASCADE; END IF; END $$`,
		`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='push_devices'::regclass AND conname='push_devices_user_fk') THEN ALTER TABLE push_devices ADD CONSTRAINT push_devices_user_fk FOREIGN KEY (user_id) REFERENCES weapp_user(id) ON DELETE CASCADE; END IF; END $$`,
		`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='push_deliveries'::regclass AND conname='push_deliveries_user_fk') THEN ALTER TABLE push_deliveries ADD CONSTRAINT push_deliveries_user_fk FOREIGN KEY (user_id) REFERENCES weapp_user(id) ON DELETE CASCADE; END IF; END $$`,
		`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='push_deliveries'::regclass AND conname='push_deliveries_device_fk') THEN ALTER TABLE push_deliveries ADD CONSTRAINT push_deliveries_device_fk FOREIGN KEY (device_id) REFERENCES push_devices(id) ON DELETE CASCADE; END IF; END $$`,
		`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='push_deliveries'::regclass AND conname='push_delivery_status_check') THEN ALTER TABLE push_deliveries ADD CONSTRAINT push_delivery_status_check CHECK (status IN ('pending','processing','accepted','receipt_processing','provider_accepted','receipt_unknown','failed','cancelled')); END IF; END $$`,
	}
	for _, statement := range statements {
		if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
			return fmt.Errorf("安装推送约束失败: %w", err)
		}
	}
	return nil
}
