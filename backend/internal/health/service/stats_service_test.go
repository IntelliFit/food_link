package service

import (
	"context"
	"encoding/json"
	"fmt"
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

func (m *mockStatsRepo) GetLatestPetChatSessionWithMessages(ctx context.Context, userID string, limit int) (*domain.PetChatSession, []domain.PetChatMessage, error) {
	return nil, nil, nil
}

func (m *mockStatsRepo) AddPetChatMessage(ctx context.Context, message domain.PetChatMessage) (*domain.PetChatMessage, error) {
	return &message, nil
}

func (m *mockStatsRepo) TouchPetChatSession(ctx context.Context, sessionID, userID, question, answer string, creditsCharged int) error {
	return nil
}

func (m *mockStatsRepo) ListPetChatSessions(ctx context.Context, userID string, limit int) ([]domain.PetChatSession, error) {
	return nil, nil
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

func TestStatsInsightUsesDeepSeekV4FlashModel(t *testing.T) {
	assert.Equal(t, "deepseek-v4-flash", statsInsightDeepSeekModel)
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

func TestBuildPetChatPromptRequiresGentleTone(t *testing.T) {
	prompt := buildPetChatPrompt(&statsComputation{
		StatsRange:   "week",
		StartDate:    "2024-06-10",
		EndDate:      "2024-06-16",
		RecordedDays: 2,
	}, "给我一个明天能执行的小目标", nil)

	assert.Contains(t, prompt, "温和陪伴")
	assert.Contains(t, prompt, "不要调侃、挖苦、训话、责备")
	assert.Contains(t, prompt, "避免“你这”“坎儿”“别一口气这么猛”")
	assert.Contains(t, prompt, "合作式表达")
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
	assert.Contains(t, result.Answer, "我们先把明天目标放小一点")
	assert.NotContains(t, result.Answer, "你这坎儿")
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
