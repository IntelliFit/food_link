package repo

import (
	"context"
	"food_link/backend/internal/migration"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestAnalyticsDedupCoverageRefundsAndTestExclusions(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, migration.MigrateAnalytics(ctx, db, "public"))
	require.NoError(t, migration.MigrateAnalytics(ctx, db, "public"))
	require.NoError(t, db.Exec(`CREATE TABLE membership_payment_test_users (user_id uuid);
	CREATE TABLE membership_plan_config (code text, is_test_plan boolean);
	CREATE TABLE pro_membership_payment_records (user_id uuid, plan_code text, amount numeric, currency text, paid_at timestamptz, refunded_at timestamptz, status text, extra jsonb DEFAULT '{}');
	CREATE TABLE user_pro_memberships (user_id uuid,status text,expires_at timestamptz,current_period_start timestamptz);`).Error)
	u := "11111111-1111-1111-1111-111111111111"
	u2 := "22222222-2222-2222-2222-222222222222"
	testUser := "33333333-3333-3333-3333-333333333333"
	require.NoError(t, db.Exec("INSERT INTO membership_payment_test_users VALUES (?)", testUser).Error)
	r := NewAnalyticsRepo(db)
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, AnalyticsTimezone)
	started := now.AddDate(0, 0, -40)
	for _, event := range []struct {
		id string
		at time.Time
	}{{u, now}, {u, now}, {u, now.AddDate(0, 0, -1)}, {u2, now.AddDate(0, 0, -10)}, {testUser, now}} {
		require.NoError(t, r.Record(ctx, event.id, event.at))
	}
	row, err := r.ComputeDay(ctx, now, started, now)
	require.NoError(t, err)
	require.EqualValues(t, 1, *row.DAU)
	require.EqualValues(t, 2, *row.MAU)
	partial, err := r.ComputeDay(ctx, started, started, now)
	require.NoError(t, err)
	require.Nil(t, partial.DAU)
	require.Nil(t, partial.MAU)
	require.NoError(t, r.SaveDay(ctx, row))
	rows, err := r.Days(ctx, now.AddDate(0, 0, -1), now.AddDate(0, 0, 1))
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "2026-10-06", rows[0].Day)
	require.NoError(t, db.Exec("INSERT INTO membership_plan_config VALUES ('normal',false),('test',true)").Error)
	for _, event := range []struct {
		id, plan, status string
		amount           int
		refund           any
	}{{u, "normal", "paid", 100, nil}, {u, "normal", "paid", 100, nil}, {u2, "normal", "refunded", 100, now.AddDate(0, 0, -1)}, {testUser, "normal", "paid", 100, nil}, {u2, "test", "paid", 100, nil}, {u2, "normal", "paid", 0, nil}} {
		require.NoError(t, db.Exec("INSERT INTO pro_membership_payment_records (user_id,plan_code,amount,currency,paid_at,refunded_at,status) VALUES (?,?,?,'CNY',?,?,?)", event.id, event.plan, event.amount, now.AddDate(0, 0, -5), event.refund, event.status).Error)
	}
	n, err := r.PayingUsers(ctx, now.AddDate(0, 0, -7), now)
	require.NoError(t, err)
	require.EqualValues(t, 1, n)
	require.NoError(t, db.Exec("INSERT INTO pro_membership_payment_records (user_id,plan_code,amount,currency,paid_at,status,extra) VALUES (?,'normal',100,'CNY',?,'paid','{\"xpay_env\":1}')", u2, now.AddDate(0, 0, -1)).Error)
	n, err = r.PayingUsers(ctx, now.AddDate(0, 0, -7), now)
	require.NoError(t, err)
	require.EqualValues(t, 1, n)
	n, err = r.PayingUsers(ctx, now.AddDate(0, 0, -7), now.AddDate(0, 0, -2))
	require.NoError(t, err)
	require.EqualValues(t, 2, n)
	require.NoError(t, db.Exec("INSERT INTO user_pro_memberships VALUES (?,'active',?,?),(?,'active',?,?)", u, now.AddDate(0, 1, 0), now.AddDate(0, 0, -5), u2, now.AddDate(0, 1, 0), now.AddDate(0, 0, -5)).Error)
	n, err = r.ActivePaidMembers(ctx, now)
	require.NoError(t, err)
	require.EqualValues(t, 1, n)
}
