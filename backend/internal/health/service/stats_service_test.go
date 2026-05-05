package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockStatsRepo struct {
	records  []domain.FoodRecord
	insights []domain.StatsInsight
}

func (m *mockStatsRepo) GetFoodRecordsForDateRange(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]domain.FoodRecord, error) {
	return m.records, nil
}

func (m *mockStatsRepo) GetDistinctRecordDays(ctx context.Context, userID string, startUTC, endUTC time.Time) (int64, error) {
	days := make(map[string]bool)
	for _, r := range m.records {
		if r.RecordTime != nil {
			days[r.RecordTime.Format("2006-01-02")] = true
		}
	}
	return int64(len(days)), nil
}

func (m *mockStatsRepo) SaveInsight(ctx context.Context, insight *domain.StatsInsight) error {
	m.insights = append(m.insights, *insight)
	return nil
}

func (m *mockStatsRepo) GetLatestInsight(ctx context.Context, userID string, dateRange string) (*domain.StatsInsight, error) {
	for i := len(m.insights) - 1; i >= 0; i-- {
		if m.insights[i].UserID == userID && m.insights[i].DateRange == dateRange {
			return &m.insights[i], nil
		}
	}
	return nil, nil
}

type mockBodyMetricsProvider struct {
	summary *BodyMetricsSummary
}

func (m *mockBodyMetricsProvider) GetSummary(ctx context.Context, userID string, statsRange string) (*BodyMetricsSummary, error) {
	return m.summary, nil
}

func TestStatsService_GetSummary(t *testing.T) {
	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &mockStatsRepo{
		records: []domain.FoodRecord{
			{UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime},
		},
	}
	bodyMetrics := &mockBodyMetricsProvider{}
	svc := NewStatsService(repo, bodyMetrics)
	ctx := context.Background()

	summary, err := svc.GetSummary(ctx, "u1", "week", 2000, 5)
	require.NoError(t, err)
	assert.Equal(t, "week", summary.Range)
	assert.Equal(t, 500.0, summary.TotalCalories)
	assert.Equal(t, 7, len(summary.DailyCalories))
}

func TestStatsService_GenerateInsight(t *testing.T) {
	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &mockStatsRepo{
		records: []domain.FoodRecord{
			{UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime},
		},
	}
	bodyMetrics := &mockBodyMetricsProvider{}
	svc := NewStatsService(repo, bodyMetrics)
	ctx := context.Background()

	result, err := svc.GenerateInsight(ctx, "u1", "week", 2000, 5)
	require.NoError(t, err)
	assert.NotEmpty(t, result["analysis_summary"])
}

func TestStatsService_SaveInsight(t *testing.T) {
	repo := &mockStatsRepo{}
	bodyMetrics := &mockBodyMetricsProvider{}
	svc := NewStatsService(repo, bodyMetrics)
	ctx := context.Background()

	err := svc.SaveInsight(ctx, "u1", "Test insight content", "week")
	require.NoError(t, err)
	assert.Len(t, repo.insights, 1)
	assert.Equal(t, "Test insight content", repo.insights[0].Content)
}
