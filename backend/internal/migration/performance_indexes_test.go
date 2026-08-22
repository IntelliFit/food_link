package migration

import (
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/require"
)

func TestGrowthSensitiveReadModelsDeclareCompositeIndexes(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(
		&migrationdo.FoodRecordDO{},
		&migrationdo.FeedInteractionNotificationDO{},
		&migrationdo.ExerciseLogDO{},
		&migrationdo.UserCirclePostDO{},
		&migrationdo.BodyWeightRecordDO{},
	))

	checks := []struct {
		model any
		name  string
	}{
		{&migrationdo.FoodRecordDO{}, "idx_user_food_records_user_record_time"},
		{&migrationdo.FoodRecordDO{}, "idx_user_food_records_feed_created"},
		{&migrationdo.FeedInteractionNotificationDO{}, "idx_feed_interaction_notifications_recipient_created"},
		{&migrationdo.ExerciseLogDO{}, "idx_user_exercise_logs_user_created"},
		{&migrationdo.ExerciseLogDO{}, "idx_user_exercise_logs_feed_created"},
		{&migrationdo.UserCirclePostDO{}, "idx_user_circle_posts_user_created_page"},
		{&migrationdo.UserCirclePostDO{}, "idx_user_circle_posts_feed_created"},
		{&migrationdo.BodyWeightRecordDO{}, "idx_user_weight_records_daily_latest"},
	}
	for _, check := range checks {
		require.True(t, db.Migrator().HasIndex(check.model, check.name), "缺少增长型读取索引 %s", check.name)
	}
}

func TestMigrateGrowthPerformanceIndexesCreatesOnlyTargetIndexes(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(
		&migrationdo.FoodRecordDO{},
		&migrationdo.FeedInteractionNotificationDO{},
		&migrationdo.ExerciseLogDO{},
		&migrationdo.UserCirclePostDO{},
		&migrationdo.BodyWeightRecordDO{},
	))

	indexNames := []string{
		"idx_feed_interaction_notifications_recipient_created",
		"idx_user_food_records_user_record_time",
		"idx_user_food_records_user_created",
		"idx_user_food_records_feed_created",
		"idx_user_exercise_logs_user_created",
		"idx_user_exercise_logs_feed_created",
		"idx_user_circle_posts_user_created_page",
		"idx_user_circle_posts_feed_created",
		"idx_user_weight_records_daily_latest",
	}
	for _, name := range indexNames {
		require.NoError(t, db.Exec(`DROP INDEX IF EXISTS "`+name+`"`).Error)
	}

	require.NoError(t, MigrateGrowthPerformanceIndexes(t.Context(), db, "public"))
	for _, name := range indexNames {
		var exists bool
		require.NoError(t, db.Raw("SELECT to_regclass(?) IS NOT NULL", name).Scan(&exists).Error)
		require.True(t, exists, "性能迁移未创建索引 %s", name)
	}
}

func TestMigrateGrowthPerformanceIndexesRebuildsInvalidIndex(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodRecordDO{}))
	require.NoError(t, db.Create(&migrationdo.FoodRecordDO{ID: "00000000-0000-0000-0000-000000000001", UserID: "00000000-0000-0000-0000-000000000003"}).Error)
	require.NoError(t, db.Create(&migrationdo.FoodRecordDO{ID: "00000000-0000-0000-0000-000000000002", UserID: "00000000-0000-0000-0000-000000000003"}).Error)
	require.NoError(t, db.Exec(`DROP INDEX idx_user_food_records_user_created`).Error)

	createErr := db.Exec(`CREATE UNIQUE INDEX CONCURRENTLY idx_user_food_records_user_created ON user_food_records (user_id)`).Error
	require.Error(t, createErr)
	var valid bool
	require.NoError(t, db.Raw(`
		SELECT i.indisvalid
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_index i ON i.indexrelid = c.oid
		WHERE n.nspname = 'public' AND c.relname = 'idx_user_food_records_user_created'
	`).Scan(&valid).Error)
	require.False(t, valid)

	for _, model := range []any{
		&migrationdo.FeedInteractionNotificationDO{},
		&migrationdo.ExerciseLogDO{},
		&migrationdo.UserCirclePostDO{},
		&migrationdo.BodyWeightRecordDO{},
	} {
		require.NoError(t, db.AutoMigrate(model))
	}
	require.NoError(t, MigrateGrowthPerformanceIndexes(t.Context(), db, "public"))

	require.NoError(t, db.Raw(`
		SELECT i.indisvalid
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_index i ON i.indexrelid = c.oid
		WHERE n.nspname = 'public' AND c.relname = 'idx_user_food_records_user_created'
	`).Scan(&valid).Error)
	require.True(t, valid)
}
