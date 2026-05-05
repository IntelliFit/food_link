package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockBodyMetricsRepo struct {
	weightRecords []domain.BodyWeightRecord
	waterLogs     []domain.BodyWaterLog
	settings      *domain.BodyMetricSettings
}

func (m *mockBodyMetricsRepo) CreateWeightRecord(ctx context.Context, record *domain.BodyWeightRecord) error {
	m.weightRecords = append(m.weightRecords, *record)
	return nil
}

func (m *mockBodyMetricsRepo) ListWeightRecords(ctx context.Context, userID string, startDate, endDate string) ([]domain.BodyWeightRecord, error) {
	return m.weightRecords, nil
}

func (m *mockBodyMetricsRepo) GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error) {
	if len(m.weightRecords) == 0 {
		return nil, nil
	}
	return &m.weightRecords[len(m.weightRecords)-1], nil
}

func (m *mockBodyMetricsRepo) CreateWaterLog(ctx context.Context, log *domain.BodyWaterLog) error {
	m.waterLogs = append(m.waterLogs, *log)
	return nil
}

func (m *mockBodyMetricsRepo) GetWaterLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.BodyWaterLog, error) {
	return m.waterLogs, nil
}

func (m *mockBodyMetricsRepo) DeleteWaterLogsByDate(ctx context.Context, userID string, recordedOn string) (int64, error) {
	filtered := make([]domain.BodyWaterLog, 0)
	deleted := int64(0)
	for _, log := range m.waterLogs {
		if log.RecordedOn != nil && log.RecordedOn.Format("2006-01-02") == recordedOn {
			deleted++
		} else {
			filtered = append(filtered, log)
		}
	}
	m.waterLogs = filtered
	return deleted, nil
}

func (m *mockBodyMetricsRepo) GetBodyMetricSettings(ctx context.Context, userID string) (*domain.BodyMetricSettings, error) {
	return m.settings, nil
}

func (m *mockBodyMetricsRepo) UpsertBodyMetricSettings(ctx context.Context, settings *domain.BodyMetricSettings) error {
	m.settings = settings
	return nil
}

func (m *mockBodyMetricsRepo) SumWaterByDate(ctx context.Context, userID string, recordedOn string) (int64, error) {
	var total int64
	for _, log := range m.waterLogs {
		if log.RecordedOn != nil && log.RecordedOn.Format("2006-01-02") == recordedOn {
			total += int64(log.AmountMl)
		}
	}
	return total, nil
}

func TestBodyMetricsService_GetSummary(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn1 := time.Date(2024, 6, 14, 0, 0, 0, 0, time.UTC)
	recordedOn2 := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	repo.weightRecords = []domain.BodyWeightRecord{
		{UserID: "u1", WeightKg: 70.0, RecordedOn: &recordedOn1, CreatedAt: &now},
		{UserID: "u1", WeightKg: 69.5, RecordedOn: &recordedOn2, CreatedAt: &now},
	}
	repo.waterLogs = []domain.BodyWaterLog{
		{UserID: "u1", AmountMl: 250, RecordedOn: &recordedOn2, CreatedAt: &now},
		{UserID: "u1", AmountMl: 500, RecordedOn: &recordedOn2, CreatedAt: &now},
	}

	summary, err := svc.GetSummary(ctx, "u1", "week")
	require.NoError(t, err)
	assert.NotNil(t, summary)
	assert.Len(t, summary.WeightEntries, 2)
	assert.NotNil(t, summary.LatestWeight)
	assert.NotNil(t, summary.PreviousWeight)
	assert.NotNil(t, summary.WeightChange)
	assert.Equal(t, -0.5, *summary.WeightChange)
}

func TestBodyMetricsService_AddWaterLog(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	result, err := svc.AddWaterLog(ctx, "u1", 300, "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, "喝水已记录", result["message"])
	assert.Len(t, repo.waterLogs, 1)
	assert.Equal(t, 300, repo.waterLogs[0].AmountMl)
}

func TestBodyMetricsService_ResetWaterLogs(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	repo.waterLogs = []domain.BodyWaterLog{
		{UserID: "u1", AmountMl: 250, RecordedOn: &recordedOn, CreatedAt: &now},
	}

	result, err := svc.ResetWaterLogs(ctx, "u1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, int64(1), result["deleted_count"])
	assert.Len(t, repo.waterLogs, 0)
}

func TestBodyMetricsService_SaveWeightRecord(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	result, err := svc.SaveWeightRecord(ctx, "u1", 72.5, "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, "体重已保存", result["message"])
	assert.Len(t, repo.weightRecords, 1)
	assert.Equal(t, 72.5, repo.weightRecords[0].WeightKg)
}

func TestBodyMetricsService_SyncLocal(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	waterGoal := 2500
	result, err := svc.SyncLocal(ctx, "u1", SyncLocalInput{
		WeightEntries: []LocalWeightEntry{
			{Date: "2024-06-15", Value: 70.5, ClientID: "w1"},
		},
		WaterByDate: map[string]LocalWaterDay{
			"2024-06-15": {Total: 500, Logs: []int{250, 250}},
		},
		WaterGoalMl: &waterGoal,
	})
	require.NoError(t, err)
	assert.Equal(t, 1, result["imported_weight_count"])
	assert.Equal(t, 2, result["imported_water_count"])
	assert.NotNil(t, repo.settings)
	assert.Equal(t, 2500, repo.settings.WaterGoalMl)
}
