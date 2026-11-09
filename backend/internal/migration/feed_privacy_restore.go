package migration

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// FeedPrivacyRestoreResult reports how many flipped accounts the restore covers.
type FeedPrivacyRestoreResult struct {
	Candidates int64
	Excluded   int64
	Restored   int64
	Applied    bool
}

// RestoreFlippedRecordsToPublic undoes the 2026-11-03 flip for accounts that have
// not answered the prompt yet: they become public again and are no longer asked.
// Accounts that chose in the prompt, and the given user IDs, are left alone. It
// records no consent time, because the owner did not agree. Without apply it only
// counts, in a read-only transaction.
func RestoreFlippedRecordsToPublic(ctx context.Context, db *gorm.DB, schema string, excludeIDs []string, apply bool) (FeedPrivacyRestoreResult, error) {
	var result FeedPrivacyRestoreResult
	exclude := make([]string, 0, len(excludeIDs))
	for _, id := range excludeIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, err := uuid.Parse(id); err != nil {
			return result, fmt.Errorf("invalid user id to exclude: %q", id)
		}
		exclude = append(exclude, id)
	}
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := setLocalSearchPath(tx, schema); err != nil {
			return err
		}
		const flipped = "public_records_reconfirm_pending = TRUE"
		if err := tx.Table("weapp_user").Where(flipped).Count(&result.Candidates).Error; err != nil {
			return fmt.Errorf("count flipped accounts: %w", err)
		}
		scope := tx.Table("weapp_user").Where(flipped)
		if len(exclude) > 0 {
			if err := tx.Table("weapp_user").Where(flipped).Where("id::text IN ?", exclude).Count(&result.Excluded).Error; err != nil {
				return fmt.Errorf("count excluded accounts: %w", err)
			}
			scope = scope.Where("id::text NOT IN ?", exclude)
		}
		if !apply {
			return nil
		}
		updated := scope.Updates(map[string]any{"public_records": true, "public_records_reconfirm_pending": false})
		if updated.Error != nil {
			return fmt.Errorf("restore flipped accounts: %w", updated.Error)
		}
		result.Restored = updated.RowsAffected
		result.Applied = true
		return nil
	}, &sql.TxOptions{ReadOnly: !apply})
	return result, err
}
