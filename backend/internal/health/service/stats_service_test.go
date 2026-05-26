package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockStatsRepo struct {
	records          []domain.FoodRecord
	user             *domain.StatsUserProfile
	recordDates      []string
	insights         []domain.StatsInsight
	candidates       []domain.DietRecommendationCandidate
	customFocusCards []domain.CustomFocusCard
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

func (m *mockStatsRepo) UpsertCustomFocusCard(ctx context.Context, card domain.CustomFocusCard) error {
	return nil
}

func (m *mockStatsRepo) GetCustomFocusCards(ctx context.Context, userID, rangeType string) ([]domain.CustomFocusCard, error) {
	return m.customFocusCards, nil
}

func (m *mockStatsRepo) GetCustomFocusCard(ctx context.Context, userID, rangeType, focusID string) (*domain.CustomFocusCard, error) {
	return nil, nil
}

func (m *mockStatsRepo) CountCustomFocusGenerationsToday(ctx context.Context, userID string) (int64, error) {
	return 0, nil
}

func (m *mockStatsRepo) CountCustomFocusGenerationsTodayForFocus(ctx context.Context, userID, focusID string) (int64, error) {
	return 0, nil
}

func (m *mockStatsRepo) GetDietRecommendationCandidates(ctx context.Context, userID string, scene string, limit int) ([]domain.DietRecommendationCandidate, error) {
	return m.candidates, nil
}

type mockBodyMetricsProvider struct {
	summary *BodyMetricsSummary
}

func (m *mockBodyMetricsProvider) GetSummary(ctx context.Context, userID string, statsRange string) (*BodyMetricsSummary, error) {
	return m.summary, nil
}

type mockStatsCreditGuard struct {
	validateCalls int
	consumeCalls  int
}

func (m *mockStatsCreditGuard) ValidateExerciseCredits(ctx context.Context, userID, recordedOn string) (map[string]any, error) {
	return map[string]any{}, nil
}

func (m *mockStatsCreditGuard) ValidateDietRecommendationCredits(ctx context.Context, userID string) (map[string]any, error) {
	return map[string]any{}, nil
}

func (m *mockStatsCreditGuard) ValidateStatsInsightCredits(ctx context.Context, userID string) (map[string]any, error) {
	m.validateCalls++
	return map[string]any{
		"credit_cost": 1,
		"credit_spend_plan": map[string]any{
			"cost":            1,
			"system_by_date":  map[string]any{time.Now().In(chinaTZ).Format("2006-01-02"): 1},
			"earned_units":    0,
			"total_available": 8,
		},
	}, nil
}

func (m *mockStatsCreditGuard) ConsumeEarnedCreditsOnTaskCreated(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error {
	return nil
}

func (m *mockStatsCreditGuard) ConsumeEarnedCreditsAfterSuccess(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error {
	m.consumeCalls++
	return nil
}

func (m *mockStatsCreditGuard) RefundEarnedCreditsAfterTaskFailure(ctx context.Context, userID string, creditsInfo map[string]any, cost int, spendReason, spendSourceKey, refundReason, refundSourceKey string, meta map[string]any) error {
	return nil
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

func TestStatsService_GetSummaryHidesCachedInsightWithoutFoodRecords(t *testing.T) {
	now := time.Now().In(chinaTZ)
	repo := &mockStatsRepo{
		insights: []domain.StatsInsight{{
			UserID:          "u1",
			RangeType:       "week",
			GeneratedDate:   time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ),
			DataFingerprint: "old",
			InsightText:     "cached insight from old data",
		}},
	}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})

	summary, err := svc.GetSummary(context.Background(), "u1", "week", 2000, 0)
	require.NoError(t, err)
	assert.Equal(t, 0, summary.RecordedDays)
	assert.Empty(t, summary.AnalysisSummary)
	require.NotNil(t, summary.HealthIndex)
	assert.False(t, summary.HealthIndex.HasEnoughData)
	assert.Empty(t, summary.HealthIndex.RiskCards)
	assert.Empty(t, summary.HealthIndex.ActionList)
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

func TestStatsService_GenerateInsightRequiresFoodRecords(t *testing.T) {
	repo := &mockStatsRepo{}
	guard := &mockStatsCreditGuard{}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})
	svc.ConfigureCreditGuard(guard)

	result, err := svc.GenerateInsight(context.Background(), "u1", "week", 2000, 0)
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Empty(t, repo.insights)
	assert.Equal(t, 0, guard.validateCalls)
	assert.Contains(t, err.Error(), "还没有饮食记录")
}

func TestStatsService_GenerateInsightSavesCacheAndConsumesCredit(t *testing.T) {
	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &mockStatsRepo{
		records: []domain.FoodRecord{
			{UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime},
		},
	}
	guard := &mockStatsCreditGuard{}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})
	svc.ConfigureCreditGuard(guard)

	result, err := svc.GenerateInsight(context.Background(), "u1", "week", 2000, 5)
	require.NoError(t, err)
	assert.NotEmpty(t, result["analysis_summary"])
	assert.Equal(t, statsInsightDailyLimit, result["analysis_summary_daily_limit"])
	assert.Equal(t, 1, result["analysis_summary_used_today"])
	assert.Len(t, repo.insights, 1)
	assert.Equal(t, 1, guard.validateCalls)
	assert.Equal(t, 1, guard.consumeCalls)
}

func TestStatsService_GenerateInsightFallsBackWhenDeepSeekFails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"message":"upstream unavailable"}}`, http.StatusInternalServerError)
	}))
	defer server.Close()

	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &mockStatsRepo{
		records: []domain.FoodRecord{
			{UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime},
		},
	}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{}, &config.Config{
		External: config.ExternalConfig{DeepSeekAPIKey: "test-key"},
	})
	svc.deepSeekBaseURL = server.URL

	result, err := svc.GenerateInsight(context.Background(), "u1", "week", 2000, 5)
	require.NoError(t, err)
	text, _ := result["analysis_summary"].(string)
	assert.NotEmpty(t, text)
	assert.Contains(t, text, "本期日均摄入")
}

func TestStatsInsightUsesDeepSeekV4FlashModel(t *testing.T) {
	assert.Equal(t, "deepseek-v4-flash", statsInsightDeepSeekModel)
}

func TestStatsInsightRequestsEnoughOutputTokens(t *testing.T) {
	assert.Equal(t, 4096, statsInsightMaxTokens)
}

func TestStatsService_GenerateInsightFallsBackWhenDeepSeekTruncates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		assert.Equal(t, float64(statsInsightMaxTokens), body["max_tokens"])
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"一、总体结论\n二、热量\n三、蛋白质"},"finish_reason":"length"}]}`))
	}))
	defer server.Close()

	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &mockStatsRepo{
		records: []domain.FoodRecord{
			{UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime},
		},
	}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{}, &config.Config{
		External: config.ExternalConfig{DeepSeekAPIKey: "test-key"},
	})
	svc.deepSeekBaseURL = server.URL

	result, err := svc.GenerateInsight(context.Background(), "u1", "week", 2000, 5)
	require.NoError(t, err)
	text, _ := result["analysis_summary"].(string)
	assert.Contains(t, text, "本期日均摄入")
	assert.NotContains(t, text, "三、蛋白质")
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

func TestStatsService_GenerateDietRecommendationUsesCandidatesFallback(t *testing.T) {
	repo := &mockStatsRepo{
		candidates: []domain.DietRecommendationCandidate{
			{Source: "public_food_library", SourceID: "p1", Title: "便利店鸡胸饭团", Calories: 380, Protein: 30, Carbs: 45, Fat: 7, Items: []domain.DietRecommendationFoodItem{{Name: "鸡胸肉饭团", Amount: "1份"}}},
			{Source: "user_food_records", SourceID: "r1", Title: "常吃牛肉面", Calories: 430, Protein: 25, Carbs: 58, Fat: 9, Items: []domain.DietRecommendationFoodItem{{Name: "牛肉面", Amount: "半份面"}}},
			{Source: "food_nutrition_library", SourceID: "n1", Title: "北豆腐", Calories: 90, Protein: 8, Carbs: 3, Fat: 5, Items: []domain.DietRecommendationFoodItem{{Name: "北豆腐", Amount: "100g"}}},
			{Source: "food_nutrition_library", SourceID: "n2", Title: "鸡蛋", Calories: 140, Protein: 13, Carbs: 1, Fat: 10, Items: []domain.DietRecommendationFoodItem{{Name: "鸡蛋", Amount: "100g"}}},
			{Source: "food_nutrition_library", SourceID: "n3", Title: "米饭", Calories: 116, Protein: 2.6, Carbs: 25, Fat: 0.3, Items: []domain.DietRecommendationFoodItem{{Name: "米饭", Amount: "100g"}}},
			{Source: "food_nutrition_library", SourceID: "n4", Title: "西兰花", Calories: 34, Protein: 2.8, Carbs: 7, Fat: 0.4, Items: []domain.DietRecommendationFoodItem{{Name: "西兰花", Amount: "100g"}}},
		},
	}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})
	result, err := svc.GenerateDietRecommendation(context.Background(), "u1", DietRecommendationInput{
		Scene:            "eat_out",
		CalorieRemaining: 420,
		MacroGaps:        DietRecommendationMacro{Protein: 30, Carbs: 40, Fat: 6},
	})
	require.NoError(t, err)
	assert.Equal(t, "rule_fallback", result.GeneratedBy)
	assert.Len(t, result.Recommendations, 5)
	assert.NotEmpty(t, result.Recommendations[0].Source)
	assert.NotEmpty(t, result.Recommendations[0].Items[0].Source)
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

func TestStatsService_SanitizeInsightMarkdownMarkers(t *testing.T) {
	repo := &mockStatsRepo{}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})

	err := svc.SaveInsight(context.Background(), "u1", "## 好的，这是报告\n\n**1. 总体结论**\n- **减脂目标明确**\n", "week")
	require.NoError(t, err)
	require.Len(t, repo.insights, 1)
	assert.Equal(t, "好的，这是报告\n\n1. 总体结论\n减脂目标明确", repo.insights[0].InsightText)
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
