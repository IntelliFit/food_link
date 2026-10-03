package migration

import (
	"context"
	"fmt"
	"gorm.io/gorm"
)

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
