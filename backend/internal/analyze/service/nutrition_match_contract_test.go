package service

import (
	"context"
	"errors"
	"testing"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/stretchr/testify/require"
)

func duckPortionForRegression() map[string]any {
	return map[string]any{
		"name": "卤鸭腿", "estimatedWeightGrams": 95.0, "foodState": "cooked", "weightBasis": "as_served",
		"item_hint":     "去皮后的卤鸭腿可食肉部分（不含皮与骨）",
		"basisEvidence": "已熟制肉类，用户明确说明自己去皮，按去皮后可食部净重计算",
	}
}

func legacyDuckForRegression() foodrecorddomain.FoodNutrition {
	return foodrecorddomain.FoodNutrition{
		ID: "98bfd093-e84f-4045-9070-c37a8c6eb357", CanonicalName: "卤鸭腿", IsActive: true,
		Source: "历史识别记录营养均值", QualityTier: "legacy_curated",
		KcalPer100g: 208.8435, ProteinPer100g: 16.1519, FatPer100g: 15.3878, CarbsPer100g: 1.4172,
	}
}

func contextualDuckUnit() map[string]any {
	unit := zeroUnitNutritionPer100g()
	unit["protein"], unit["fat"], unit["carbs"] = 25.0, 6.0, 1.0
	unit["calories"] = 158.0
	return unit
}

func TestNutritionReuseContractRejectsUnknownAndConflictingStates(t *testing.T) {
	for _, tc := range []struct {
		name, state, basis, foodState, foodBasis, reason string
	}{
		{"raw_for_cooked", "cooked", "as_served", "raw", "raw", "food_state_conflict"},
		{"unknown_item_state", "unknown", "as_served", "raw", "raw", "unknown_item_food_state"},
		{"unknown_item_basis", "cooked", "unknown", "cooked", "cooked", "unknown_item_weight_basis"},
		{"dry_for_hydrated", "hydrated", "as_served", "dry", "dry", "food_state_conflict"},
		{"unknown_state", "cooked", "as_served", "", "as_served", "unknown_food_state"},
		{"unknown_basis", "cooked", "as_served", "cooked", "", "unknown_weight_basis"},
		{"dry_basis_for_wet_food", "cooked", "as_served", "cooked", "dry", "weight_basis_conflict"},
		{"cooked_basis", "cooked", "as_served", "cooked", "cooked", ""},
		{"raw_dry_grain", "dry", "dry", "raw", "dry_raw", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			item := map[string]any{"name": "食物", "foodState": tc.state, "weightBasis": tc.basis}
			food := &foodrecorddomain.FoodNutrition{CanonicalName: "食物", FoodState: tc.foodState, WeightBasis: tc.foodBasis}
			require.Equal(t, tc.reason, nutritionReuseRejection(item, food))
		})
	}
}

func TestNutritionReuseContractRequiresSkinBoneAndCookingEvidence(t *testing.T) {
	food := foodrecorddomain.FoodNutrition{CanonicalName: "卤鸭腿", FoodState: "cooked", WeightBasis: "cooked"}
	item := duckPortionForRegression()
	require.Equal(t, "unknown_skin", nutritionReuseRejection(item, &food))
	food.StateTags = []string{"with_skin", "boneless"}
	require.Equal(t, "skin_conflict", nutritionReuseRejection(item, &food))
	food.StateTags = []string{"skinless", "bone_in"}
	require.Equal(t, "bone_conflict", nutritionReuseRejection(item, &food))
	food.StateTags = []string{"skinless", "boneless"}
	require.Empty(t, nutritionReuseRejection(item, &food))
	food.CanonicalName = "烤鸭腿"
	require.Equal(t, "preparation_conflict", nutritionReuseRejection(item, &food))
	legacy := legacyDuckForRegression()
	require.Equal(t, "unreviewed_historical_average", nutritionReuseRejection(item, &legacy))
}

func TestNutritionReuseContractDoesNotReverseNegatedPortionInstructions(t *testing.T) {
	for _, text := range []string{"不去皮", "未去皮", "不用去皮", "保留皮"} {
		require.Equal(t, "with_skin", nutritionSkinState(text))
	}
	for _, text := range []string{"不去骨", "未去骨", "不用去骨"} {
		require.Equal(t, "bone_in", nutritionBoneState(text))
	}
	require.Equal(t, "skinless", nutritionSkinState("带皮鸭腿，皮不吃"))
	require.Equal(t, "skinless", nutritionSkinState("鸭腿不准备吃皮"))
}

func TestPrecisionNutritionRegressionPreserves95gAndRejectsLegacyDuck(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	resolver.ordinaryFoods["卤鸭腿"] = legacyDuckForRegression()
	fallback := &fakeNutritionFallbackEstimator{rows: map[int]map[string]any{0: contextualDuckUnit()}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionResolver(resolver)
	svc.ConfigureNutritionFallbackEstimator(fallback)
	// Even a model willing to approve a bad candidate must not override the gate.
	client := &capturingAnalysisEngineClient{result: map[string]any{"items": []any{map[string]any{
		"index": 0, "reuseExisting": true, "selectedCandidateIndex": 0, "identityEquivalent": true,
		"preparationEquivalent": true, "compositionEquivalent": true, "nutritionBasisEquivalent": true, "confidence": 1.0,
	}}}}
	svc.dashscopeClient = client
	items, err := svc.ApplyPrecisionNutrition(context.Background(), []map[string]any{duckPortionForRegression()}, AnalyzeInput{
		AnalysisEngine: analysisEngineDBCandidates, AdditionalContext: "鸡汤面加鸭腿自己去皮",
	})
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, 95.0, numberFromAny(items[0]["estimatedWeightGrams"]))
	require.InDelta(t, 23.75, numberFromAny(mapFromAny(items[0]["nutrients"])["protein"]), 0.001)
	require.Nil(t, items[0]["matched_food_id"])
	require.Equal(t, "llm_generated", items[0]["nutrition_source_category"])
	require.Equal(t, "unreviewed_historical_average", items[0]["nutrition_match_reason"])
	require.Empty(t, client.prompts)
	require.Contains(t, fallback.candidates[0].BasisEvidence, "不含皮与骨")
	require.Equal(t, "鸡汤面加鸭腿自己去皮", fallback.additionalContext)
}

func TestDBFirstExactMatchCannotBypassPortionContract(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	resolver.ordinaryFoods["卤鸭腿"] = legacyDuckForRegression()
	fallback := &fakeNutritionFallbackEstimator{rows: map[int]map[string]any{0: contextualDuckUnit()}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionResolver(resolver)
	svc.ConfigureNutritionFallbackEstimator(fallback)
	items := svc.ApplyDBFirstToItems(context.Background(), []map[string]any{duckPortionForRegression()}, "鸡汤面加鸭腿自己去皮")
	require.Len(t, items, 1)
	require.InDelta(t, 23.75, numberFromAny(mapFromAny(items[0]["nutrients"])["protein"]), 0.001)
	require.Nil(t, items[0]["matched_food_id"])
	require.Equal(t, false, items[0]["nutrition_persisted"])
	require.Equal(t, "contextual_state_estimate", items[0]["nutrition_persist_skip_reason"])
}

func TestCandidateReviewReceivesPortionAndFullMealContext(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	food := foodrecorddomain.FoodNutrition{
		ID: "verified-duck", CanonicalName: "去皮卤鸭腿", FoodState: "cooked", WeightBasis: "cooked", StateTags: []string{"boneless"},
	}
	resolver.searchCandidates = map[string][]foodrecordrepo.SearchCandidate{"卤鸭腿": {{Food: food}}}
	client := &capturingAnalysisEngineClient{result: map[string]any{"items": []any{}}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionResolver(resolver)
	svc.dashscopeClient = client
	item := duckPortionForRegression()
	item["nutrients"] = scaleNutrition(contextualDuckUnit(), 95)
	svc.applyCandidateGuidedNutrition(context.Background(), map[string]any{"items": []map[string]any{item}}, AnalyzeInput{
		Text: "鸡汤面与鸭腿", AdditionalContext: "鸭腿自己去皮，不喝汤",
	})
	require.Len(t, client.prompts, 1)
	require.Contains(t, client.prompts[0], "鸭腿自己去皮，不喝汤")
	require.Contains(t, client.prompts[0], "去皮后的卤鸭腿可食肉部分")
	require.Contains(t, client.prompts[0], "按去皮后可食部净重计算")
}

func TestPrecisionNutritionFailsClosedWhenIndependentEstimateFails(t *testing.T) {
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionFallbackEstimator(&fakeNutritionFallbackEstimator{err: errors.New("unavailable")})
	items, err := svc.ApplyPrecisionNutrition(context.Background(), []map[string]any{duckPortionForRegression()}, AnalyzeInput{AnalysisEngine: analysisEngineDBCandidates})
	require.Error(t, err)
	require.Nil(t, items)
}

func TestPrecisionNutritionRejectsMalformedEstimatesBeforeLibraryReview(t *testing.T) {
	for _, unit := range []map[string]any{
		{"calories": 160.0, "protein": "25g", "carbs": 1.0, "fat": 6.0},
		{"calories": 160.0, "protein": 25.0},
		{"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0},
	} {
		svc := NewAnalyzeService(nil, nil, nil)
		svc.ConfigureNutritionFallbackEstimator(&fakeNutritionFallbackEstimator{rows: map[int]map[string]any{0: unit}})
		items, err := svc.ApplyPrecisionNutrition(context.Background(), []map[string]any{duckPortionForRegression()}, AnalyzeInput{AnalysisEngine: analysisEngineDBCandidates})
		require.Error(t, err)
		require.Nil(t, items)
	}
}

func TestPrecisionNutritionDuckRejectionKeepsOtherCompatibleFood(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	resolver.ordinaryFoods["卤鸭腿"] = legacyDuckForRegression()
	riceUnit := zeroUnitNutritionPer100g()
	riceUnit["calories"], riceUnit["protein"], riceUnit["carbs"], riceUnit["fat"] = 116.7, 2.6, 25.9, 0.3
	fallback := &fakeNutritionFallbackEstimator{rows: map[int]map[string]any{0: contextualDuckUnit(), 1: riceUnit}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionResolver(resolver)
	svc.ConfigureNutritionFallbackEstimator(fallback)
	svc.dashscopeClient = &capturingAnalysisEngineClient{result: map[string]any{"items": []any{map[string]any{
		"index": 1, "reuseExisting": true, "selectedCandidateIndex": 0, "identityEquivalent": true,
		"preparationEquivalent": true, "compositionEquivalent": true, "nutritionBasisEquivalent": true, "confidence": 1.0,
	}}}}
	items, err := svc.ApplyPrecisionNutrition(context.Background(), []map[string]any{
		duckPortionForRegression(),
		{"name": "白米饭", "estimatedWeightGrams": 220.0, "foodState": "cooked", "weightBasis": "as_served"},
	}, AnalyzeInput{AnalysisEngine: analysisEngineDBCandidates, AdditionalContext: "鸭腿去皮，米饭正常食用"})
	require.NoError(t, err)
	require.Len(t, items, 2)
	require.Nil(t, items[0]["matched_food_id"])
	require.Equal(t, "rice-1", items[1]["matched_food_id"])
	require.Equal(t, "accepted", items[1]["nutrition_match_status"])
	require.Equal(t, 220.0, items[1]["estimatedWeightGrams"])
	require.InDelta(t, 5.72, numberFromAny(mapFromAny(items[1]["nutrients"])["protein"]), 0.001)
}
