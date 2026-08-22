package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	petdomain "food_link/backend/internal/pet/domain"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockStatsRepo struct {
	records               []domain.FoodRecord
	exerciseLogs          []domain.ExerciseLog
	user                  *domain.StatsUserProfile
	recordDates           []string
	insights              []domain.StatsInsight
	candidates            []domain.DietRecommendationCandidate
	customFocusCards      []domain.CustomFocusCard
	foodRecordsQueryCount int
}

func TestResolveStatsRangeUTCAtCalendarWeekStartsOnMonday(t *testing.T) {
	now := time.Date(2026, 8, 21, 16, 30, 0, 0, chinaTZ)

	startDate, endDate, startUTC, endUTC := resolveStatsRangeUTCAt("calendar_week", now)

	assert.Equal(t, "2026-08-17", startDate)
	assert.Equal(t, "2026-08-21", endDate)
	assert.Equal(t, "2026-08-16T16:00:00Z", startUTC.Format(time.RFC3339))
	assert.Equal(t, "2026-08-21T16:00:00Z", endUTC.Format(time.RFC3339))
}

func TestResolveStatsRangeUTCAtCalendarWeekKeepsSundayInCurrentWeek(t *testing.T) {
	now := time.Date(2026, 8, 23, 23, 59, 0, 0, chinaTZ)

	startDate, endDate, startUTC, endUTC := resolveStatsRangeUTCAt("calendar_week", now)

	assert.Equal(t, "2026-08-17", startDate)
	assert.Equal(t, "2026-08-23", endDate)
	assert.Equal(t, 7*24*time.Hour, endUTC.Sub(startUTC))
}

func TestResolveStatsRangeUTCAtWeekRemainsRollingSevenDays(t *testing.T) {
	now := time.Date(2026, 8, 21, 16, 30, 0, 0, chinaTZ)

	startDate, endDate, _, _ := resolveStatsRangeUTCAt("week", now)

	assert.Equal(t, "2026-08-15", startDate)
	assert.Equal(t, "2026-08-21", endDate)
}

func (m *mockStatsRepo) GetFoodRecordsForDateRange(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]domain.FoodRecord, error) {
	m.foodRecordsQueryCount++
	return m.records, nil
}

func (m *mockStatsRepo) GetExerciseLogsForDateRange(ctx context.Context, userID string, startDate, endDate string) ([]domain.ExerciseLog, error) {
	return m.exerciseLogs, nil
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
	for i := range m.insights {
		if m.insights[i].UserID == userID && m.insights[i].RangeType == rangeType && m.insights[i].GeneratedDateString() == generatedDate {
			m.insights[i].DataFingerprint = dataFingerprint
			m.insights[i].InsightText = insightText
			m.insights[i].GenerationCount++
			if m.insights[i].GenerationCount <= 0 {
				m.insights[i].GenerationCount = 1
			}
			return nil
		}
	}
	m.insights = append(m.insights, domain.StatsInsight{
		UserID:          userID,
		RangeType:       rangeType,
		GeneratedDate:   parsedDate,
		DataFingerprint: dataFingerprint,
		InsightText:     insightText,
		GenerationCount: 1,
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
	today := time.Now().In(chinaTZ).Format("2006-01-02")
	var count int64
	for _, insight := range m.insights {
		if insight.UserID != userID || insight.GeneratedDateString() != today {
			continue
		}
		if insight.GenerationCount > 0 {
			count += int64(insight.GenerationCount)
		} else {
			count++
		}
	}
	return count, nil
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

func (m *mockStatsRepo) CreatePetChatSession(ctx context.Context, session domain.PetChatSession) (*domain.PetChatSession, error) {
	return &session, nil
}

func (m *mockStatsRepo) GetPetChatSession(ctx context.Context, userID, sessionID string) (*domain.PetChatSession, error) {
	return &domain.PetChatSession{ID: sessionID, UserID: userID, RangeType: "week", Status: "active"}, nil
}

func (m *mockStatsRepo) GetPetChatSessionMessages(ctx context.Context, userID, sessionID string, limit int) ([]domain.PetChatMessage, error) {
	return nil, nil
}

func (m *mockStatsRepo) ListPetChatSessions(ctx context.Context, userID string, limit int) ([]domain.PetChatSession, error) {
	return nil, nil
}

func (m *mockStatsRepo) GetLatestPetChatSessionWithMessages(ctx context.Context, userID string, limit int) (*domain.PetChatSession, []domain.PetChatMessage, error) {
	return nil, nil, nil
}

func (m *mockStatsRepo) AddPetChatMessage(ctx context.Context, message domain.PetChatMessage) (*domain.PetChatMessage, error) {
	return &message, nil
}

func (m *mockStatsRepo) TouchPetChatSession(ctx context.Context, sessionID, userID, question, answer string, creditsCharged int) error {
	return nil
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
	sourceKeys    []string
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

func (m *mockStatsCreditGuard) ValidateUsageCredits(ctx context.Context, userID string, cost int, label string) (map[string]any, error) {
	m.validateCalls++
	return map[string]any{
		"credit_cost": cost,
		"credit_spend_plan": map[string]any{
			"cost":            cost,
			"system_by_date":  map[string]any{time.Now().In(chinaTZ).Format("2006-01-02"): cost},
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
	m.sourceKeys = append(m.sourceKeys, sourceKey)
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

func TestStatsService_GetCalendarMonthUsesRequestedHistoricalMonth(t *testing.T) {
	tdee := 1850.0
	first := time.Date(2024, 2, 3, 4, 0, 0, 0, time.UTC)
	second := time.Date(2024, 2, 3, 12, 0, 0, 0, time.UTC)
	repo := &mockStatsRepo{
		user: &domain.StatsUserProfile{TDEE: &tdee},
		records: []domain.FoodRecord{
			{UserID: "u1", TotalCalories: 400, RecordTime: &first},
			{UserID: "u1", TotalCalories: 250, RecordTime: &second},
		},
	}

	summary, err := NewStatsService(repo, nil).GetCalendarMonth(context.Background(), "u1", "2024-02", 2000)
	require.NoError(t, err)
	require.Len(t, summary.Days, 29)
	assert.Equal(t, "2024-02-01", summary.StartDate)
	assert.Equal(t, "2024-02-29", summary.EndDate)
	assert.Equal(t, 1850, summary.TDEE)
	assert.Equal(t, CalendarDay{Date: "2024-02-03", Calories: 650, HasRecord: true}, summary.Days[2])
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

func TestStatsService_GenerateInsightIncrementsSameDayGenerationCount(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fmt.Sprintf(`{"choices":[{"message":{"content":"总体结论\n第 %d 次完整 AI 解读，继续关注热量和蛋白质结构。"},"finish_reason":"stop"}]}`, requestCount)))
	}))
	defer server.Close()

	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &mockStatsRepo{
		records: []domain.FoodRecord{
			{UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime},
		},
	}
	guard := &mockStatsCreditGuard{}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{}, &config.Config{
		External: config.ExternalConfig{DeepSeekAPIKey: "test-key"},
	})
	svc.deepSeekBaseURL = server.URL
	svc.ConfigureCreditGuard(guard)

	first, err := svc.GenerateInsight(context.Background(), "u1", "week", 2000, 5)
	require.NoError(t, err)
	second, err := svc.GenerateInsight(context.Background(), "u1", "week", 2000, 5)
	require.NoError(t, err)

	assert.Equal(t, 1, first["analysis_summary_used_today"])
	assert.Equal(t, 2, second["analysis_summary_used_today"])
	require.Len(t, repo.insights, 1)
	assert.Equal(t, 2, repo.insights[0].GenerationCount)
	assert.Equal(t, 2, guard.consumeCalls)
	require.Len(t, guard.sourceKeys, 2)
	assert.NotEqual(t, guard.sourceKeys[0], guard.sourceKeys[1])
}

func TestStatsService_GenerateInsightReturnsErrorWhenDeepSeekFails(t *testing.T) {
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
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Empty(t, repo.insights)
}

func TestStatsInsightUsesDeepSeekV4ProModel(t *testing.T) {
	assert.Equal(t, "deepseek-v4-pro", statsInsightDeepSeekModel)
}

func TestStatsServicePreferredTextLLMUsesQwenBeforeDeepSeek(t *testing.T) {
	svc := NewStatsService(&mockStatsRepo{}, &mockBodyMetricsProvider{}, &config.Config{
		External: config.ExternalConfig{
			DashScopeAPIKey:  "qwen-key",
			DashScopeBaseURL: " https://qwen.example.com/api/v1/ ",
			DeepSeekAPIKey:   "deepseek-key",
			DeepSeekBaseURL:  "https://deepseek.example.com/api/v1",
		},
		AIUsagePricing: config.AIUsagePricingConfig{DefaultTextModel: "deepseek-v4-pro"},
	})

	llm := svc.preferredTextLLM()
	assert.Equal(t, "qwen", llm.Provider)
	assert.Equal(t, "qwen3.6-flash", llm.Model)
	assert.Equal(t, "qwen-key", llm.APIKey)
	assert.Equal(t, "https://qwen.example.com/api/v1", llm.BaseURL)
	assert.Equal(t, "qwen3.6-flash", svc.petChatModel())
}

func TestStatsServiceGenerateInsightUsesPreferredQwenModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		assert.Equal(t, "qwen3.6-flash", body["model"])
		assert.Equal(t, "Bearer qwen-key", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"总体结论\n本期饮食结构稳定，下一步优先补足蛋白质。"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	svc := NewStatsService(&mockStatsRepo{records: []domain.FoodRecord{{
		UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime,
	}}}, &mockBodyMetricsProvider{}, &config.Config{External: config.ExternalConfig{
		DashScopeAPIKey:  "qwen-key",
		DashScopeBaseURL: server.URL,
		DeepSeekAPIKey:   "deepseek-key",
		DeepSeekBaseURL:  "http://127.0.0.1:1",
	}})

	result, err := svc.GenerateInsight(context.Background(), "u1", "week", 2000, 5)
	require.NoError(t, err)
	assert.Contains(t, result["analysis_summary"], "优先补足蛋白质")
}

func TestNewStatsServiceUsesConfiguredDeepSeekBaseURL(t *testing.T) {
	svc := NewStatsService(&mockStatsRepo{}, &mockBodyMetricsProvider{}, &config.Config{
		External: config.ExternalConfig{DeepSeekBaseURL: " https://llm.example.com/api/v1/ "},
	})

	assert.Equal(t, "https://llm.example.com/api/v1", svc.deepSeekChatBaseURL())
}

func TestNewStatsInsightHTTPClientAllowsSlowTLSHandshake(t *testing.T) {
	client := newStatsInsightHTTPClient()
	transport, ok := client.Transport.(*http.Transport)
	require.True(t, ok)
	assert.Equal(t, 30*time.Second, transport.TLSHandshakeTimeout)
	assert.Equal(t, 90*time.Second, client.Timeout)
}

func TestDietRecommendationFallsBackWhenTextModelExceedsBudget(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		case <-time.After(time.Second):
			_, _ = w.Write([]byte(`{"choices":[]}`))
		}
	}))
	defer server.Close()

	previousTimeout := dietRecommendationTimeout
	dietRecommendationTimeout = 20 * time.Millisecond
	t.Cleanup(func() { dietRecommendationTimeout = previousTimeout })

	svc := NewStatsService(&mockStatsRepo{candidates: []domain.DietRecommendationCandidate{{
		Source: "food_nutrition_library", SourceID: "food-1", Title: "鸡胸肉",
		Calories: 120, Protein: 23, Carbs: 1, Fat: 2,
	}}}, &mockBodyMetricsProvider{}, &config.Config{External: config.ExternalConfig{
		DashScopeAPIKey: "qwen-key", DashScopeBaseURL: server.URL,
	}})

	startedAt := time.Now()
	result, err := svc.GenerateDietRecommendation(context.Background(), "u1", DietRecommendationInput{
		Scene: "cook_home", CalorieRemaining: 500,
		MacroGaps: DietRecommendationMacro{Protein: 30, Carbs: 50, Fat: 12},
	})

	require.NoError(t, err)
	assert.Less(t, time.Since(startedAt), 300*time.Millisecond)
	assert.Equal(t, "rule_fallback", result.GeneratedBy)
	require.NotEmpty(t, result.Recommendations)
	assert.Equal(t, "food_nutrition_library", result.Recommendations[0].Source)
}

func TestStatsService_RequestNutritionInsightRetriesTransientUpstreamFailure(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			http.Error(w, `{"error":{"message":"gateway temporarily unavailable"}}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"我们先从明天的一份蛋白质加餐开始。"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	svc := NewStatsService(&mockStatsRepo{}, &mockBodyMetricsProvider{})
	result, err := svc.requestNutritionInsight(context.Background(), server.URL, "test-key", "deepseek-v4-pro", "test prompt", "", statsInsightMaxTokens)

	require.NoError(t, err)
	assert.Equal(t, 2, requestCount)
	assert.Equal(t, "我们先从明天的一份蛋白质加餐开始。", result.Content)
}

func TestStatsService_StreamNutritionInsightRetriesTransientUpstreamFailure(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		assert.Equal(t, true, body["enable_thinking"])
		if requestCount == 1 {
			http.Error(w, `{"error":{"message":"gateway temporarily unavailable"}}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"先补足蛋白质\"},\"finish_reason\":\"\"}]}\n\ndata: [DONE]\n\n"))
	}))
	defer server.Close()

	svc := NewStatsService(&mockStatsRepo{}, &mockBodyMetricsProvider{})
	textChan, err := svc.streamNutritionInsight(context.Background(), server.URL, "test-key", "deepseek-v4-pro", "test prompt", statsInsightMaxTokens, true)
	require.NoError(t, err)

	var content strings.Builder
	for chunk := range textChan {
		content.WriteString(chunk)
	}
	assert.Equal(t, 2, requestCount)
	assert.Equal(t, "先补足蛋白质", content.String())
}

func TestStatsService_GenerateDietRecommendationUsesConfiguredDeepSeekBaseURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/chat/completions", r.URL.Path)
		assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"scene\":\"cook_home\",\"title\":\"轻松补蛋白\",\"summary\":\"优先补足蛋白质\",\"recommendations\":[{\"title\":\"鸡胸肉配米饭\",\"reason\":\"补蛋白且热量可控\",\"calories\":420,\"protein\":38,\"carbs\":48,\"fat\":8,\"items\":[{\"name\":\"鸡胸肉\",\"amount\":\"150g\"}],\"tips\":[],\"alternatives\":[]}] }"}}]}`))
	}))
	defer server.Close()

	svc := NewStatsService(&mockStatsRepo{}, &mockBodyMetricsProvider{}, &config.Config{
		External: config.ExternalConfig{
			DeepSeekAPIKey:  "test-key",
			DeepSeekBaseURL: server.URL + "/",
		},
	})

	result, err := svc.GenerateDietRecommendation(context.Background(), "u1", DietRecommendationInput{
		Scene:            "cook_home",
		CalorieRemaining: 450,
		MacroGaps:        DietRecommendationMacro{Protein: 30, Carbs: 50, Fat: 8},
	})
	require.NoError(t, err)
	assert.NotEqual(t, "rule_fallback", result.GeneratedBy)
	assert.NotEmpty(t, result.Recommendations)
}

func TestStatsInsightRequestsEnoughOutputTokens(t *testing.T) {
	assert.Equal(t, 4096, statsInsightMaxTokens)
}

func TestBuildNutritionInsightPromptForbidsCertifiedIdentityClaims(t *testing.T) {
	prompt := buildNutritionInsightPrompt(&statsComputation{StatsRange: "week", StartDate: "2024-06-10", EndDate: "2024-06-16"})

	assert.NotContains(t, prompt, "你是一位专业的营养师")
	assert.NotContains(t, prompt, "饮食行为研究员。请根据")
	assert.Contains(t, prompt, "严禁自我介绍或身份声明")
	assert.Contains(t, prompt, "全文不得出现“专业营养师”")
}

func TestBuildNutritionInsightPromptIncludesMicronutrientEvidence(t *testing.T) {
	prompt := buildNutritionInsightPrompt(&statsComputation{
		StatsRange:   "week",
		StartDate:    "2024-06-10",
		EndDate:      "2024-06-16",
		RecordedDays: 4,
		MicronutrientDaily: map[string]float64{
			"fiber":          11.5,
			"sodiumMg":       2400,
			"vitaminCMg":     36,
			"vitaminARaeMcg": 280,
		},
	})

	assert.Contains(t, prompt, "微量营养线索")
	assert.Contains(t, prompt, "膳食纤维：11.5 g/记录日")
	assert.Contains(t, prompt, "维生素/矿物质线索")
	assert.Contains(t, prompt, "如果微量营养线索里出现明显偏低或偏高")
}

func TestStatsService_BuildStatsComputationIncludesExerciseSummary(t *testing.T) {
	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	recordedOn1 := time.Date(2024, 6, 15, 0, 0, 0, 0, chinaTZ)
	recordedOn2 := time.Date(2024, 6, 14, 0, 0, 0, 0, chinaTZ)
	duration1 := 45
	duration2 := 30
	calories1 := 320.0
	calories2 := 180.0
	exerciseType1 := "跑步机慢跑"
	exerciseType2 := "胸背力量训练"
	repo := &mockStatsRepo{
		records: []domain.FoodRecord{
			{UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime},
		},
		exerciseLogs: []domain.ExerciseLog{
			{UserID: "u1", ExerciseDesc: "跑步", ExerciseType: &exerciseType1, DurationMin: &duration1, CaloriesBurned: &calories1, RecordedOn: &recordedOn1},
			{UserID: "u1", ExerciseDesc: "力量训练", ExerciseType: &exerciseType2, DurationMin: &duration2, CaloriesBurned: &calories2, RecordedOn: &recordedOn2},
		},
	}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})

	comp, err := svc.buildStatsComputation(context.Background(), "u1", "week", 2000, 0)
	require.NoError(t, err)
	require.NotNil(t, comp.ExerciseSummary)
	assert.Equal(t, 2, comp.ExerciseSummary.SessionCount)
	assert.Equal(t, 2, comp.ExerciseSummary.LoggedDays)
	assert.Equal(t, 75, comp.ExerciseSummary.TotalDurationMin)
	assert.Equal(t, 500.0, comp.ExerciseSummary.TotalCalories)
	require.Len(t, comp.ExerciseSummary.RecentEntries, 2)
	assert.Equal(t, "跑步机慢跑", comp.ExerciseSummary.RecentEntries[0].Title)
	assert.Contains(t, comp.DataFingerprint, "sessions=2")
}

func TestBuildPetChatPromptIncludesExerciseContext(t *testing.T) {
	prompt := buildPetChatPrompt(&statsComputation{
		StatsRange:        "week",
		StartDate:         "2024-06-10",
		EndDate:           "2024-06-16",
		TDEE:              2200,
		RecordedDays:      4,
		AvgCaloriesPerDay: 1850,
		CalSurplusDeficit: -350,
		TotalProtein:      320,
		TotalCarbs:        760,
		TotalFat:          210,
		MacroPercent:      map[string]float64{"protein": 24, "carbs": 50, "fat": 26},
		ByMeal:            map[string]float64{"breakfast": 320, "morning_snack": 0, "lunch": 720, "afternoon_snack": 160, "dinner": 650, "evening_snack": 0},
		RecordedDaily:     []DailyCalories{{Date: "2024-06-13", Calories: 1800}, {Date: "2024-06-14", Calories: 1900}},
		ExerciseSummary: &statsExerciseSummary{
			LoggedDays:       2,
			SessionCount:     3,
			TotalCalories:    780,
			TotalDurationMin: 110,
			RecentEntries: []statsExerciseEntry{
				{Date: "06-14", Title: "胸背力量训练", DurationMin: 50, CaloriesBurned: 280},
				{Date: "06-13", Title: "跑步机慢跑", DurationMin: 40, CaloriesBurned: 320},
			},
		},
	}, "我最近健身状态为什么有点掉", nil)

	assert.Contains(t, prompt, "训练/运动记录")
	assert.Contains(t, prompt, "共记录 3 次训练，分布在 2 天")
	assert.Contains(t, prompt, "06-14 胸背力量训练")
	assert.Contains(t, prompt, "健身、运动表现")
	assert.Contains(t, prompt, "如果有训练日志，也不要编造日志里没有的强度")
}

func TestBuildPetChatPromptRequiresGentleTone(t *testing.T) {
	prompt := buildPetChatPrompt(&statsComputation{
		StatsRange:   "week",
		StartDate:    "2024-06-10",
		EndDate:      "2024-06-16",
		RecordedDays: 2,
		PetCompanion: petChatCompanion{
			Name:        "太极小子",
			Personality: "沉稳专注、表达清楚，重视长期规律",
			Feature:     "重视阴阳平衡、动静结合",
		},
	}, "给我一个明天能执行的小目标", nil)

	assert.Contains(t, prompt, "你的名字：\n太极小子")
	assert.Contains(t, prompt, "沉稳专注、表达清楚")
	assert.Contains(t, prompt, "重视阴阳平衡、动静结合")
	assert.Contains(t, prompt, "长期陪伴用户的伙伴")
	assert.Contains(t, prompt, "关注长期变化")
	assert.Contains(t, prompt, "用户完成目标、数据改善或习惯有进步时")
	assert.Contains(t, prompt, "不要调侃、挖苦、训话、责备")
	assert.Contains(t, prompt, "避免“你这”“坎儿”“别一口气这么猛”")
	assert.Contains(t, prompt, "短问、事实问答或简短追问通常用 80-180 字")
	assert.Contains(t, prompt, "默认不使用标题")
	assert.Contains(t, prompt, "不要模仿历史回复的标题、段落结构、开场白或结尾句")
	assert.Contains(t, prompt, "只有用户在询问怎么做、要求制定计划")
	assert.NotContains(t, prompt, "一句话回应")
	assert.NotContains(t, prompt, "结合记录看")
	assert.NotContains(t, prompt, "明天一起试试")
	assert.Contains(t, prompt, "适合聊天气泡的纯文本")
	assert.Contains(t, prompt, "不要输出 #、*、**、_、反引号")
}

func TestFallbackPetChatAnswerDoesNotForceTomorrowAction(t *testing.T) {
	answer := fallbackPetChatAnswer(&statsComputation{
		StatsRange:        "week",
		RecordedDays:      2,
		AvgCaloriesPerDay: 1200,
		CalSurplusDeficit: -300,
		TotalProtein:      90,
		TotalCarbs:        180,
		TotalFat:          50,
	}, "最近吃得怎么样？")

	assert.NotContains(t, answer, "你问的是")
	assert.NotContains(t, answer, "明天可以先做一个小实验")
	assert.Contains(t, answer, "最近 7 天")
}

func TestPetChatCompanionUsesSelectedBuiltinPetProfile(t *testing.T) {
	pet := &petdomain.UserPet{
		Name:        "华佗",
		Personality: "gentle",
		Meta: map[string]any{
			"builtin_avatar_id": "huatuo-01",
		},
	}

	companion := petChatCompanionFromPet(pet)

	assert.Equal(t, "华佗", companion.Name)
	assert.Contains(t, companion.Personality, "温和细腻")
	assert.Contains(t, companion.Feature, "温和养生")
}

func TestPetChatPersonalityDescriptionMapsEveryStoredValue(t *testing.T) {
	storedValues := []string{"gentle", "energetic", "focused", "snacky", "sporty"}

	for _, value := range storedValues {
		t.Run(value, func(t *testing.T) {
			description := petChatPersonalityDescription(value)
			assert.NotEmpty(t, description)
			assert.NotEqual(t, value, description)
		})
	}
}

func TestSanitizePetChatAnswerTextRemovesMarkdownMarkers(t *testing.T) {
	input := "## 一句话判断\n**蛋白质**略低\n* 明天加一份鸡蛋\n- 训练后补主食\n`不要展示代码样式`"

	result := sanitizePetChatAnswerText(input)

	assert.NotContains(t, result, "*")
	assert.NotContains(t, result, "#")
	assert.NotContains(t, result, "`")
	assert.Contains(t, result, "一句话判断")
	assert.Contains(t, result, "蛋白质略低")
	assert.Contains(t, result, "• 明天加一份鸡蛋")
	assert.Contains(t, result, "• 训练后补主食")
}

func TestStatsService_GenerateInsightRetriesForbiddenIdentityClaim(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		messages, ok := body["messages"].([]any)
		require.True(t, ok)
		require.NotEmpty(t, messages)
		w.Header().Set("Content-Type", "application/json")
		if requestCount == 1 {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"作为一名专业营养师，我建议先看热量结构。"},"finish_reason":"stop"}]}`))
			return
		}
		assert.Len(t, messages, 2)
		feedback, ok := messages[1].(map[string]any)
		require.True(t, ok)
		assert.Contains(t, feedback["content"], "禁用身份措辞")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"总体结论\n本期日均摄入较稳定，需要继续关注蛋白质和餐次结构。"},"finish_reason":"stop"}]}`))
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
	assert.Equal(t, 2, requestCount)
	assert.Contains(t, text, "本期日均摄入较稳定")
	assert.NotContains(t, text, "专业营养师")
	assert.NotContains(t, repo.insights[0].InsightText, "专业营养师")
}

func TestStatsService_GeneratePetChatRetriesHarshTone(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		assert.Equal(t, float64(petChatMaxTokens), body["max_tokens"])
		assert.Equal(t, false, body["enable_thinking"])
		messages, ok := body["messages"].([]any)
		require.True(t, ok)
		require.NotEmpty(t, messages)
		w.Header().Set("Content-Type", "application/json")
		if requestCount == 1 {
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"你这坎儿得过一过，别一口气这么猛。"},"finish_reason":"stop"}]}`))
			return
		}
		assert.Len(t, messages, 2)
		feedback, ok := messages[1].(map[string]any)
		require.True(t, ok)
		assert.Contains(t, feedback["content"], "容易让用户感觉被责备")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"我们先把明天目标放小一点：下午加一份蛋白质点心，再准备一瓶温水慢慢喝。"},"finish_reason":"stop"}]}`))
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

	result, err := svc.GeneratePetChat(context.Background(), "u1", PetChatInput{
		Range:    "week",
		Question: "给我一个明天能执行的小目标",
	})
	require.NoError(t, err)
	assert.Equal(t, 2, requestCount)
	assert.Equal(t, 1, repo.foodRecordsQueryCount)
	assert.Contains(t, result.Answer, "我们先把明天目标放小一点")
	assert.NotContains(t, result.Answer, "你这坎儿")
}

func TestStatsService_GeneratePetChatRetriesTransientUpstreamFailure(t *testing.T) {
	requestCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		if requestCount == 1 {
			http.Error(w, `{"error":{"message":"gateway temporarily unavailable"}}`, http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"我们可以先从明天午餐多加一份蛋白质开始，慢慢调整就好。"},"finish_reason":"stop"}]}`))
	}))
	defer server.Close()

	recordTime := time.Date(2024, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &mockStatsRepo{records: []domain.FoodRecord{{
		UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime,
	}}}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{}, &config.Config{
		External: config.ExternalConfig{DeepSeekAPIKey: "test-key"},
	})
	svc.deepSeekBaseURL = server.URL

	result, err := svc.GeneratePetChat(context.Background(), "u1", PetChatInput{Range: "week", Question: "你好"})

	require.NoError(t, err)
	assert.Equal(t, 2, requestCount)
	assert.Contains(t, result.Answer, "明天午餐")
}

func TestStatsService_GenerateInsightReturnsErrorWhenDeepSeekTruncates(t *testing.T) {
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
	require.Error(t, err)
	assert.Nil(t, result)
	assert.Empty(t, repo.insights)
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
			DataFingerprint: "500_500.0_1_17.6_52.7_29.7_fiber=0.0|sodiumMg=0.0|potassiumMg=0.0|calciumMg=0.0|ironMg=0.0|vitaminARaeMcg=0.0|vitaminCMg=0.0|vitaminDMcg=0.0_profile:none_exercise:none",
			InsightText:     "cached insight",
		}},
	}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})

	summary, err := svc.GetSummary(context.Background(), "u1", "week", 2000, 0)
	require.NoError(t, err)
	assert.Equal(t, "cached insight", summary.AnalysisSummary)
	assert.False(t, summary.AnalysisSummaryNeedsRefresh)
}

func TestStatsService_SanitizeInsightKeepsMarkdownMarkers(t *testing.T) {
	repo := &mockStatsRepo{}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})

	err := svc.SaveInsight(context.Background(), "u1", "## 好的，这是报告\n\n- <u>热量缺口偏大</u>\n- **蛋白质需要关注**\n", "week")
	require.NoError(t, err)
	require.Len(t, repo.insights, 1)
	assert.Equal(t, "## 好的，这是报告\n\n- <u>热量缺口偏大</u>\n- **蛋白质需要关注**", repo.insights[0].InsightText)
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
