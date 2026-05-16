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
	records     []domain.FoodRecord
	user        *domain.StatsUserProfile
	recordDates []string
	insights    []domain.StatsInsight
}

func (m *mockStatsRepo) GetFoodRecordsForDateRange(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]domain.FoodRecord, error) {
	return m.records, nil
}

func (m *mockStatsRepo) GetUserProfile(ctx context.Context, userID string) (*domain.StatsUserProfile, error) {
	return m.user, nil
}

func (m *mockStatsRepo) GetRecentFoodRecordDates(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]string, error) {
	if len(m.recordDates) > 0 {
		return m.recordDates, nil
	}
	days := map[string]bool{}
	for _, record := range m.records {
		if record.RecordTime != nil {
			days[record.RecordTime.In(chinaTZ).Format("2006-01-02")] = true
		}
	}
	out := []string{}
	for date := range days {
		out = append(out, date)
	}
	return out, nil
}

func (m *mockStatsRepo) UpsertInsightCache(ctx context.Context, userID, rangeType, generatedDate, dataFingerprint, insightText string) error {
	parsedDate, _ := time.ParseInLocation("2006-01-02", generatedDate, chinaTZ)
	m.insights = append(m.insights, domain.StatsInsight{
		UserID:          userID,
		RangeType:       rangeType,
		GeneratedDate:   parsedDate,
		DataFingerprint: dataFingerprint,
		InsightText:     insightText,
	})
	return nil
}

func (m *mockStatsRepo) GetCachedInsight(ctx context.Context, userID string, rangeType string, generatedDate string) (*domain.StatsInsight, error) {
	for i := len(m.insights) - 1; i >= 0; i-- {
		if m.insights[i].UserID == userID && m.insights[i].RangeType == rangeType && m.insights[i].GeneratedDateString() == generatedDate {
			return &m.insights[i], nil
		}
	}
	return nil, nil
}

func (m *mockStatsRepo) GetLatestCachedInsight(ctx context.Context, userID string, rangeType string) (*domain.StatsInsight, error) {
	for i := len(m.insights) - 1; i >= 0; i-- {
		if m.insights[i].UserID == userID && m.insights[i].RangeType == rangeType {
			return &m.insights[i], nil
		}
	}
	return nil, nil
}

func (m *mockStatsRepo) CountInsightGenerationsToday(ctx context.Context, userID string) (int64, error) {
	return 0, nil
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
	assert.False(t, summary.AnalysisSummaryNeedsRefresh)
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

func TestStatsInsightUsesDeepSeekV4FlashModel(t *testing.T) {
	assert.Equal(t, "deepseek-v4-flash", statsInsightDeepSeekModel)
}

func TestStatsService_GenerateDietRecommendationFallback(t *testing.T) {
	svc := NewStatsService(&mockStatsRepo{}, &mockBodyMetricsProvider{})
	result, err := svc.GenerateDietRecommendation(context.Background(), "u1", DietRecommendationInput{
		Scene:            "cook_home",
		CalorieRemaining: 450,
		MacroGaps:        DietRecommendationMacro{Protein: 30, Carbs: 50, Fat: 8},
	})
	require.NoError(t, err)
	assert.Equal(t, "cook_home", result.Scene)
	assert.Equal(t, "rule_fallback", result.GeneratedBy)
	assert.NotEmpty(t, result.Recommendations)
	assert.NotEmpty(t, result.Recommendations[0].Items)
}

func TestStatsService_SaveInsight(t *testing.T) {
	repo := &mockStatsRepo{}
	bodyMetrics := &mockBodyMetricsProvider{}
	svc := NewStatsService(repo, bodyMetrics)
	ctx := context.Background()

	err := svc.SaveInsight(ctx, "u1", "Test insight content", "week")
	require.NoError(t, err)
	assert.Len(t, repo.insights, 1)
	assert.Equal(t, "Test insight content", repo.insights[0].InsightText)
	assert.Equal(t, "week", repo.insights[0].RangeType)
	assert.NotEmpty(t, repo.insights[0].DataFingerprint)
}

func TestStatsService_GetSummaryUsesCachedInsightFingerprint(t *testing.T) {
	now := time.Now().In(chinaTZ)
	recordTime := now.Add(-2 * time.Hour).UTC()
	repo := &mockStatsRepo{
		records: []domain.FoodRecord{
			{UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime},
		},
		insights: []domain.StatsInsight{{
			UserID:          "u1",
			RangeType:       "week",
			GeneratedDate:   time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ),
			DataFingerprint: "500_500.0_1_17.6_52.7_29.7_profile:none",
			InsightText:     "cached insight",
		}},
	}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})

	summary, err := svc.GetSummary(context.Background(), "u1", "week", 2000, 0)
	require.NoError(t, err)
	assert.Equal(t, "cached insight", summary.AnalysisSummary)
	assert.False(t, summary.AnalysisSummaryNeedsRefresh)
}

func TestStatsHealthProfileIncludesRoutineLabelAndCustomText(t *testing.T) {
	user := &domain.StatsUserProfile{
		HealthCondition: map[string]any{"routine_type": "regular"},
	}

	text := formatStatsHealthProfile(user, nil)
	assert.Contains(t, text, "作息习惯：标准作息")
	assert.Contains(t, text, "23:00")

	user.HealthCondition["routine_type"] = "00:30 睡，08:30 起"
	text = formatStatsHealthProfile(user, nil)
	assert.Contains(t, text, "作息习惯：00:30 睡，08:30 起")
	assert.Contains(t, statsProfileFingerprint(user), "00:30 睡")
}
