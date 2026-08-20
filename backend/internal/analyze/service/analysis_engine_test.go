package service

import (
	"context"
	"testing"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type capturingAnalysisEngineClient struct {
	result  map[string]any
	prompts []string
}

func (c *capturingAnalysisEngineClient) Analyze(_ context.Context, prompt, _ string) (map[string]any, error) {
	c.prompts = append(c.prompts, prompt)
	return c.result, nil
}

func analysisEngineParsedItem(name, state string, calories, protein, carbs, fat float64) map[string]any {
	return map[string]any{
		"items": []any{map[string]any{
			"name": name, "foodState": state, "weightBasis": "as_served", "estimatedWeightGrams": 100.0,
			"nutrients": map[string]any{"calories": calories, "protein": protein, "carbs": carbs, "fat": fat},
		}},
	}
}

func TestNormalizeAnalysisEngineDefaultsByInputAndMode(t *testing.T) {
	assert.Equal(t, analysisEngineAIDirect, normalizeAnalysisEngine("", "standard", true))
	assert.Equal(t, analysisEngineAIDirect, normalizeAnalysisEngine("", "fast", false))
	assert.Equal(t, analysisEngineAIThenDBExact, normalizeAnalysisEngine("", "standard", false))
	assert.Equal(t, analysisEngineDBCandidates, normalizeAnalysisEngine("", "strict", false))
}

func TestTextDirectPromptKeepsWholeSentenceAndUncertaintyContract(t *testing.T) {
	inputText := "150克空气炸锅烘干土豆条，整批只放5克油，生土豆重量未知，成品高度脱水酥脆"
	prompt := buildPrompt(AnalyzeInput{Text: inputText, AnalysisEngine: analysisEngineAIDirect}, nil, defaultExecutionMode)
	assert.Contains(t, prompt, inputText)
	assert.Contains(t, prompt, "整批总用料")
	assert.Contains(t, prompt, "脱水只会浓缩")
	assert.Contains(t, prompt, "uncertaintyNotes")
}

func TestAIDirectKeepsContextualNutritionWithoutStandardFoodLookup(t *testing.T) {
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionResolver(newFakeAnalyzeNutritionResolver())
	resp, err := svc.finalizeAnalyzeResponse(context.Background(), "", analysisEngineParsedItem("白米饭", "cooked", 210, 4, 44, 2), AnalyzeInput{
		Text: "我吃的是加了油的炒饭，不是白米饭", AnalysisEngine: analysisEngineAIDirect,
	}, defaultExecutionMode, "qwen", qwen36FlashModel, 1)
	require.NoError(t, err)
	item := toItems(resp["items"])[0]
	assert.Equal(t, analysisEngineAIDirect, resp["analysis_engine"])
	assert.Equal(t, analysisEngineAIDirect, item["nutrition_source"])
	assert.Nil(t, item["matched_food_id"])
	assert.InDelta(t, 210, numberFromAny(mapFromAny(item["nutrients"])["calories"]), 0.01)
}

func TestAIThenExactDBRejectsSameNameWithDifferentState(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	resolver.rice.FoodState = "cooked"
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionResolver(resolver)
	resp := sApplyExactForTest(svc, analysisEngineParsedItem("白米饭", "dehydrated", 360, 7, 78, 1))
	item := toItems(resp["items"])[0]
	assert.Equal(t, "no_compatible_exact_match", item["db_calibration_status"])
	assert.Nil(t, item["matched_food_id"])
	assert.InDelta(t, 360, numberFromAny(mapFromAny(item["nutrients"])["calories"]), 0.01)
}

func sApplyExactForTest(svc *AnalyzeService, parsed map[string]any) map[string]any {
	resp := buildAnalyzeResponse(parsed, defaultExecutionMode, "qwen", qwen36FlashModel, 1)
	return svc.applyAIThenExactDBNutrition(context.Background(), resp, AnalyzeInput{Text: "完整描述", AnalysisEngine: analysisEngineAIThenDBExact})
}

func TestCandidateGuidedNutritionInjectsFullContextAndCanRejectAllCandidates(t *testing.T) {
	resolver := newFakeAnalyzeNutritionResolver()
	candidate := foodrecorddomain.FoodNutrition{
		ID: "potato-fried", CanonicalName: "油炸薯条", FoodState: "fried", WeightBasis: "cooked",
		PreparationMethod: "deep_fried", KcalPer100g: 312, ProteinPer100g: 3.4, CarbsPer100g: 41, FatPer100g: 15,
	}
	resolver.searchCandidates = map[string][]foodrecordrepo.SearchCandidate{
		"空气炸锅烘干土豆条": {{Food: candidate, MatchSource: "lexical", Score: 0.8}},
	}
	client := &capturingAnalysisEngineClient{result: map[string]any{"items": []any{map[string]any{
		"index": 0, "reuseExisting": false, "selectedCandidateIndex": -1,
		"identityEquivalent": true, "preparationEquivalent": false, "compositionEquivalent": false,
		"nutritionBasisEquivalent": false, "confidence": 0.99, "reason": "用户说明总共5克油且高度脱水，不等同油炸薯条",
	}}}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureNutritionResolver(resolver)
	svc.dashscopeClient = client
	parsed := analysisEngineParsedItem("空气炸锅烘干土豆条", "dehydrated", 310, 5, 50, 10)
	resp := buildAnalyzeResponse(parsed, precisionExecutionMode, "gemini", gemini35FlashModel, 1)
	resp = svc.applyCandidateGuidedNutrition(context.Background(), resp, AnalyzeInput{
		Text:           "150克空气炸锅烘干土豆条，整批只放5克油，生土豆重量未知，成品高度脱水酥脆",
		AnalysisEngine: analysisEngineDBCandidates,
	})
	item := toItems(resp["items"])[0]
	assert.Equal(t, "rejected_ai_kept", item["candidate_review_status"])
	assert.Nil(t, item["matched_food_id"])
	require.Len(t, client.prompts, 1)
	assert.Contains(t, client.prompts[0], "整批只放5克油")
	assert.Contains(t, client.prompts[0], "油炸薯条")
	assert.Contains(t, client.prompts[0], "拒绝候选并保留AI原始估算")
}
