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

func setupBodyMetricsTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
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

	deleted, err := r.DeleteWeightRecordByID(ctx, "user-1", record.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)

	records, err = r.ListWeightRecords(ctx, "user-1", "", "")
	require.NoError(t, err)
	assert.Empty(t, records)
}

func TestBodyMetricsRepoListDailyWeightRecordsReturnsLatestPerDay(t *testing.T) {
	db := setupBodyMetricsTestDB(t)
	r := NewBodyMetricsRepo(db)
	ctx := context.Background()
	day := time.Date(2026, 8, 22, 0, 0, 0, 0, time.UTC)
	earlier := time.Date(2026, 8, 22, 8, 0, 0, 0, time.UTC)
	later := earlier.Add(time.Hour)
	require.NoError(t, db.Create(&domain.BodyWeightRecord{ID: "w1", UserID: "user-1", RecordedOn: &day, WeightKg: 70, CreatedAt: &earlier}).Error)
	require.NoError(t, db.Create(&domain.BodyWeightRecord{ID: "w2", UserID: "user-1", RecordedOn: &day, WeightKg: 69.5, CreatedAt: &later}).Error)

	rows, err := r.ListDailyWeightRecords(ctx, "user-1", "2026-08-01", "2026-08-31")
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, 69.5, rows[0].WeightKg)
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

	deleted, err := r.DeleteWaterLogByID(ctx, "user-1", log.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)

	logs, err = r.GetWaterLogsByExactDate(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Empty(t, logs)

	err = r.CreateWaterLog(ctx, log)
	require.NoError(t, err)

	deleted, err = r.DeleteWaterLogsByDate(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)
}

func TestBodyMetricsRepo_ReduceWaterLogsByDateSource(t *testing.T) {
	db := setupBodyMetricsTestDB(t)
	r := NewBodyMetricsRepo(db)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	manualSource := "manual"
	require.NoError(t, r.CreateWaterLog(ctx, &domain.BodyWaterLog{UserID: "user-1", AmountMl: 100, RecordedOn: &recordedOn, SourceType: manualSource, CreatedAt: &now}))
	require.NoError(t, r.CreateWaterLog(ctx, &domain.BodyWaterLog{UserID: "user-1", AmountMl: 80, RecordedOn: &recordedOn, SourceType: "ai", CreatedAt: &now}))
	require.NoError(t, r.CreateWaterLog(ctx, &domain.BodyWaterLog{UserID: "user-1", AmountMl: 150, RecordedOn: &recordedOn, SourceType: "ai", CreatedAt: &now}))

	reduced, err := r.ReduceWaterLogsByDateSource(ctx, "user-1", "2024-06-15", "ai", 200)

	require.NoError(t, err)
	assert.Equal(t, 200, reduced)
	logs, err := r.GetWaterLogsByExactDate(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	total := 0
	manualTotal := 0
	for _, log := range logs {
		total += log.AmountMl
		if log.SourceType == manualSource {
			manualTotal += log.AmountMl
		}
	}
	assert.Equal(t, 130, total)
	assert.Equal(t, 100, manualTotal)

	reduced, err = r.ReduceWaterLogsByDateSource(ctx, "user-1", "2024-06-15", "ai", 999)
	require.NoError(t, err)
	assert.Equal(t, 30, reduced)
	sum, err := r.SumWaterByDate(ctx, "user-1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, int64(100), sum)
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
