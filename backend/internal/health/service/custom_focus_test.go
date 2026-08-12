package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseCustomFocusCardPayload(t *testing.T) {
	comp := buildScreenshotLikeComputation()
	payload, err := parseCustomFocusCardPayload(`{"score":72,"brief":"晚间负担偏重","summary":"睡前餐偏集中。","basis":"晚餐占比44%。","action":"前移一部分到午餐。"}`, comp, "控尿酸")
	require.NoError(t, err)
	assert.Zero(t, payload.Score)
	assert.Equal(t, "晚间负担偏重", payload.Brief)
}

func TestFallbackCustomFocusCardPayload(t *testing.T) {
	comp := buildScreenshotLikeComputation()
	payload := fallbackCustomFocusCardPayload(comp, "控尿酸")
	assert.Zero(t, payload.Score)
	assert.Contains(t, payload.Summary, "控尿酸")
}

func TestBuildCustomFocusCardPromptUsesDietRecordsOnly(t *testing.T) {
	comp := buildScreenshotLikeComputation()
	comp.User = &domain.StatsUserProfile{HealthCondition: map[string]any{
		"medical_history": "高血压",
		"report_extract":  "血压 160/100",
	}}

	prompt := buildCustomFocusCardPrompt(comp, "控尿酸")

	assert.NotContains(t, prompt, "高血压")
	assert.NotContains(t, prompt, "160/100")
	assert.NotContains(t, prompt, "健康参考卡片")
	assert.Contains(t, prompt, "只根据可观察的饮食记录")
	assert.Contains(t, prompt, "score 固定输出 0")
}

func TestGenerateCustomFocusCard_RequiresEnoughData(t *testing.T) {
	repo := &mockStatsRepo{
		user: &domain.StatsUserProfile{
			ID: "u1",
			HealthCondition: map[string]any{
				"custom_health_focuses": []map[string]any{
					{"id": "f1", "label": "控尿酸", "created_at": "2026-05-26T00:00:00Z"},
				},
			},
		},
	}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})
	_, _, err := svc.GenerateCustomFocusCard(context.Background(), "u1", "week", "f1")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "连续记录")
}

func TestGenerateCustomFocusCard_Success(t *testing.T) {
	recordTime1 := time.Date(2026, 5, 20, 12, 0, 0, 0, time.UTC)
	recordTime2 := time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC)
	repo := &mockStatsRepo{
		user: &domain.StatsUserProfile{
			ID: "u1",
			HealthCondition: map[string]any{
				"custom_health_focuses": []map[string]any{
					{"id": "f1", "label": "控尿酸", "created_at": "2026-05-26T00:00:00Z"},
				},
			},
		},
		records: []domain.FoodRecord{
			{UserID: "u1", MealType: "lunch", TotalCalories: 500, TotalProtein: 20, TotalCarbs: 60, TotalFat: 15, RecordTime: &recordTime1},
			{UserID: "u1", MealType: "dinner", TotalCalories: 600, TotalProtein: 25, TotalCarbs: 70, TotalFat: 20, RecordTime: &recordTime2},
		},
	}
	guard := &mockStatsCreditGuard{}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})
	svc.ConfigureCreditGuard(guard)

	card, meta, err := svc.GenerateCustomFocusCard(context.Background(), "u1", "week", "f1")
	require.NoError(t, err)
	require.NotNil(t, card)
	assert.True(t, card.IsCustom)
	assert.Equal(t, "custom:f1", card.Key)
	assert.Equal(t, "控尿酸", card.Title)
	assert.Equal(t, 1, guard.validateCalls)
	assert.Equal(t, 1, guard.consumeCalls)
	assert.Equal(t, 1, meta["custom_focus_used_today"])
}

func TestAttachCustomRiskCards(t *testing.T) {
	comp := buildScreenshotLikeComputation()
	comp.User = &domain.StatsUserProfile{
		ID: "u1",
		HealthCondition: map[string]any{
			"custom_health_focuses": []map[string]any{
				{"id": "f1", "label": "控尿酸", "created_at": "2026-05-26T00:00:00Z"},
			},
		},
	}
	repo := &mockStatsRepo{
		customFocusCards: []domain.CustomFocusCard{
			{
				UserID:          "u1",
				FocusID:         "f1",
				RangeType:       "week",
				DataFingerprint: customFocusDataFingerprint(comp),
				FocusLabel:      "控尿酸",
				Score:           74,
				Brief:           "趋势尚可",
				Summary:         "总结",
				Basis:           "依据",
				Action:          "行动",
			},
		},
	}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})
	idx := computeHealthIndex(comp, "week")
	err := svc.attachCustomRiskCards(context.Background(), comp, idx)
	require.NoError(t, err)
	require.Len(t, idx.CustomRiskCards, 1)
	assert.Equal(t, "custom:f1", idx.CustomRiskCards[0].Key)
	assert.NotNil(t, idx.CustomFocusMeta)
}

func TestAttachCustomRiskCardsRejectsLegacySemanticCache(t *testing.T) {
	comp := buildScreenshotLikeComputation()
	comp.User = &domain.StatsUserProfile{
		ID: "u1",
		HealthCondition: map[string]any{
			"custom_health_focuses": []map[string]any{
				{"id": "f1", "label": "控尿酸", "created_at": "2026-05-26T00:00:00Z"},
			},
		},
	}
	repo := &mockStatsRepo{customFocusCards: []domain.CustomFocusCard{{
		UserID:          "u1",
		FocusID:         "f1",
		RangeType:       "week",
		DataFingerprint: comp.DataFingerprint,
		FocusLabel:      "控尿酸",
		Score:           74,
		Summary:         "旧健康档案推断内容",
	}}}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})
	idx := computeHealthIndex(comp, "week")

	err := svc.attachCustomRiskCards(context.Background(), comp, idx)

	require.NoError(t, err)
	assert.Empty(t, idx.CustomRiskCards)
}
