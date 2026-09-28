package service

import (
	"context"
	"os"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Explicit opt-in: real published food queries + real model, synthetic personal
// context, no chat persistence, credit consumption, migration or other DB writes.
type mealHarnessLiveRepo struct {
	StatsRepo
	records []domain.FoodRecord
}

func (r *mealHarnessLiveRepo) GetFoodRecordsForDateRange(_ context.Context, _ string, _, _ time.Time) ([]domain.FoodRecord, error) {
	return r.records, nil
}
func (r *mealHarnessLiveRepo) GetUserProfile(_ context.Context, _ string) (*domain.StatsUserProfile, error) {
	goal := "maintain"
	return &domain.StatsUserProfile{DietGoal: &goal, HealthCondition: map[string]any{"allergies": []string{"花生"}, "diet_preference": []string{"清淡"}}}, nil
}
func (r *mealHarnessLiveRepo) GetExerciseLogsForDateRange(_ context.Context, _ string, _, _ string) ([]domain.ExerciseLog, error) {
	duration := 45
	return []domain.ExerciseLog{{ExerciseDesc: "力量训练", DurationMin: &duration}}, nil
}

func TestMealHarnessLivePersonalizedNearby(t *testing.T) {
	if os.Getenv("FOODLINK_RUN_MEAL_HARNESS_LIVE") != "1" {
		t.Skip("opt in with FOODLINK_RUN_MEAL_HARNESS_LIVE=1")
	}
	cfg, err := config.Load("../../..")
	require.NoError(t, err)
	db, err := database.Open(cfg.Database)
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	defer sqlDB.Close()
	if cfg.Database.Schema != "" {
		require.NoError(t, db.Exec("SET search_path TO "+cfg.Database.Schema).Error)
	}
	var school struct {
		Latitude  float64
		Longitude float64
	}
	query := db.Raw(`SELECT s.latitude,s.longitude FROM schools s WHERE s.name = '清华大学' AND s.status='active' AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL LIMIT 1`).Scan(&school)
	require.NoError(t, query.Error)
	require.NotZero(t, school.Latitude, "real nearby verification requires campus coordinates")
	yesterday := time.Now().AddDate(0, 0, -1)
	repo := &mealHarnessLiveRepo{StatsRepo: healthrepo.NewStatsRepo(db), records: []domain.FoodRecord{{RecordTime: &yesterday, MealType: "lunch", Items: []map[string]any{{"name": "鸡肉饭"}}, TotalCalories: 550, TotalProtein: 30}}}
	svc := NewStatsService(repo, nil, cfg)
	state := &campusDietAgentRunState{RunID: uuid.NewString(), UserID: uuid.Nil.String(), Question: "我刚做完力量训练，今天不吃鸡肉，附近有什么清淡的饭可以选？", Intent: "initial", Location: &domain.DietLocation{Latitude: school.Latitude, Longitude: school.Longitude, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}, Candidates: map[string]DietRecommendationCandidate{}}
	state.Constraints = resolveCampusDietAgentConstraints(nil, nil, state.Question)
	ctx, cancel := context.WithTimeout(context.Background(), 55*time.Second)
	defer cancel()
	result := svc.runCampusDietAgent(ctx, state)
	t.Logf("trace=%+v search_attempted=%t candidates=%d", state.ToolTrace, state.SearchAttempted, len(state.Candidates))
	require.True(t, result.AgentUsed, "fallback=%s answer=%s", result.FallbackReason, result.Answer)
	require.NotEmpty(t, result.Recommendation.Recommendations)
	for _, option := range result.Recommendation.Recommendations {
		require.NotNil(t, option.DistanceKM)
		assert.LessOrEqual(t, *option.DistanceKM, 3.0)
		assert.NotContains(t, option.Title, "鸡肉")
		assert.NotContains(t, option.Title, "花生")
	}
	t.Logf("harness=%s tools=%d recorded_days=%d scope=%s answer=%s", result.Recommendation.HarnessVersion, result.ToolCount, state.PersonalContext.RecordedDays, result.Recommendation.SearchScope, result.Answer)
	for _, option := range result.Recommendation.Recommendations {
		t.Logf("food=%s distance_km=%.2f reason=%s", option.Title, *option.DistanceKM, option.Reason)
	}
}
