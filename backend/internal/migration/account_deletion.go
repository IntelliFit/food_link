package migration

import (
	"context"
	"fmt"
	migrationdo "food_link/backend/internal/migration/do"
	"gorm.io/gorm"
)

// Dedicated, idempotent migration; HTTP startup never applies it.
func MigrateAccountDeletion(ctx context.Context, db *gorm.DB, schema string) error {
	if schema == "" {
		schema = "public"
	}
	if !identifierPattern.MatchString(schema) {
		return fmt.Errorf("invalid database schema")
	}
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SET LOCAL search_path TO " + quoteIdent(schema)).Error; err != nil {
			return err
		}
		if err := tx.AutoMigrate(&migrationdo.AccountDeletionDO{}, &migrationdo.AccountDeletionRetainedDO{}); err != nil {
			return err
		}
		for _, check := range []struct{ name, expr string }{{"account_deletions_state_valid", "state IN ('pending','cleaning','completed','cancelled')"}, {"account_deletions_cursor_valid", "image_cursor >= 0"}} {
			if err := tx.Exec(dropAndAddCheck("account_deletions", check.name, check.expr)).Error; err != nil {
				return err
			}
		}
		// Serializes in-flight writes with account suspension/deletion, including
		// raw SQL and separate workers. No process-local cache can bypass this.
		if err := tx.Exec(`CREATE OR REPLACE FUNCTION foodlink_guard_account_write() RETURNS trigger LANGUAGE plpgsql SET search_path TO ` + quoteIdent(schema) + ` AS $$
DECLARE owner_id text; owner_ids text[];
BEGIN
 IF TG_TABLE_NAME = 'weapp_user' THEN
   IF EXISTS (SELECT 1 FROM account_deletions WHERE user_id = NEW.id AND state <> 'cancelled')
     AND (to_jsonb(NEW) - ARRAY['last_login_at','last_login_method','update_time']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['last_login_at','last_login_method','update_time']) THEN
       RAISE EXCEPTION 'account is unavailable for profile writes' USING ERRCODE = '23514';
   END IF;
   RETURN NEW;
 END IF;
 IF TG_TABLE_NAME = 'pro_membership_payment_records' AND TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
 owner_ids := ARRAY[to_jsonb(NEW)->>'user_id'];
 IF TG_TABLE_NAME = 'private_messages' THEN owner_ids := ARRAY[to_jsonb(NEW)->>'receiver_id']; END IF;
 FOR owner_id IN SELECT DISTINCT value FROM unnest(owner_ids) value WHERE value IS NOT NULL ORDER BY value LOOP
   PERFORM 1 FROM weapp_user WHERE id::text = owner_id FOR KEY SHARE;
   IF NOT FOUND OR EXISTS (SELECT 1 FROM account_deletions WHERE user_id::text = owner_id AND state <> 'cancelled') THEN
     RAISE EXCEPTION 'account is unavailable for writes' USING ERRCODE = '23514';
   END IF;
 END LOOP;
 RETURN NEW;
END $$`).Error; err != nil {
			return err
		}
		var tables []string
		if err := tx.Raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t USING(table_schema,table_name)
WHERE c.table_schema = ? AND c.column_name = 'user_id' AND t.table_type = 'BASE TABLE'
AND c.table_name NOT IN ('account_deletions','account_deletion_retained','app_events')`, schema).Scan(&tables).Error; err != nil {
			return err
		}
		for _, table := range tables {
			if !identifierPattern.MatchString(table) {
				return fmt.Errorf("invalid account-owned table")
			}
			if err := tx.Exec("DROP TRIGGER IF EXISTS foodlink_account_write_guard ON " + quoteIdent(table)).Error; err != nil {
				return err
			}
			if err := tx.Exec("CREATE TRIGGER foodlink_account_write_guard BEFORE INSERT OR UPDATE ON " + quoteIdent(table) + " FOR EACH ROW EXECUTE FUNCTION foodlink_guard_account_write()").Error; err != nil {
				return err
			}
		}
		if tx.Migrator().HasTable("private_messages") {
			if err := tx.Exec("DROP TRIGGER IF EXISTS foodlink_account_write_guard ON private_messages").Error; err != nil {
				return err
			}
			if err := tx.Exec("CREATE TRIGGER foodlink_account_write_guard BEFORE INSERT OR UPDATE ON private_messages FOR EACH ROW EXECUTE FUNCTION foodlink_guard_account_write()").Error; err != nil {
				return err
			}
		}
		if err := tx.Exec("DROP TRIGGER IF EXISTS foodlink_account_profile_guard ON weapp_user").Error; err != nil {
			return err
		}
		if err := tx.Exec("CREATE TRIGGER foodlink_account_profile_guard BEFORE UPDATE ON weapp_user FOR EACH ROW EXECUTE FUNCTION foodlink_guard_account_write()").Error; err != nil {
			return err
		}
		return nil
	})
}
