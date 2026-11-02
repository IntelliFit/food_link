package repo

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"food_link/backend/internal/migration"
	"food_link/backend/internal/onboarding/domain"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestRepoAgainstPostgres(t *testing.T) {
	db := testdb.New(t)
	ctx := context.Background()
	require.NoError(t, migration.MigrateExperimentTables(ctx, db))
	require.NoError(t, migration.MigrateContentConfigTables(ctx, db))
	for _, stmt := range []string{
		`CREATE TABLE food_nutrition_library (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_active boolean, quality_tier text, source text)`,
		`CREATE TABLE campus_food_catalog_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id text, status text)`,
		`CREATE TABLE packaged_food_library (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), is_active boolean, review_status text)`,
		`CREATE TABLE weapp_user (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`,
		`CREATE TABLE user_food_records (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`,
		`INSERT INTO food_nutrition_library (id, is_active, quality_tier, source) VALUES
			('00000000-0000-0000-0000-000000000001', true, 'authoritative', '美国农业部食物数据中心（SR Legacy）'),
			('00000000-0000-0000-0000-000000000002', true, 'legacy_curated', 'boohee_ui_food_batch_001'),
			('00000000-0000-0000-0000-000000000003', false, 'authoritative', 'usda')`,
		`INSERT INTO campus_food_catalog_items (school_id, status) VALUES ('s1','published'),('s1','published'),('s2','published'),('s3','draft')`,
		`INSERT INTO packaged_food_library (is_active, review_status) VALUES (true,'active'),(true,'web_verified'),(true,'pending'),(false,'active')`,
		`INSERT INTO weapp_user DEFAULT VALUES`,
		`INSERT INTO user_food_records DEFAULT VALUES`,
		`INSERT INTO user_food_records DEFAULT VALUES`,
	} {
		require.NoError(t, db.Exec(stmt).Error)
	}
	repo := NewOnboardingRepo(db)

	stats, err := repo.Stats(ctx)
	require.NoError(t, err)
	require.Equal(t, int64(2), stats.StandardFoods)
	require.Equal(t, int64(1), stats.AuthoritativeFoods)
	require.Equal(t, int64(3), stats.CampusDishes)
	require.Equal(t, int64(2), stats.CampusSchools)
	require.Equal(t, int64(2), stats.PackagedFoods)
	require.Equal(t, int64(1), stats.Users)
	require.Equal(t, int64(2), stats.FoodRecords)

	sources, err := repo.FoodSources(ctx, []string{"00000000-0000-0000-0000-000000000001", "missing"})
	require.NoError(t, err)
	require.Equal(t, map[string]string{"00000000-0000-0000-0000-000000000001": "美国农业部食物数据中心（SR Legacy）"}, sources)

	raw, err := repo.GetConfig(ctx, "onboarding_v2")
	require.NoError(t, err)
	require.Nil(t, raw)
	require.NoError(t, repo.SaveConfig(ctx, "onboarding_v2", json.RawMessage(`{"badges":[]}`), "a"))
	require.NoError(t, repo.SaveConfig(ctx, "onboarding_v2", json.RawMessage(`{"badges":[{"icon":"shield","text":"x"}]}`), "b"))
	raw, err = repo.GetConfig(ctx, "onboarding_v2")
	require.NoError(t, err)
	require.JSONEq(t, `{"badges":[{"icon":"shield","text":"x"}]}`, string(raw))

	now := time.Now()
	since := now.Add(-time.Hour)
	limits := &domain.TryLimits{PerInstall: 2, Global: 3}
	for i, want := range []domain.TryVerdict{domain.TryAllowed, domain.TryAllowed, domain.TryInstallCapped} {
		got, err := repo.ReserveTry(ctx, "anon_repo_0001", "", map[string]any{"correction": i > 0}, now, since, limits)
		require.NoError(t, err)
		require.Equal(t, want, got, "第 %d 次", i+1)
	}
	_, err = repo.ReserveTry(ctx, "anon_repo_0002", "", nil, now.Add(-48*time.Hour), now.Add(-72*time.Hour), nil)
	require.NoError(t, err)
	got, err := repo.ReserveTry(ctx, "anon_repo_0003", "", nil, now, since, limits)
	require.NoError(t, err)
	require.Equal(t, domain.TryAllowed, got, "昨天之前的体验不算今天的次数")
	got, err = repo.ReserveTry(ctx, "anon_repo_0004", "", nil, now, since, limits)
	require.NoError(t, err)
	require.Equal(t, domain.TryGlobalCapped, got)
	got, err = repo.ReserveTry(ctx, "anon_repo_0004", "user-x", nil, now, since, nil)
	require.Error(t, err, "user_id 必须是 uuid")
	_ = got
	var n int64
	require.NoError(t, db.Raw("SELECT count(*) FROM app_events WHERE name = ?", domain.TryEventName).Scan(&n).Error)
	require.Equal(t, int64(4), n, "被拦下的请求不写记录")
}
