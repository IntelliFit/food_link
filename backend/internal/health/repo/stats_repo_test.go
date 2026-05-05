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
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&domain.FoodRecord{},
		&domain.StatsInsight{},
	))
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

	now := time.Now().UTC()
	insight := &domain.StatsInsight{
		UserID:    "user-1",
		Content:   "Test insight",
		DateRange: "week",
		CreatedAt: &now,
	}
	err := r.SaveInsight(ctx, insight)
	require.NoError(t, err)
	assert.NotEmpty(t, insight.ID)

	latest, err := r.GetLatestInsight(ctx, "user-1", "week")
	require.NoError(t, err)
	require.NotNil(t, latest)
	assert.Equal(t, "Test insight", latest.Content)
}
