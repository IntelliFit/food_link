package service

import (
	"context"
	"os"
	"regexp"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	healthrepo "food_link/backend/internal/health/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/database"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// This opt-in smoke test is read-only: it queries the configured campus food
// library and Qwen, but deliberately bypasses chat persistence and billing.
func TestCampusDietAgentLiveFourTurnTsinghuaConversation(t *testing.T) {
	if os.Getenv("FOODLINK_RUN_CAMPUS_AGENT_LIVE") != "1" {
		t.Skip("set FOODLINK_RUN_CAMPUS_AGENT_LIVE=1 to run the real DB + Qwen smoke test")
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

	repo := healthrepo.NewStatsRepo(db)
	school, err := repo.ResolveDietRecommendationSchool(context.Background(), "清华大学")
	require.NoError(t, err)
	require.NotNil(t, school)
	svc := NewStatsService(repo, nil, cfg)
	userID := uuid.Nil.String()
	allIDs := []string{}
	var active *DietRecommendationResult

	runTurn := func(question string) *CampusDietAgentResult {
		t.Helper()
		intent := campusDietAgentIntent(question, active)
		state := &campusDietAgentRunState{
			RunID: uuid.NewString(), UserID: userID, Question: question,
			Intent: intent, School: domain.DietRecommendationSchool{ID: school.ID, Name: school.Name},
			Constraints:       resolveCampusDietAgentConstraints(nil, active, question),
			ActiveResult:      active,
			ActiveSourceIDs:   recommendationSourceIDsFromResult(active),
			ExcludedSourceIDs: append([]string(nil), allIDs...),
			Candidates:        map[string]DietRecommendationCandidate{},
		}
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		result := svc.runCampusDietAgent(ctx, state)
		require.NotNil(t, result)
		for _, option := range result.Recommendation.Recommendations {
			allIDs = append(allIDs, option.SourceID)
		}
		active = &result.Recommendation
		t.Logf("question=%q intent=%s agent_used=%v fallback=%s foods=%v", question, intent, result.AgentUsed, result.FallbackReason, liveCampusDietFoodSummary(result.Recommendation.Recommendations))
		return result
	}

	first := runTurn("我是清华大学的学生，今天想增肌，推荐一些增肌餐")
	require.Len(t, first.Recommendation.Recommendations, 5)
	assertCampusDietOptionsMatch(t, first.Recommendation.Recommendations, func(option DietRecommendationOption) bool {
		return option.Calories <= 1200
	})
	firstIDs := recommendationSourceIDsFromResult(&first.Recommendation)

	second := runTurn("这些价格太贵了，我需要更便宜的，20元以内最好")
	require.Len(t, second.Recommendation.Recommendations, 5)
	assertCampusDietOptionsMatch(t, second.Recommendation.Recommendations, func(option DietRecommendationOption) bool {
		return option.Price > 0 && option.Price <= 20 && campusDietLiveOptionHasComparableMealPrice(option)
	})
	secondIDs := recommendationSourceIDsFromResult(&second.Recommendation)
	assertNoCampusDietIDOverlap(t, firstIDs, secondIDs)

	third := runTurn("假如我想减脂呢？重新推荐500大卡以下的餐")
	require.Len(t, third.Recommendation.Recommendations, 5)
	assertCampusDietOptionsMatch(t, third.Recommendation.Recommendations, func(option DietRecommendationOption) bool {
		return option.Price > 0 && option.Price <= 20 && option.Calories <= 500 && campusDietLiveOptionHasComparableMealPrice(option)
	})
	thirdIDs := recommendationSourceIDsFromResult(&third.Recommendation)
	assertNoCampusDietIDOverlap(t, secondIDs, thirdIDs)

	fourth := runTurn("换一批，继续保持刚才的条件")
	require.Len(t, fourth.Recommendation.Recommendations, 5)
	assertCampusDietOptionsMatch(t, fourth.Recommendation.Recommendations, func(option DietRecommendationOption) bool {
		return option.Price > 0 && option.Price <= 20 && option.Calories <= 500 && campusDietLiveOptionHasComparableMealPrice(option)
	})
	assertNoCampusDietIDOverlap(t, append(append(firstIDs, secondIDs...), thirdIDs...), recommendationSourceIDsFromResult(&fourth.Recommendation))
}

func campusDietLiveOptionHasComparableMealPrice(option DietRecommendationOption) bool {
	if regexp.MustCompile(`(?i)(两|克|千克|公斤|斤|kg|/g|每|只|个|串|枚|片|粒)`).MatchString(option.PriceUnit) {
		return false
	}
	return !regexp.MustCompile(`(餐盒|打包盒|包装盒|纸袋|塑料袋|餐具|筷子|勺子|吸管|杯盖|餐巾)`).MatchString(option.Title)
}

func liveCampusDietFoodSummary(options []DietRecommendationOption) []map[string]any {
	out := make([]map[string]any, 0, len(options))
	for _, option := range options {
		out = append(out, map[string]any{
			"id": option.SourceID, "name": option.Title,
			"kcal": option.Calories, "price": option.Price, "price_unit": option.PriceUnit,
			"canteen": option.CanteenName, "window": option.WindowName,
		})
	}
	return out
}
