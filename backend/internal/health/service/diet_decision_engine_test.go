package service

import (
	"encoding/json"
	"os"
	"testing"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type dietDecisionScenarioFixture struct {
	Name    string `json:"name"`
	Context struct {
		Goal            string                              `json:"goal"`
		MealType        string                              `json:"meal_type"`
		Current         DietRecommendationMacro             `json:"current"`
		Targets         DietRecommendationMacro             `json:"targets"`
		Remaining       DietRecommendationMacro             `json:"remaining"`
		Constraints     CampusDietRecommendationConstraints `json:"constraints"`
		Allergies       []string                            `json:"allergies"`
		DietPreferences []string                            `json:"diet_preferences"`
	} `json:"context"`
	Candidates      []domain.DietRecommendationCandidate `json:"candidates"`
	Excluded        []string                             `json:"excluded"`
	MissingEvidence map[string]string                    `json:"missing_evidence"`
	Better          []struct {
		Score string `json:"score"`
		Left  string `json:"left"`
		Right string `json:"right"`
	} `json:"better"`
	PortfolioCount int `json:"portfolio_count"`
}

func TestDietDecisionEngineScenarioSetV1(t *testing.T) {
	raw, err := os.ReadFile("testdata/diet_decision_scenarios_v1.json")
	require.NoError(t, err)
	var scenarios []dietDecisionScenarioFixture
	require.NoError(t, json.Unmarshal(raw, &scenarios))
	require.GreaterOrEqual(t, len(scenarios), 10)

	for _, scenario := range scenarios {
		scenario := scenario
		t.Run(scenario.Name, func(t *testing.T) {
			ctx := dietDecisionContext{
				Goal: scenario.Context.Goal, MealType: scenario.Context.MealType,
				Current: scenario.Context.Current, Targets: scenario.Context.Targets,
				Remaining: scenario.Context.Remaining, Constraints: scenario.Context.Constraints,
				Allergies: scenario.Context.Allergies, DietPreferences: scenario.Context.DietPreferences,
			}
			byID := make(map[string]dietDecisionEvaluation, len(scenario.Candidates))
			for _, candidate := range scenario.Candidates {
				byID[candidate.SourceID] = evaluateDietDecisionCandidate(ctx, candidate)
			}

			for _, sourceID := range scenario.Excluded {
				evaluation, ok := byID[sourceID]
				require.True(t, ok, "缺少预期候选 %s", sourceID)
				assert.False(t, evaluation.Feasible, "候选 %s 应被硬约束排除", sourceID)
			}
			for sourceID, expected := range scenario.MissingEvidence {
				evaluation, ok := byID[sourceID]
				require.True(t, ok, "缺少预期候选 %s", sourceID)
				assert.Contains(t, evaluation.MissingEvidence, expected)
			}
			for _, comparison := range scenario.Better {
				left, leftOK := byID[comparison.Left]
				right, rightOK := byID[comparison.Right]
				require.True(t, leftOK && rightOK, "比较候选不存在")
				assert.Greater(t, dietDecisionFixtureScore(left.Scores, comparison.Score), dietDecisionFixtureScore(right.Scores, comparison.Score))
			}

			portfolio := selectDietDecisionPortfolio(ctx, scenario.Candidates)
			assert.Len(t, portfolio, scenario.PortfolioCount)
			seen := map[string]bool{}
			for _, selection := range portfolio {
				assert.False(t, seen[selection.Eval.Candidate.SourceID], "组合不得重复同一道菜")
				seen[selection.Eval.Candidate.SourceID] = true
				assert.NotEmpty(t, selection.RoleLabel)
				assert.True(t, selection.Eval.Feasible)
			}
		})
	}
}

func TestDietDecisionEngineReturnsThreeStableRoles(t *testing.T) {
	ctx := dietDecisionContext{
		Goal: "fat_loss", MealType: "dinner",
		Targets:   DietRecommendationMacro{Calories: 1800, Protein: 110, Carbs: 190, Fat: 50},
		Remaining: DietRecommendationMacro{Calories: 550, Protein: 40, Carbs: 60, Fat: 12},
	}
	candidates := []DietRecommendationCandidate{
		{Source: "public_food_library", SourceID: "a", Title: "鸡肉饭", Calories: 520, Protein: 42, Carbs: 58, Fat: 12, Price: 18, CanteenName: "一食堂", NutritionBasis: "library_record"},
		{Source: "public_food_library", SourceID: "b", Title: "豆腐饭", Calories: 460, Protein: 25, Carbs: 62, Fat: 10, Price: 10, CanteenName: "宿舍食堂", WindowName: "一号窗口", NutritionBasis: "library_record"},
		{Source: "public_food_library", SourceID: "c", Title: "鱼肉饭", Calories: 540, Protein: 38, Carbs: 60, Fat: 15, Price: 22, CanteenName: "二食堂", NutritionBasis: "library_estimate"},
	}

	portfolio := selectDietDecisionPortfolio(ctx, candidates)
	require.Len(t, portfolio, 3)
	assert.Equal(t, []string{dietDecisionRoleHealth, dietDecisionRoleEasy, dietDecisionRoleBalanced}, []string{
		portfolio[0].Role, portfolio[1].Role, portfolio[2].Role,
	})
}

func TestDietDecisionEngineDoesNotLetExplanationOverrideSelection(t *testing.T) {
	selection := dietDecisionSelection{
		Role: dietDecisionRoleBalanced, RoleLabel: dietDecisionRoleLabel(dietDecisionRoleBalanced),
		Reason: dietDecisionRoleReason(dietDecisionRoleBalanced),
		Eval:   dietDecisionEvaluation{Scores: DietDecisionScorecard{BalancedUtility: 83.4}},
	}
	option := DietRecommendationOption{Reason: "模型只补充这段解释"}
	decorateDietDecisionOption(&option, selection)

	assert.Equal(t, dietDecisionRoleBalanced, option.DecisionRole)
	assert.Equal(t, "综合最优", option.DecisionLabel)
	assert.Equal(t, 83.4, option.DecisionScore)
	assert.Equal(t, "模型只补充这段解释", option.Reason)
}

func dietDecisionFixtureScore(scores DietDecisionScorecard, name string) float64 {
	switch name {
	case "health_fit":
		return scores.HealthFit
	case "adherence":
		return scores.Adherence
	case "confidence":
		return scores.Confidence
	case "risk_penalty":
		return -scores.RiskPenalty
	default:
		return scores.BalancedUtility
	}
}
