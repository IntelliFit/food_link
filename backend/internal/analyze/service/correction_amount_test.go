package service

import (
	"context"
	"encoding/json"
	"testing"

	"food_link/backend/internal/foodmeasure"

	"github.com/stretchr/testify/require"
)

func correctionMilkRow() map[string]any {
	return map[string]any{
		"itemId": 2.0, "name": "三元 极致有机纯牛奶 250ml", "weight": 0.0, "estimatedWeightGrams": 0.0,
		"measurement": map[string]any{
			"amount": 250.0, "unit": "ml", "basis_amount": 100.0, "basis_unit": "ml",
			"nutrients_per_basis": map[string]any{"calories": 78.4, "protein": 3.8, "carbs": 5.5, "fat": 4.6},
		},
		"nutrients": map[string]any{"calories": 196.0, "protein": 9.5, "carbs": 13.75, "fat": 11.5},
	}
}

func correctionEggRow() map[string]any {
	return map[string]any{
		"itemId": 3.0, "name": "水煮蛋", "weight": 55.0, "estimatedWeightGrams": 55.0,
		"measurement": map[string]any{
			"amount": 1.0, "unit": "piece", "basis_amount": 100.0, "basis_unit": "g",
			"nutrients_per_basis": map[string]any{"calories": 144.0}, "unit_conversions": map[string]any{"piece": 55.0},
		},
	}
}

func TestCorrectionItemAmountUsesDeclaredUnit(t *testing.T) {
	cases := []struct {
		name   string
		item   map[string]any
		amount float64
		unit   foodmeasure.Unit
	}{
		{"只有克数", map[string]any{"name": "米饭", "weight": 180.0}, 180, foodmeasure.Gram},
		{"毫升", correctionMilkRow(), 250, foodmeasure.Milliliter},
		{"按个且有克数换算", correctionEggRow(), 1, foodmeasure.Piece},
		{"按克声明", map[string]any{"name": "咖啡粉", "weight": 2.8, "measurement": map[string]any{
			"amount": 2.8, "unit": "g", "basis_amount": 100.0, "basis_unit": "g", "nutrients_per_basis": map[string]any{"calories": 357.1}}}, 2.8, foodmeasure.Gram},
		{"计量信息无效时退回克数", map[string]any{"name": "酸奶", "weight": 120.0, "measurement": map[string]any{"amount": -1.0, "unit": "ml"}}, 120, foodmeasure.Gram},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			amount, unit := CorrectionItemAmount(tc.item)
			require.Equal(t, tc.amount, amount)
			require.Equal(t, tc.unit, unit)
		})
	}
}

func TestSetCorrectionItemAmountKeepsMeasurementAndGramsConsistent(t *testing.T) {
	milk := correctionMilkRow()
	shared := milk["measurement"].(map[string]any)
	SetCorrectionItemAmount(milk, 125)
	require.Equal(t, 125.0, milk["measurement"].(map[string]any)["amount"])
	require.Equal(t, 0.0, milk["weight"], "毫升数不写进克数")
	require.Equal(t, 0.0, milk["estimatedWeightGrams"])
	require.Equal(t, 250.0, shared["amount"], "原计量对象可能与原餐共用，不能原地改写")

	egg := correctionEggRow()
	SetCorrectionItemAmount(egg, 2)
	require.Equal(t, 2.0, egg["measurement"].(map[string]any)["amount"])
	require.Equal(t, 110.0, egg["weight"], "有换算关系时克数跟着数量走")

	rice := map[string]any{"name": "米饭", "weight": 180.0}
	SetCorrectionItemAmount(rice, 150)
	require.Equal(t, 150.0, rice["weight"])
	require.Equal(t, 150.0, rice["estimatedWeightGrams"])
	require.NotContains(t, rice, "measurement")
}

func TestResolveCorrectionInstructionsShowsNativeUnitToModel(t *testing.T) {
	client := &mockLLMClient{result: map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 1.0, "weight_grams": 125.0, "reestimate_weight": true, "hint": "只喝了一半"}}}}
	svc := NewAnalyzeService(nil, nil, nil)
	svc.ConfigureDashScopeLLMClient(client)
	items := []map[string]any{{"itemId": 1.0, "name": "米饭", "weight": 180.0}, correctionMilkRow()}
	before, err := json.Marshal(items)
	require.NoError(t, err)

	resolved, err := svc.ResolveCorrectionInstructions(context.Background(), "", AnalyzeInput{AdditionalContext: "牛奶只喝了一半", CorrectionItems: items})
	require.NoError(t, err)
	require.Contains(t, client.prompt, `"unit":"毫升"`)
	require.Contains(t, client.prompt, `"weight_grams":250`, "模型看到的是 250 毫升，而不是 0 克")
	require.Contains(t, client.prompt, "带 unit 字段的条目不按克计量")
	require.NotContains(t, client.prompt, "78.4", "意图解析不发送营养标示")

	require.Equal(t, items[0], resolved[0], "克数条目不带 unit，也不受影响")
	require.Equal(t, 125.0, resolved[1]["measurement"].(map[string]any)["amount"], "模型按毫升给出的新数量落到计量信息上")
	require.Equal(t, 0.0, resolved[1]["weight"])
	require.Equal(t, true, resolved[1]["weightEdited"])
	require.Equal(t, true, resolved[1][CorrectionReestimateWeightKey])
	after, err := json.Marshal(items)
	require.NoError(t, err)
	require.JSONEq(t, string(before), string(after), "不能修改任务原始输入")
}

func TestCorrectionInstructionPlanLeavesMillilitreAmountWhenModelRepeatsIt(t *testing.T) {
	items := []map[string]any{correctionMilkRow()}
	plan := map[string]any{"needs_clarification": false, "edits": []any{map[string]any{"index": 0.0, "weight_grams": 250.0, "calories": 180.0}}}
	resolved, err := applyCorrectionInstructionPlan(plan, items)
	require.NoError(t, err)
	require.Equal(t, items[0]["measurement"], resolved[0]["measurement"])
	require.NotContains(t, resolved[0], "weightEdited", "数量没变就不算改过分量")
	require.Equal(t, 180.0, resolved[0]["correctionCalories"])
}

func TestValidateResolvedNutritionItemsAcceptsMeasuredFoodWithoutMass(t *testing.T) {
	milk := correctionMilkRow()
	require.NoError(t, ValidateResolvedNutritionItems([]map[string]any{milk}), "毫升计量的食物没有克数，营养校验不能要求重量")

	missingEnergy := correctionMilkRow()
	missingEnergy["nutrients"] = map[string]any{"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}
	require.ErrorContains(t, ValidateResolvedNutritionItems([]map[string]any{missingEnergy}), "缺少有效热量")

	water := correctionMilkRow()
	water["name"] = "矿泉水"
	water["nutrients"] = map[string]any{"calories": 0.0}
	require.NoError(t, ValidateResolvedNutritionItems([]map[string]any{water}))

	gramOnly := map[string]any{"name": "酸奶", "estimatedWeightGrams": 0.0, "nutrients": map[string]any{"calories": 90.0}}
	require.ErrorContains(t, ValidateResolvedNutritionItems([]map[string]any{gramOnly}), "重量无效", "只有克数的条目仍必须有重量")

	brokenMeasurement := map[string]any{"name": "酸奶", "estimatedWeightGrams": 100.0, "measurement": map[string]any{"amount": -1.0, "unit": "ml"},
		"nutrients": map[string]any{"calories": 2000.0, "protein": 3.0, "carbs": 10.0, "fat": 3.0}}
	require.ErrorContains(t, ValidateResolvedNutritionItems([]map[string]any{brokenMeasurement}), "热量超过", "计量信息无效的条目仍按克数校验")

	egg := correctionEggRow()
	egg["nutrients"] = map[string]any{"calories": 2000.0, "protein": 7.0, "carbs": 0.7, "fat": 5.3}
	require.ErrorContains(t, ValidateResolvedNutritionItems([]map[string]any{egg}), "热量超过", "有克数换算的计量条目仍按重量校验")
}
