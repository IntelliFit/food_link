package service

import (
	"context"
	"errors"
	"testing"

	foodrecordrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/stretchr/testify/require"
)

type recipeGuardNutritionResolver struct {
	*fakeAnalyzeNutritionResolver
	resolveCalls, candidateCalls int
}

func (r *recipeGuardNutritionResolver) ResolveFood(ctx context.Context, name string) (*foodrecordrepo.ResolveResult, error) {
	r.resolveCalls++
	return r.fakeAnalyzeNutritionResolver.ResolveFood(ctx, name)
}

func (r *recipeGuardNutritionResolver) SearchCandidates(ctx context.Context, name string, limit int) ([]foodrecordrepo.SearchCandidate, error) {
	r.candidateCalls++
	return r.fakeAnalyzeNutritionResolver.SearchCandidates(ctx, name, limit)
}

func TestDBFirstRecipeContractBlocksExactAndCandidateReuse(t *testing.T) {
	for _, tc := range []struct {
		name     string
		metadata map[string]any
	}{
		{name: "composite", metadata: map[string]any{"isComposite": true}},
		{name: "extra_oil", metadata: map[string]any{"addedIngredients": []any{map[string]any{"name": "食用油", "amountGrams": 5.0}}}},
		{name: "multiple_ingredients", metadata: map[string]any{"ingredientCount": 2.0}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resolver := &recipeGuardNutritionResolver{fakeAnalyzeNutritionResolver: newFakeAnalyzeNutritionResolver()}
			candidate := foodrecordrepo.SearchCandidate{Food: resolver.rice, MatchSource: "canonical", Score: 1}
			resolver.searchCandidates = map[string][]foodrecordrepo.SearchCandidate{"白米饭": {candidate}}
			semantic := &fakeNutritionSemanticRetriever{rows: [][]foodrecordrepo.SearchCandidate{{candidate}}}
			client := &capturingAnalysisEngineClient{result: map[string]any{"items": []any{map[string]any{
				"index": 0.0, "reuseExisting": true, "selectedCandidateIndex": 0.0,
				"identityEquivalent": true, "preparationEquivalent": true,
				"compositionEquivalent": true, "nutritionBasisEquivalent": true, "confidence": 1.0,
			}}}}
			unit := zeroUnitNutritionPer100g()
			unit["calories"], unit["protein"], unit["carbs"], unit["fat"] = 153.8, 2.5, 24.7, 5.0
			fallback := &fakeNutritionFallbackEstimator{rows: map[int]map[string]any{0: unit}}
			svc := NewAnalyzeService(nil, nil, nil)
			svc.ConfigureNutritionResolver(resolver)
			svc.ConfigureNutritionSemanticRetriever(semantic)
			svc.ConfigureNutritionFallbackEstimator(fallback)
			svc.dashscopeClient = client
			item := map[string]any{"name": "白米饭", "foodState": "cooked", "weightBasis": "as_served", "estimatedWeightGrams": 105.0}
			for key, value := range tc.metadata {
				item[key] = value
			}
			items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{item}, "100克白米饭加5克食用油，成品105克")
			require.Len(t, items, 1)
			require.Nil(t, items[0]["matched_food_id"])
			require.Equal(t, "contextual_recipe_estimate_required", items[0]["db_calibration_status"])
			// Generated totals close energy after the displayed macro amounts round:
			// 2.63*4 + 25.94*4 + 5.25*9 = 161.53 kcal.
			require.InDelta(t, 161.53, numberFromAny(mapFromAny(items[0]["nutrients"])["calories"]), 0.001)
			require.Equal(t, 0, resolver.resolveCalls)
			require.Equal(t, 0, resolver.candidateCalls)
			require.Empty(t, semantic.queries)
			require.Empty(t, client.prompts)
			require.Equal(t, 1, fallback.calls)
			require.Contains(t, fallback.additionalContext, "5克食用油")
			require.NoError(t, ValidateResolvedNutritionItems(items))
		})
	}
}

func TestDBFirstRecipeContractKeepsOtherExactFoodAndFailsClosed(t *testing.T) {
	for _, failEstimate := range []bool{false, true} {
		resolver := newFakeAnalyzeNutritionResolver()
		unit := zeroUnitNutritionPer100g()
		unit["calories"], unit["protein"], unit["carbs"], unit["fat"] = 153.8, 2.5, 24.7, 5.0
		fallback := &fakeNutritionFallbackEstimator{rows: map[int]map[string]any{0: unit}}
		if failEstimate {
			fallback.rows = nil
			fallback.err = errors.New("unavailable")
		}
		svc := NewAnalyzeService(nil, nil, nil)
		svc.ConfigureNutritionResolver(resolver)
		svc.ConfigureNutritionFallbackEstimator(fallback)
		items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{
			{"name": "白米饭", "foodState": "cooked", "weightBasis": "as_served", "estimatedWeightGrams": 105.0, "isComposite": true},
			{"name": "白米饭", "foodState": "cooked", "weightBasis": "as_served", "estimatedWeightGrams": 220.0},
		}, "第一份加了5克油，第二份为普通白米饭")
		require.Len(t, items, 2)
		require.Nil(t, items[0]["matched_food_id"])
		require.Equal(t, "rice-1", items[1]["matched_food_id"])
		require.Equal(t, 220.0, items[1]["estimatedWeightGrams"])
		require.InDelta(t, 255.2, numberFromAny(mapFromAny(items[1]["nutrients"])["calories"]), 0.001)
		if failEstimate {
			require.Error(t, ValidateResolvedNutritionItems(items), "估算失败不能退回不含油的基础库值")
		} else {
			require.NoError(t, ValidateResolvedNutritionItems(items))
		}
	}
}
