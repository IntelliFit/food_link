package service

import (
	"context"
	"strings"
	"testing"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzerepo "food_link/backend/internal/analyze/repo"
	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/taskqueue"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type recordingCustomFocusQueue struct {
	messages []taskqueue.TaskMessage
}

func (q *recordingCustomFocusQueue) PublishTask(_ context.Context, message taskqueue.TaskMessage) error {
	q.messages = append(q.messages, message)
	return nil
}

func TestParseCustomFocusCardPayload(t *testing.T) {
	comp := buildScreenshotLikeComputation()
	payload, err := parseCustomFocusCardPayload(`{"score":72,"brief":"晚间负担偏重","summary":"睡前餐偏集中。","basis":"晚餐占比44%。","action":"前移一部分到午餐。"}`, comp, "控尿酸")
	require.NoError(t, err)
	assert.Equal(t, buildCustomFocusScoringContext(comp, "控尿酸").Score, payload.Score)
	assert.Equal(t, "晚间负担偏重", payload.Brief)
}

func TestStrengthCustomFocusScoringUsesProteinEnergyAndTrainingEvidence(t *testing.T) {
	weight := 70.0
	comp := &statsComputation{
		StatsRange:        "week",
		RecordedDays:      7,
		AvgCaloriesPerDay: 2100,
		TDEE:              2200,
		TotalProtein:      770,
		User: &domain.StatsUserProfile{
			Weight:          &weight,
			HealthCondition: map[string]any{"routine_type": "23:00 睡，07:00 起"},
		},
		ExerciseSummary: &statsExerciseSummary{
			LoggedDays: 3, SessionCount: 3, TotalDurationMin: 150,
			RecentEntries: []statsExerciseEntry{{Title: "杠铃深蹲"}, {Title: "哑铃卧推"}},
		},
	}

	scoring := buildCustomFocusScoringContext(comp, "力量提升")

	assert.Equal(t, "strength", scoring.Category)
	assert.Equal(t, "high", scoring.Confidence)
	assert.Greater(t, scoring.Score, 80)
	assert.Contains(t, strings.Join(scoring.Evidence, "|"), "g/kg")
	assert.Contains(t, scoring.ScoreReason, "蛋白质30%")
}

func TestSkinCustomFocusScoringReportsMissingWaterAndDirectEvidence(t *testing.T) {
	comp := &statsComputation{
		StatsRange:        "week",
		RecordedDays:      7,
		AvgCaloriesPerDay: 1500,
		TDEE:              2100,
		TotalProtein:      350,
		MicronutrientDaily: map[string]float64{
			"vitaminARaeMcg": 300,
			"vitaminCMg":     35,
			"ironMg":         6,
			"sodiumMg":       3200,
		},
		User: &domain.StatsUserProfile{HealthCondition: map[string]any{}},
	}

	scoring := buildCustomFocusScoringContext(comp, "脸部皮肤")

	assert.Equal(t, "skin", scoring.Category)
	assert.Equal(t, "low", scoring.Confidence)
	assert.Contains(t, strings.Join(scoring.MissingEvidence, "|"), "连续饮水记录")
	assert.Contains(t, strings.Join(scoring.MissingEvidence, "|"), "皮肤照片")
}

func TestFallbackCustomFocusCardPayload(t *testing.T) {
	comp := buildScreenshotLikeComputation()
	payload := fallbackCustomFocusCardPayload(comp, "控尿酸")
	assert.Greater(t, payload.Score, 0)
	assert.Contains(t, payload.Summary, "控尿酸")
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

func TestGenerateCustomFocusCard_UnchangedDataStillConsumesCreditAfterSuccess(t *testing.T) {
	now := time.Now().UTC()
	yesterday := now.Add(-24 * time.Hour)
	repo := &mockStatsRepo{
		user: &domain.StatsUserProfile{
			ID: "u1",
			HealthCondition: map[string]any{
				"custom_health_focuses": []map[string]any{{"id": "f1", "label": "力量提升"}},
			},
		},
		records: []domain.FoodRecord{
			{UserID: "u1", TotalCalories: 1800, TotalProtein: 80, TotalCarbs: 200, TotalFat: 60, RecordTime: &now},
			{UserID: "u1", TotalCalories: 1900, TotalProtein: 90, TotalCarbs: 210, TotalFat: 62, RecordTime: &yesterday},
		},
	}
	guard := &mockStatsCreditGuard{}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})
	svc.ConfigureCreditGuard(guard)

	first, _, err := svc.GenerateCustomFocusCard(context.Background(), "u1", "week", "f1")
	require.NoError(t, err)
	second, _, err := svc.GenerateCustomFocusCard(context.Background(), "u1", "week", "f1")
	require.NoError(t, err)

	assert.Equal(t, first.Score, second.Score)
	assert.Equal(t, 2, guard.consumeCalls)
	require.NotNil(t, second.PreviousScore)
	require.NotNil(t, second.ScoreChange)
	assert.Equal(t, first.Score, *second.PreviousScore)
	assert.Zero(t, *second.ScoreChange)
	assert.Contains(t, second.ChangeReason, "数据快照与上次一致")
}

func TestStartCustomFocusCardGenerationPersistsTaskBeforePublishing(t *testing.T) {
	now := time.Now().UTC()
	yesterday := now.Add(-24 * time.Hour)
	repo := &mockStatsRepo{
		user: &domain.StatsUserProfile{
			ID: "u1",
			HealthCondition: map[string]any{
				"custom_health_focuses": []map[string]any{{"id": "f1", "label": "力量提升"}},
			},
		},
		records: []domain.FoodRecord{
			{UserID: "u1", TotalCalories: 1800, TotalProtein: 80, TotalCarbs: 200, TotalFat: 60, RecordTime: &now},
			{UserID: "u1", TotalCalories: 1900, TotalProtein: 90, TotalCarbs: 210, TotalFat: 62, RecordTime: &yesterday},
		},
	}
	db, err := gorm.Open(sqlite.Open("file:custom-focus-task?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&analyzedomain.AnalysisTask{}))
	tasks := analyzerepo.NewTaskRepo(db)
	queue := &recordingCustomFocusQueue{}
	guard := &mockStatsCreditGuard{}
	svc := NewStatsService(repo, &mockBodyMetricsProvider{})
	svc.ConfigureCreditGuard(guard)
	svc.ConfigureCustomFocusTasks(tasks, queue)

	result, err := svc.StartCustomFocusCardGeneration(context.Background(), "u1", "week", "f1")

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "pending", result.Status)
	require.Len(t, queue.messages, 1)
	assert.Equal(t, result.TaskID, queue.messages[0].TaskID)
	assert.Equal(t, customFocusTaskType, queue.messages[0].TaskType)
	stored, err := tasks.GetTaskByID(context.Background(), result.TaskID)
	require.NoError(t, err)
	require.NotNil(t, stored)
	assert.Equal(t, customFocusTaskType, stored.TaskType)
	assert.Equal(t, "f1", stored.Payload["focus_id"])
	assert.Equal(t, 1, guard.validateCalls)
	assert.Equal(t, 0, guard.consumeCalls)
}

func TestCustomFocusChangeKeepsHistoryWhenScoreDoesNotMove(t *testing.T) {
	previous := &domain.CustomFocusCard{Score: 58, DataFingerprint: "same"}
	scoring := customFocusScoringContext{Score: 58}

	previousScore, delta, reason := customFocusChange(previous, "same", scoring)

	require.NotNil(t, previousScore)
	require.NotNil(t, delta)
	assert.Equal(t, 58, *previousScore)
	assert.Zero(t, *delta)
	assert.Contains(t, reason, "数据快照与上次一致")
	assert.Contains(t, reason, "保持不变")
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
				DataFingerprint: comp.DataFingerprint,
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
	assert.NotEqual(t, computeHealthIndex(comp, "week").OverallScore, idx.OverallScore)
}
