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

func setupBodyMetricsTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&domain.BodyWeightRecord{},
		&domain.BodyWaterLog{},
		&domain.BodyMetricSettings{},
	))
	return db
}

func TestBodyMetricsRepo_WeightCRUD(t *testing.T) {
	db := setupBodyMetricsTestDB(t)
	r := NewBodyMetricsRepo(db)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	record := &domain.BodyWeightRecord{
		UserID:     "user-1",
		WeightKg:   70.5,
		RecordedOn: &recordedOn,
		CreatedAt:  &now,
	}

	err := r.CreateWeightRecord(ctx, record)
	require.NoError(t, err)
	assert.NotEmpty(t, record.ID)

	records, err := r.ListWeightRecords(ctx, "user-1", "", "")
	require.NoError(t, err)
	assert.Len(t, records, 1)
	assert.Equal(t, 70.5, records[0].WeightKg)

	latest, err := r.GetLatestWeightRecord(ctx, "user-1")
	require.NoError(t, err)
	require.NotNil(t, latest)
	assert.Equal(t, 70.5, latest.WeightKg)
}

func TestBodyMetricsRepo_WaterCRUD(t *testing.T) {
	db := setupBodyMetricsTestDB(t)
	r := NewBodyMetricsRepo(db)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	log := &domain.BodyWaterLog{
		UserID:     "user-1",
		AmountMl:   250,
		RecordedOn: &recordedOn,
		CreatedAt:  &now,
	}

	err := r.CreateWaterLog(ctx, log)
	require.NoError(t, err)
	assert.NotEmpty(t, log.ID)

	logs, err := r.GetWaterLogsByExactDate(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Len(t, logs, 1)
	assert.Equal(t, 250, logs[0].AmountMl)

	total, err := r.SumWaterByDate(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, int64(250), total)

	deleted, err := r.DeleteWaterLogsByDate(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)
}

func TestBodyMetricsRepo_Settings(t *testing.T) {
	db := setupBodyMetricsTestDB(t)
	r := NewBodyMetricsRepo(db)
	ctx := context.Background()

	settings := &domain.BodyMetricSettings{
		UserID:      "user-1",
		WaterGoalMl: 2500,
	}
	err := r.UpsertBodyMetricSettings(ctx, settings)
	require.NoError(t, err)

	found, err := r.GetBodyMetricSettings(ctx, "user-1")
	require.NoError(t, err)
	require.NotNil(t, found)
	assert.Equal(t, 2500, found.WaterGoalMl)
}
