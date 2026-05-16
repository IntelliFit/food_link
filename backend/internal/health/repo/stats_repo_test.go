package repo

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupStatsTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
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
