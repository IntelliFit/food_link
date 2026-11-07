package migration

import (
	"context"
	"database/sql"
	"fmt"

	"gorm.io/gorm"
)

// MigrateFeedPrivacySchema applies only the schema needed before the backend that
// keeps records private by default is deployed. Existing rows are left to the flip,
// so accounts with a never-set value are also asked once.
func MigrateFeedPrivacySchema(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		for _, statement := range []string{
			`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS public_records_consented_at timestamptz`,
			`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS public_records_reconfirm_pending boolean NOT NULL DEFAULT false`,
			`ALTER TABLE weapp_user ALTER COLUMN public_records SET DEFAULT true`,
		} {
			if err := tx.Exec(statement).Error; err != nil {
				return fmt.Errorf("migrate feed privacy schema: %w", err)
			}
		}
		return nil
	})
}

// MigrateFeedFriendsSchema adds the switch that lets an account hide its records
// from friends. Existing accounts keep today's behaviour: friends can see them.
func MigrateFeedFriendsSchema(ctx context.Context, db *gorm.DB, schema string) error {
	if err := prepareSchema(ctx, db, schema); err != nil {
		return err
	}
	for _, statement := range []string{
		`ALTER TABLE weapp_user ADD COLUMN IF NOT EXISTS friends_can_view_records boolean NOT NULL DEFAULT true`,
		// New accounts are public by default again (2026-11-04); existing choices stay.
		`ALTER TABLE weapp_user ALTER COLUMN public_records SET DEFAULT true`,
	} {
		if err := db.WithContext(ctx).Exec(statement).Error; err != nil {
			return fmt.Errorf("migrate feed friends schema: %w", err)
		}
	}
	return nil
}

// FeedPrivacyFlipResult reports how many accounts the flip covers.
type FeedPrivacyFlipResult struct {
	Candidates int64
	Flipped    int64
	Applied    bool
}

// FlipUnconsentedRecordsToPrivate turns off public records for every account that
// has not explicitly agreed since consent started being recorded, and marks them
// so the mini program asks once. Accounts still pending can be restored with
// `SET public_records = TRUE WHERE public_records_reconfirm_pending`.
// Without apply it only counts.
func FlipUnconsentedRecordsToPrivate(ctx context.Context, db *gorm.DB, schema string, apply bool) (FeedPrivacyFlipResult, error) {
	var result FeedPrivacyFlipResult
	const scope = `COALESCE(public_records, TRUE) = TRUE AND public_records_consented_at IS NULL`
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := setLocalSearchPath(tx, schema); err != nil {
			return err
		}
		if err := tx.Table("weapp_user").Where(scope).Count(&result.Candidates).Error; err != nil {
			return fmt.Errorf("count unconsented public accounts: %w", err)
		}
		if !apply {
			return nil
		}
		updated := tx.Exec(`UPDATE weapp_user SET public_records = FALSE, public_records_reconfirm_pending = TRUE WHERE ` + scope)
		if updated.Error != nil {
			return fmt.Errorf("flip unconsented accounts to private: %w", updated.Error)
		}
		result.Flipped = updated.RowsAffected
		result.Applied = true
		return nil
	}, &sql.TxOptions{ReadOnly: !apply})
	return result, err
}

// setLocalSearchPath scopes a transaction to the schema without any DDL, so a preview
// can run in a read-only transaction.
func setLocalSearchPath(tx *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema: %q", schema)
	}
	if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
		return fmt.Errorf("set search path: %w", err)
	}
	return nil
}
