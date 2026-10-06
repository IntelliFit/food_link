package migration

import (
	"context"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestAnalyticsMigrationPreservesAccountsAndBusinessTables(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, db.Exec(`CREATE TABLE business_marker (id integer primary key, value text); INSERT INTO business_marker VALUES (1,'unchanged');
	CREATE TABLE admin_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), username text NOT NULL, display_name text NOT NULL DEFAULT '', password_hash text NOT NULL, status text NOT NULL DEFAULT 'active', last_login_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
	INSERT INTO admin_accounts(username,password_hash) VALUES ('existing','preserved-hash');`).Error)
	require.NoError(t, MigrateAnalytics(ctx, db, "public"))
	var before migrationdo.AnalyticsStateDO
	require.NoError(t, db.First(&before, 1).Error)
	var role string
	require.NoError(t, db.Raw("SELECT role FROM admin_accounts WHERE username='existing'").Scan(&role).Error)
	require.Equal(t, "admin", role)
	require.NoError(t, db.Exec("INSERT INTO admin_accounts(username,password_hash,role) VALUES ('viewer','hash','analytics_viewer')").Error)
	require.NoError(t, MigrateAnalytics(ctx, db, "public"))
	var after migrationdo.AnalyticsStateDO
	require.NoError(t, db.First(&after, 1).Error)
	require.WithinDuration(t, before.StartedAt, after.StartedAt, time.Microsecond)
	var value string
	require.NoError(t, db.Raw("SELECT value FROM business_marker WHERE id=1").Scan(&value).Error)
	require.Equal(t, "unchanged", value)
	require.NoError(t, db.Raw("SELECT password_hash FROM admin_accounts WHERE username='existing'").Scan(&value).Error)
	require.Equal(t, "preserved-hash", value)
	require.Error(t, db.Exec("INSERT INTO admin_accounts(username,password_hash,role) VALUES ('bad','hash','unknown')").Error)
}
