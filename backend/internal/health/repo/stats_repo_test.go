package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupStatsTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(
		&domain.FoodRecord{},
		&domain.StatsInsight{},
		&domain.StatsUserProfile{},
	))
	require.NoError(t, db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_stats_insights_unique ON ai_stats_insights(user_id, range_type, generated_date)`).Error)
	return db
}

func TestStatsRepo_FoodRecordsForDateRange(t *testing.T) {
	db := setupStatsTestDB(t)
	r := NewStatsRepo(db)
	ctx := context.Background()

	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	record := &domain.FoodRecord{
		UserID:        "user-1",
		MealType:      "lunch",
		TotalCalories: 500,
		TotalProtein:  20,
		TotalCarbs:    60,
		TotalFat:      15,
		RecordTime:    &recordTime,
	}
	err := db.WithContext(ctx).Create(record).Error
	require.NoError(t, err)

	records, err := r.GetFoodRecordsForDateRange(ctx, "user-1",
		time.Date(2024, 6, 14, 0, 0, 0, 0, time.UTC),
		time.Date(2024, 6, 16, 0, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, 500.0, records[0].TotalCalories)
}

func TestStatsRepo_GetExerciseLogsForDateRange(t *testing.T) {
	db := setupStatsTestDB(t)
	r := NewStatsRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Exec(`CREATE TABLE user_exercise_logs (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		exercise_desc TEXT,
		recorded_on TIMESTAMP,
		created_at TIMESTAMP
	)`).Error)

	require.NoError(t, db.Exec(`INSERT INTO user_exercise_logs
		(id, user_id, exercise_desc, recorded_on, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		"ex-in", "user-1", "跑步", "2024-06-15", time.Date(2024, 6, 15, 9, 0, 0, 0, time.UTC)).Error)
	require.NoError(t, db.Exec(`INSERT INTO user_exercise_logs
		(id, user_id, exercise_desc, recorded_on, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		"ex-out", "user-1", "力量训练", "2024-06-13", time.Date(2024, 6, 13, 9, 0, 0, 0, time.UTC)).Error)

	logs, err := r.GetExerciseLogsForDateRange(ctx, "user-1", "2024-06-14", "2024-06-15")
	require.NoError(t, err)
	require.Len(t, logs, 1)
	assert.Equal(t, "ex-in", logs[0].ID)
}

func TestStatsRepo_Insight(t *testing.T) {
	db := setupStatsTestDB(t)
	r := NewStatsRepo(db)
	ctx := context.Background()

	err := r.UpsertInsightCache(ctx, "user-1", "week", "2024-06-15", "fp-1", "Test insight")
	require.NoError(t, err)

	cached, err := r.GetCachedInsight(ctx, "user-1", "week", "2024-06-15")
	require.NoError(t, err)
	require.NotNil(t, cached)
	assert.Equal(t, "Test insight", cached.InsightText)

	err = r.UpsertInsightCache(ctx, "user-1", "week", "2024-06-15", "fp-2", "Updated insight")
	require.NoError(t, err)

	latest, err := r.GetLatestCachedInsight(ctx, "user-1", "week")
	require.NoError(t, err)
	require.NotNil(t, latest)
	assert.Equal(t, "Updated insight", latest.InsightText)
	assert.Equal(t, "fp-2", latest.DataFingerprint)
}

func TestStatsRepo_CountInsightGenerationsToday(t *testing.T) {
	db := setupStatsTestDB(t)
	r := NewStatsRepo(db)
	ctx := context.Background()

	count, err := r.CountInsightGenerationsToday(ctx, "user-1")
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)

	err = r.UpsertInsightCache(ctx, "user-1", "week", "2024-06-15", "fp-1", "Insight 1")
	require.NoError(t, err)
	err = r.UpsertInsightCache(ctx, "user-1", "month", "2024-06-15", "fp-2", "Insight 2")
	require.NoError(t, err)

	count, err = r.CountInsightGenerationsToday(ctx, "user-1")
	require.NoError(t, err)
	assert.Equal(t, int64(2), count)

	count, err = r.CountInsightGenerationsToday(ctx, "user-2")
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)
}
