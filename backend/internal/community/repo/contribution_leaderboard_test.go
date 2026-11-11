package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

func TestContributionCountsPublishedCreationEvidenceAndMonth(t *testing.T) {
	db := testdb.New(t)
	t.Cleanup(func() { require.NoError(t, testdb.Stop()) })
	for _, ddl := range []string{
		`CREATE TABLE weapp_user (id TEXT PRIMARY KEY)`,
		`CREATE TABLE packaged_food_library (id TEXT PRIMARY KEY, is_active BOOL, review_status TEXT, created_at TIMESTAMPTZ)`,
		`CREATE TABLE reward_task_uploads (user_id TEXT, task_type TEXT, packaged_food_id TEXT, status TEXT, meta JSONB, created_at TIMESTAMPTZ)`,
		`CREATE TABLE analysis_tasks (user_id TEXT, task_type TEXT, status TEXT, result JSONB, created_at TIMESTAMPTZ)`,
		`CREATE TABLE food_nutrition_library (id TEXT PRIMARY KEY, is_active BOOL)`,
		`CREATE TABLE food_nutrition_contributions (user_id TEXT, status TEXT, review_action TEXT, target_food_id TEXT, legacy_custom_food_id TEXT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ)`,
		`CREATE TABLE public_food_library (id TEXT PRIMARY KEY, user_id TEXT, status TEXT, created_at TIMESTAMPTZ)`,
		`CREATE TABLE user_custom_foods (id TEXT PRIMARY KEY, user_id TEXT, status TEXT, public_status TEXT, public_food_item_id TEXT, created_at TIMESTAMPTZ)`,
	} {
		require.NoError(t, db.Exec(ddl).Error)
	}
	require.NoError(t, db.Exec(`INSERT INTO weapp_user VALUES ('a'),('b'),('departing'),('cancelled')`).Error)
	stamp := time.Date(2026, 11, 15, 4, 0, 0, 0, time.UTC)
	for _, p := range []struct {
		id, review string
		active     bool
		at         time.Time
	}{
		{"old", "active", true, time.Date(2026, 10, 31, 15, 59, 59, 0, time.UTC)},
		{"new", "active", true, time.Date(2026, 10, 31, 16, 0, 0, 0, time.UTC)},
		{"cap", "active", true, stamp}, {"capture", "active", true, stamp},
		{"hidden", "active", false, stamp}, {"pending", "pending_review", true, stamp},
		{"existing", "active", true, stamp}, {"departing", "active", true, stamp},
	} {
		require.NoError(t, db.Exec(`INSERT INTO packaged_food_library VALUES (?,?,?,?)`, p.id, p.active, p.review, p.at).Error)
	}
	for _, r := range []struct{ user, food, status, action string }{
		{"a", "old", "succeeded", "created"}, {"a", "new", "succeeded", "created"},
		{"a", "new", "succeeded", "created"}, {"a", "cap", "failed", "created"},
		{"a", "hidden", "succeeded", "created"}, {"a", "pending", "succeeded", "created"},
		{"b", "existing", "succeeded", "updated"}, {"departing", "departing", "succeeded", "created"},
	} {
		require.NoError(t, db.Exec(`INSERT INTO reward_task_uploads VALUES (?,'packaged_food_upload',?,?,jsonb_build_object('upsert_action',?::text),?)`, r.user, r.food, r.status, r.action, stamp).Error)
	}
	for _, capture := range []struct{ user, status, payload string }{
		{"a", "done", `{"packaged_product":{"packaged_food_id":"new","auto_ingest_result":{"upsert_action":"created"}}}`},
		{"b", "done", `{"packaged_product":{"auto_ingest_result":{"packaged_food_id":"capture","upsert_action":"created"}}}`},
		{"b", "done", `{"packaged_product":{"packaged_food_id":"existing","auto_ingest_result":{"upsert_action":"updated"}}}`},
		{"b", "failed", `{"packaged_product":{"packaged_food_id":"existing","auto_ingest_result":{"upsert_action":"created"}}}`},
	} {
		require.NoError(t, db.Exec(`INSERT INTO analysis_tasks VALUES (?,'packaged_product_extract',?,?::jsonb,?)`, capture.user, capture.status, capture.payload, stamp).Error)
	}
	require.NoError(t, db.Exec(`INSERT INTO food_nutrition_library VALUES ('standard',TRUE),('merged',TRUE),('offline',FALSE)`).Error)
	for _, c := range []struct{ food, action, legacy string }{{"standard", "approve_new", "legacy"}, {"merged", "merge_existing", "legacy-merge"}, {"offline", "approve_new", ""}} {
		require.NoError(t, db.Exec(`INSERT INTO food_nutrition_contributions VALUES ('a','approved',?,?,?,?,?)`, c.action, c.food, c.legacy, stamp, stamp).Error)
	}
	for _, p := range []struct {
		id, user, status string
		at               time.Time
	}{
		{"meal", "a", "published", stamp}, {"private", "a", "private", stamp},
		{"next-month", "a", "published", time.Date(2026, 11, 30, 16, 0, 0, 0, time.UTC)},
	} {
		require.NoError(t, db.Exec(`INSERT INTO public_food_library VALUES (?,?,?,?)`, p.id, p.user, p.status, p.at).Error)
	}
	for _, c := range []struct{ id, user, status, public, meal string }{
		{"custom", "a", "active", "published", ""}, {"private", "a", "active", "private", ""},
		{"deleted", "a", "deleted", "published", ""}, {"mapped", "a", "active", "published", "meal"},
		{"legacy", "a", "active", "published", ""}, {"legacy-merge", "a", "active", "published", ""},
		{"no-profile", "gone", "active", "published", ""}, {"cancelled", "cancelled", "active", "published", ""},
	} {
		require.NoError(t, db.Exec(`INSERT INTO user_custom_foods VALUES (?,?,?,?,?,?)`, c.id, c.user, c.status, c.public, c.meal, stamp).Error)
	}
	r := NewFeedRepo(db)
	ctx := context.Background()
	beforeDeletionMigration, err := r.GetContributionCounts(ctx, nil, nil)
	require.NoError(t, err)
	require.Equal(t, 7, beforeDeletionMigration["a"].Total)
	require.Equal(t, 1, beforeDeletionMigration["departing"].Total)
	require.NoError(t, db.Exec(`CREATE TABLE account_deletions (user_id TEXT, state TEXT)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO account_deletions VALUES ('departing','pending'),('cancelled','cancelled')`).Error)
	all, err := r.GetContributionCounts(ctx, nil, nil)
	require.NoError(t, err)
	require.Equal(t, ContributionCounts{UserID: "a", Total: 7, Standard: 1, Packaged: 3, Meals: 2, Custom: 1}, all["a"])
	require.Equal(t, 1, all["b"].Total)
	require.Equal(t, 1, all["cancelled"].Total)
	require.NotContains(t, all, "departing")
	require.NotContains(t, all, "gone")
	start, end := time.Date(2026, 10, 31, 16, 0, 0, 0, time.UTC), time.Date(2026, 11, 30, 16, 0, 0, 0, time.UTC)
	month, err := r.GetContributionCounts(ctx, &start, &end)
	require.NoError(t, err)
	require.Equal(t, 5, month["a"].Total, "old packages cannot re-enter this month and next month's boundary is exclusive")
}
