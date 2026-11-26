package worker

import (
	"context"
	"encoding/json"
	"testing"

	"food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
	"food_link/backend/internal/foodmeasure"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"

	"github.com/stretchr/testify/require"
)

// 纠错清单里的食物分三类计量：只有克数的识别结果、按毫升/个/份计量且没有克数的食物库条目、
// 自带克数换算的食物库条目。下面的用例按「食物类型 × 操作」覆盖合并这一步。

func measuredNutrients(perBasis map[string]any, factor float64) map[string]any {
	out := map[string]any{}
	for key, value := range perBasis {
		out[key] = round2(value.(float64) * factor)
	}
	if sodium, ok := out["sodium_mg"]; ok {
		out["sodiumMg"] = sodium
	}
	return out
}

func milkMeasurement(amount float64) map[string]any {
	return map[string]any{
		"amount": amount, "unit": "ml", "basis_amount": 100.0, "basis_unit": "ml",
		"nutrients_per_basis": map[string]any{"calories": 78.4, "protein": 3.8, "carbs": 5.5, "fat": 4.6, "calciumMg": 125.0, "sodium_mg": 60.0},
	}
}

func coffeeMeasurement(amount float64) map[string]any {
	return map[string]any{
		"amount": amount, "unit": "g", "basis_amount": 100.0, "basis_unit": "g",
		"nutrients_per_basis": map[string]any{"calories": 357.1, "protein": 35.7, "carbs": 35.7, "fat": 0.0, "sodium_mg": 143.0},
		"unit_conversions":    map[string]any{"g": 1.0, "piece": 95.0},
	}
}

func eggMeasurement(amount float64) map[string]any {
	return map[string]any{
		"amount": amount, "unit": "piece", "basis_amount": 100.0, "basis_unit": "g",
		"nutrients_per_basis": map[string]any{"calories": 144.0, "protein": 12.8, "carbs": 1.3, "fat": 9.6},
		"unit_conversions":    map[string]any{"piece": 55.0},
	}
}

// libraryRow mirrors what the result page sends for a food library item: the
// declared measurement, client-side totals and real grams (0 when unknown).
func libraryRow(id float64, name string, measurement map[string]any, grams float64) map[string]any {
	perBasis := measurement["nutrients_per_basis"].(map[string]any)
	quantity := measurement["amount"].(float64)
	if measurement["unit"] != measurement["basis_unit"] {
		quantity = grams
	}
	nutrients := measuredNutrients(perBasis, quantity/measurement["basis_amount"].(float64))
	return map[string]any{
		"itemId": id, "sourceItemId": id, "name": name, "sourceName": name,
		"measurement": measurement, "nutrients": nutrients,
		"weight": grams, "estimatedWeightGrams": grams, "originalWeightGrams": grams,
		"intakeRatio": 100.0, "intakeGrams": grams,
		"calorie": nutrients["calories"], "protein": nutrients["protein"], "carbs": nutrients["carbs"], "fat": nutrients["fat"],
		"manual_source": "packaged_food", "manual_source_id": "lib-" + name, "manual_source_title": name,
		"nutrition_source": "manual_food_library", "nutrition_source_category": "database",
		"nameEdited": true, "weightEdited": true, "nutritionEdited": true,
	}
}

// previousRow is the same item as the result page puts it into previousResult.
func previousRow(row map[string]any) map[string]any {
	previous := copyAnyMap(row)
	for _, key := range []string{"sourceItemId", "sourceName", "weight", "nameEdited", "weightEdited", "nutritionEdited", "calorie", "protein", "carbs", "fat"} {
		delete(previous, key)
	}
	return previous
}

// untouchedRow is an existing item the user did not edit in the correction list.
func untouchedRow(previous map[string]any) map[string]any {
	row := copyAnyMap(previous)
	row["sourceItemId"], row["sourceName"] = previous["itemId"], previous["name"]
	row["weight"] = previous["estimatedWeightGrams"]
	row["nameEdited"], row["weightEdited"], row["nutritionEdited"] = false, false, false
	return row
}

func deepCopyItems(t *testing.T, items []map[string]any) []map[string]any {
	t.Helper()
	raw, err := json.Marshal(items)
	require.NoError(t, err)
	var out []map[string]any
	require.NoError(t, json.Unmarshal(raw, &out))
	return out
}

func scopedMeasurement(t *testing.T, item map[string]any) map[string]any {
	t.Helper()
	measurement, ok := item["measurement"].(map[string]any)
	require.True(t, ok, "条目应保留计量信息：%v", item)
	return measurement
}

func sushiMeal() []map[string]any {
	return []map[string]any{
		{"itemId": 1.0, "name": "加州卷", "estimatedWeightGrams": 67.8, "intakeRatio": 100.0, "intakeGrams": 67.8, "nutrition_source": "ai_direct",
			"nutrients": map[string]any{"calories": 142.0, "protein": 3.2, "carbs": 21.0, "fat": 5.2}},
		{"itemId": 2.0, "name": "鳗鱼加州卷", "estimatedWeightGrams": 42.2, "intakeRatio": 100.0, "intakeGrams": 42.2, "nutrition_source": "component_library",
			"nutrients": map[string]any{"calories": 58.58, "protein": 3.81, "carbs": 8.39, "fat": 1.16}},
		{"itemId": 3.0, "name": "水煮蛋", "estimatedWeightGrams": 45.0, "intakeRatio": 100.0, "intakeGrams": 45.0, "matched_food_id": "food-egg",
			"nutrients": map[string]any{"calories": 64.8, "protein": 5.76, "carbs": 0.59, "fat": 4.32}},
	}
}

// 线上失败的那次提交：识别出三样食物后，在纠错清单里又从食物库加了一盒牛奶（250 毫升）和 2.8 克速溶咖啡。
func TestResolveScopedCorrectionAcceptsLibraryFoodMeasuredInMillilitres(t *testing.T) {
	previous := sushiMeal()
	correction := []map[string]any{untouchedRow(previous[0]), untouchedRow(previous[1]), untouchedRow(previous[2]),
		libraryRow(1795653748457, "三元 极致有机纯牛奶 250ml", milkMeasurement(250), 0),
		libraryRow(1795653748458, "illy INSTANT CLASSICO CLASSIC ROAST 95g", coffeeMeasurement(2.8), 2.8),
	}
	previousBefore, correctionBefore := deepCopyItems(t, previous), deepCopyItems(t, correction)

	result, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction,
	}, nil)
	require.NoError(t, err, "毫升计量的食物没有克数，不能因此拒绝整次纠错")

	items := extractItems(result["items"])
	require.Len(t, items, 5)
	require.Equal(t, previous, items[:3], "识别出的三样食物保持原值")

	milk := items[3]
	require.Equal(t, "三元 极致有机纯牛奶 250ml", milk["name"])
	require.Equal(t, 250.0, scopedMeasurement(t, milk)["amount"])
	require.Equal(t, "ml", scopedMeasurement(t, milk)["unit"])
	require.Equal(t, 0.0, milk["estimatedWeightGrams"], "毫升不是克，重量字段只放真实克数")
	require.Equal(t, 0.0, milk["intakeGrams"])
	require.EqualValues(t, 100, milk["intakeRatio"])
	require.Equal(t, 196.0, mapFromAny(milk["nutrients"])["calories"])
	require.Equal(t, 312.5, mapFromAny(milk["nutrients"])["calciumMg"])
	require.Equal(t, 150.0, mapFromAny(milk["nutrients"])["sodiumMg"])
	require.Equal(t, "packaged_food", milk["manual_source"])
	require.Equal(t, "manual_food_library", milk["nutrition_source"])
	require.Equal(t, 1795653748457.0, milk["itemId"])

	coffee := items[4]
	require.Equal(t, 2.8, coffee["estimatedWeightGrams"])
	require.Equal(t, 2.8, coffee["intakeGrams"])
	require.Equal(t, 2.8, scopedMeasurement(t, coffee)["amount"])
	require.Equal(t, 10.0, mapFromAny(coffee["nutrients"])["calories"])

	require.NoError(t, analyzeservice.ValidateResolvedNutritionItems(items), "结果还要通过任务完成前的营养校验")
	require.Equal(t, previousBefore, deepCopyItems(t, previous), "不改写原餐")
	require.Equal(t, correctionBefore, deepCopyItems(t, correction), "不改写提交的清单")
}

// 另一位用户每天早上的提交：文字记录的包子改了克数，再从食物库加按个、按克、按毫升计量的三样食物。
func TestResolveScopedCorrectionMergesPieceGramAndMillilitreLibraryFoods(t *testing.T) {
	previous := []map[string]any{{"itemId": 1.0, "name": "素包子", "estimatedWeightGrams": 45.0, "intakeRatio": 100.0, "intakeGrams": 45.0,
		"nutrients": map[string]any{"calories": 90.0, "protein": 3.6, "carbs": 15.3, "fat": 1.8}}}
	bun := untouchedRow(previous[0])
	bun["weight"], bun["weightEdited"] = 42.0, true
	powder := map[string]any{"amount": 20.0, "unit": "g", "basis_amount": 100.0, "basis_unit": "g",
		"nutrients_per_basis": map[string]any{"calories": 450.0, "protein": 16.0, "carbs": 60.0, "fat": 16.0}}
	correction := []map[string]any{bun,
		libraryRow(101, "水煮蛋", eggMeasurement(1), 55),
		libraryRow(102, "雅培肠内营养粉", powder, 20),
		libraryRow(103, "三元 极致有机纯牛奶 250ml", milkMeasurement(250), 0),
	}

	result, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction,
	}, nil)
	require.NoError(t, err)
	items := extractItems(result["items"])
	require.Len(t, items, 4)
	require.Equal(t, 42.0, items[0]["estimatedWeightGrams"])
	require.Equal(t, 84.0, mapFromAny(items[0]["nutrients"])["calories"], "只有克数的食物仍按重量缩放")
	require.Equal(t, 55.0, items[1]["estimatedWeightGrams"], "按个计量且有克数换算的食物带真实克数")
	require.Equal(t, "piece", scopedMeasurement(t, items[1])["unit"])
	require.Equal(t, 79.2, mapFromAny(items[1]["nutrients"])["calories"])
	require.Equal(t, 20.0, items[2]["estimatedWeightGrams"])
	require.Equal(t, 90.0, mapFromAny(items[2]["nutrients"])["calories"])
	require.Equal(t, 0.0, items[3]["estimatedWeightGrams"])
	require.Equal(t, 196.0, mapFromAny(items[3]["nutrients"])["calories"])
	require.NoError(t, analyzeservice.ValidateResolvedNutritionItems(items))
}

func riceAndMilk() ([]map[string]any, []map[string]any) {
	rice := map[string]any{"itemId": 1.0, "name": "米饭", "estimatedWeightGrams": 180.0, "intakeRatio": 100.0, "intakeGrams": 180.0,
		"nutrients": map[string]any{"calories": 234.0, "protein": 4.5, "carbs": 51.0, "fat": 0.5}}
	milk := previousRow(libraryRow(2, "三元 极致有机纯牛奶 250ml", milkMeasurement(250), 0))
	previous := []map[string]any{rice, milk}
	return previous, []map[string]any{untouchedRow(rice), untouchedRow(milk)}
}

func TestResolveScopedCorrectionResizesExistingMillilitreFood(t *testing.T) {
	for name, nutritionEdited := range map[string]bool{"拍照匹配到的包装饮品": false, "之前从食物库加的饮品": true} {
		t.Run(name, func(t *testing.T) {
			previous, correction := riceAndMilk()
			// 结果页改数量时同时换算好营养，克数仍是 0。
			resized := libraryRow(2, "三元 极致有机纯牛奶 250ml", milkMeasurement(200), 0)
			resized["nameEdited"], resized["nutritionEdited"] = false, nutritionEdited
			correction[1] = resized
			previousBefore := deepCopyItems(t, previous)

			result, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
				PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction,
			}, nil)
			require.NoError(t, err)
			items := extractItems(result["items"])
			require.Equal(t, previous[0], items[0], "米饭不变")
			require.Equal(t, 200.0, scopedMeasurement(t, items[1])["amount"], "数量改动要落到计量信息上")
			require.Equal(t, 156.8, mapFromAny(items[1]["nutrients"])["calories"])
			require.Equal(t, 250.0, mapFromAny(items[1]["nutrients"])["calciumMg"])
			require.Equal(t, 0.0, items[1]["estimatedWeightGrams"])
			require.Equal(t, 2.0, items[1]["itemId"])
			require.Equal(t, "manual_food_library", items[1]["nutrition_source"])
			require.Equal(t, previousBefore, deepCopyItems(t, previous), "不改写原餐")
		})
	}
}

func TestResolveScopedCorrectionKeepsUntouchedMillilitreFoodWhileAnotherChanges(t *testing.T) {
	previous, correction := riceAndMilk()
	correction[0]["weight"], correction[0]["weightEdited"] = 150.0, true

	result, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction,
	}, nil)
	require.NoError(t, err, "清单里原有的毫升食物没有克数，也不能挡住其它食物的纠错")
	items := extractItems(result["items"])
	require.Equal(t, 150.0, items[0]["estimatedWeightGrams"])
	require.Equal(t, 195.0, mapFromAny(items[0]["nutrients"])["calories"])
	require.Equal(t, previous[1], items[1], "未改动的牛奶保持原值")
}

// 之前从食物库加的条目，小程序每次提交都带 nutritionEdited=true，即使用户这次没有动它。
func TestResolveScopedCorrectionLeavesUntouchedLibraryFoodIdentical(t *testing.T) {
	previous, correction := riceAndMilk()
	correction[1]["nutritionEdited"] = true
	runner := &Runner{analyze: &fakeWorkerAnalyzeRunner{}}

	_, err := runner.resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction,
	}, nil)
	require.ErrorContains(t, err, "未应用任何更正", "什么都没改的提交不能算作更正成功")

	correction[0]["weight"], correction[0]["weightEdited"] = 150.0, true
	result, err := runner.resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction,
	}, nil)
	require.NoError(t, err)
	require.Equal(t, previous[1], extractItems(result["items"])[1], "没动过的食物库条目保持原值，包括营养来源")
}

func TestResolveScopedCorrectionKeepsUserEditedNutritionOfMeasuredFood(t *testing.T) {
	for name, clientRewroteLabel := range map[string]bool{"小程序同步改写了营养标示": true, "客户端只改了营养数值": false} {
		t.Run(name, func(t *testing.T) {
			previous, correction := riceAndMilk()
			edited := libraryRow(2, "三元 极致有机纯牛奶 250ml", milkMeasurement(250), 0)
			edited["nameEdited"], edited["weightEdited"] = false, false
			nutrients := copyAnyMap(mapFromAny(edited["nutrients"]))
			nutrients["calories"] = 150.0
			edited["nutrients"], edited["calorie"] = nutrients, 150.0
			if clientRewroteLabel {
				measurement := milkMeasurement(250)
				label := copyAnyMap(mapFromAny(measurement["nutrients_per_basis"]))
				label["calories"] = 60.0
				measurement["nutrients_per_basis"] = label
				edited["measurement"] = measurement
			}
			correction[1] = edited

			result, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
				PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction,
			}, nil)
			require.NoError(t, err)
			milk := extractItems(result["items"])[1]
			require.Equal(t, 150.0, mapFromAny(milk["nutrients"])["calories"], "用户填写的热量不能被标示算回旧值")
			require.Equal(t, 150.0, milk["calorie"])
			require.Equal(t, 9.5, mapFromAny(milk["nutrients"])["protein"], "没改的营养保持原值")
			label := mapFromAny(scopedMeasurement(t, milk)["nutrients_per_basis"])
			require.Equal(t, 60.0, label["calories"])
			require.Equal(t, 3.8, label["protein"])
			require.Equal(t, 250.0, scopedMeasurement(t, milk)["amount"])
			require.Equal(t, 78.4, mapFromAny(scopedMeasurement(t, previous[1])["nutrients_per_basis"])["calories"], "不改写原餐")
		})
	}
}

func TestResolveScopedCorrectionDropsLabelWhenEditedRowCarriesNone(t *testing.T) {
	coffee := previousRow(libraryRow(1, "illy INSTANT CLASSICO CLASSIC ROAST 95g", coffeeMeasurement(95), 95))
	row := untouchedRow(coffee)
	delete(row, "measurement")
	row["nutritionEdited"] = true
	row["nutrients"] = map[string]any{"calories": 200.0, "protein": 20.0, "carbs": 20.0, "fat": 2.0}

	result, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": []map[string]any{coffee}}, CorrectionItems: []map[string]any{row},
	}, nil)
	require.NoError(t, err)
	item := extractItems(result["items"])[0]
	require.NotContains(t, item, "measurement", "营养已由用户填写，原来的标示不能留着把它算回去")
	require.Equal(t, 200.0, mapFromAny(item["nutrients"])["calories"])
	require.Equal(t, 95.0, item["estimatedWeightGrams"])
	require.Contains(t, coffee, "measurement", "不改写原餐")
}

// 说明里给出热量（如“牛奶是 180 千卡”）时，热量要同时落到营养标示上。
func TestResolveScopedCorrectionCalorieNoteRewritesMeasuredLabel(t *testing.T) {
	previous, correction := riceAndMilk()
	calories := 180.0

	result, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction,
	}, map[int]correctionContextOverride{1: {Index: 1, Calories: &calories}})
	require.NoError(t, err)
	milk := extractItems(result["items"])[1]
	require.Equal(t, 180.0, mapFromAny(milk["nutrients"])["calories"])
	label := mapFromAny(scopedMeasurement(t, milk)["nutrients_per_basis"])
	require.Equal(t, 72.0, label["calories"])
	require.Equal(t, 3.8, label["protein"], "只改热量，其它标示值不动")
	require.Equal(t, 78.4, mapFromAny(scopedMeasurement(t, previous[1])["nutrients_per_basis"])["calories"], "不改写原餐")
	require.Equal(t, 196.0, mapFromAny(previous[1]["nutrients"])["calories"])
}

func TestApplyScopedMeasurementClearsValuesTheLabelDoesNotDeclare(t *testing.T) {
	cola, ok := foodmeasure.FromAny(map[string]any{"amount": 330.0, "unit": "ml", "basis_amount": 100.0, "basis_unit": "ml",
		"nutrients_per_basis": map[string]any{"calories": 43.0}})
	require.True(t, ok)
	next := map[string]any{"name": "可乐", "weight": 300.0, "calorie": 100.0, "protein": 5.0, "carbs": 30.0, "fat": 2.0,
		"nutrients": map[string]any{"calories": 100.0, "protein": 5.0, "fiber": 3.0, "waterMl": 290.0}}

	require.NoError(t, applyScopedMeasurement(next, cola))
	nutrients := mapFromAny(next["nutrients"])
	require.Equal(t, 141.9, nutrients["calories"])
	require.Equal(t, 0.0, nutrients["protein"], "标示没有的营养素按 0 计")
	require.NotContains(t, nutrients, "fiber", "旧条目的营养不混进来")
	require.Equal(t, 290.0, nutrients["waterMl"], "标示没有水分时沿用原值")
	require.Equal(t, 141.9, next["calorie"])
	require.Equal(t, 0.0, next["protein"])
	require.Equal(t, 0.0, next["carbs"])
	require.Equal(t, 0.0, next["weight"], "毫升没有克数")
	require.Equal(t, 0.0, next["estimatedWeightGrams"])
}

func TestResolveScopedCorrectionResizesGramMeasuredFoodWithItsLabel(t *testing.T) {
	coffee := previousRow(libraryRow(1, "illy INSTANT CLASSICO CLASSIC ROAST 95g", coffeeMeasurement(95), 95))
	// 结果页把 95 克改成 2.8 克：克数和计量数量一起变，没有手改营养。
	resized := libraryRow(1, "illy INSTANT CLASSICO CLASSIC ROAST 95g", coffeeMeasurement(2.8), 2.8)
	resized["nameEdited"], resized["nutritionEdited"] = false, false

	result, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": []map[string]any{coffee}}, CorrectionItems: []map[string]any{resized},
	}, nil)
	require.NoError(t, err)
	item := extractItems(result["items"])[0]
	require.Equal(t, 2.8, item["estimatedWeightGrams"])
	require.Equal(t, 2.8, item["intakeGrams"])
	require.Equal(t, 2.8, scopedMeasurement(t, item)["amount"], "计量数量不能停在旧值，否则结果页会按旧数量重新算回去")
	require.Equal(t, 10.0, mapFromAny(item["nutrients"])["calories"])
}

type renameCaptureRunner struct {
	fakeWorkerAnalyzeRunner
	targets []map[string]any
}

func (r *renameCaptureRunner) ApplyDBFirstToItemsWithPreciseMicronutrients(ctx context.Context, items []map[string]any, _ string) ([]map[string]any, error) {
	for _, item := range items {
		r.targets = append(r.targets, copyAnyMap(item))
		weight, _ := floatFromAny(item["estimatedWeightGrams"])
		// Fixed fixture per 100 g; not a nutritional estimate.
		item["nutrients"] = map[string]any{"calories": round2(weight * 0.5), "protein": round2(weight * 0.01), "carbs": round2(weight * 0.07), "fat": round2(weight * 0.015)}
	}
	return r.ApplyPreciseMicronutrientsToResolvedItems(ctx, items, "")
}

func TestResolveScopedCorrectionRenamedMillilitreFoodIsReestimatedByWeight(t *testing.T) {
	previous, correction := riceAndMilk()
	// 改名后结果页仍带着旧食物的计量信息，营养标记为未手改。
	correction[1]["name"], correction[1]["nameEdited"] = "燕麦奶", true
	analyze := &renameCaptureRunner{}

	result, err := (&Runner{analyze: analyze}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction,
	}, nil)
	require.NoError(t, err)
	require.Len(t, analyze.targets, 1)
	require.Equal(t, "燕麦奶", analyze.targets[0]["name"])
	require.Equal(t, 250.0, analyze.targets[0]["estimatedWeightGrams"], "饮品改名后按 1 毫升约 1 克重新估算")
	item := extractItems(result["items"])[1]
	require.Equal(t, "燕麦奶", item["name"])
	require.NotContains(t, item, "measurement", "旧食物的营养标示不能留在新食物上")
	require.Equal(t, 250.0, item["estimatedWeightGrams"])
	require.Equal(t, 125.0, mapFromAny(item["nutrients"])["calories"])
	require.Equal(t, 2.0, item["itemId"])
}

func TestResolveScopedCorrectionRenamedCountedFoodWithoutMassIsRejectedClearly(t *testing.T) {
	dumpling := map[string]any{"amount": 2.0, "unit": "piece", "basis_amount": 1.0, "basis_unit": "piece",
		"nutrients_per_basis": map[string]any{"calories": 80.0, "protein": 3.0, "carbs": 10.0, "fat": 3.0}}
	previous := []map[string]any{previousRow(libraryRow(1, "自制饺子", dumpling, 0))}
	renamed := untouchedRow(previous[0])
	renamed["name"], renamed["nameEdited"] = "小笼包", true

	_, err := (&Runner{analyze: &renameCaptureRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": previous}, CorrectionItems: []map[string]any{renamed},
	}, nil)
	require.ErrorContains(t, err, "小笼包")
	require.ErrorContains(t, err, "克")
}

func TestResolveScopedCorrectionDetectsAmountChangeOfZeroEnergyDrink(t *testing.T) {
	water := func(amount float64) map[string]any {
		return map[string]any{"amount": amount, "unit": "ml", "basis_amount": 100.0, "basis_unit": "ml",
			"nutrients_per_basis": map[string]any{"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}}
	}
	previous := []map[string]any{previousRow(libraryRow(1, "矿泉水", water(500), 0))}
	resized := libraryRow(1, "矿泉水", water(300), 0)
	resized["nameEdited"], resized["nutritionEdited"] = false, false

	result, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
		PreviousResult: map[string]any{"items": previous}, CorrectionItems: []map[string]any{resized},
	}, nil)
	require.NoError(t, err, "零热量饮品改了数量也是一次有效更正")
	require.Equal(t, 300.0, scopedMeasurement(t, extractItems(result["items"])[0])["amount"])
}

func TestResolveScopedCorrectionNamesTheRowWithoutUsableAmount(t *testing.T) {
	previous, _ := riceAndMilk()
	rice := untouchedRow(previous[0])
	broken := milkMeasurement(250)
	broken["amount"] = -1.0
	cases := map[string]struct {
		row  map[string]any
		want string
	}{
		"没有克数也没有计量信息": {row: map[string]any{"itemId": 9.0, "name": "酸奶", "weight": 0.0}, want: "酸奶"},
		"计量信息无效":      {row: map[string]any{"itemId": 9.0, "name": "酸奶", "weight": 0.0, "measurement": broken}, want: "酸奶"},
		"没有名称":        {row: map[string]any{"itemId": 9.0, "name": " ", "weight": 100.0}, want: "名称"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := (&Runner{analyze: &fakeWorkerAnalyzeRunner{}}).resolveScopedCorrection(context.Background(), "", analyzeservice.AnalyzeInput{
				PreviousResult: map[string]any{"items": previous}, CorrectionItems: []map[string]any{rice, tc.row},
			}, nil)
			require.ErrorContains(t, err, tc.want)
		})
	}
}

// 整条纠错流程（理解说明 → 看图重估 → 合并）：文字记录的包子改克数，同时从食物库加按个、按毫升计量的食物。
// 清单改动由小程序自动写进说明，不需要模型参与。
func TestResolveCorrectionTaskRunsEveryStepForFoodLibraryAdditions(t *testing.T) {
	previous := []map[string]any{{"itemId": 1.0, "name": "素包子", "estimatedWeightGrams": 45.0, "intakeRatio": 100.0, "intakeGrams": 45.0,
		"nutrients": map[string]any{"calories": 90.0, "protein": 3.6, "carbs": 15.3, "fat": 1.8}}}
	bun := untouchedRow(previous[0])
	bun["weight"], bun["weightEdited"] = 42.0, true
	rows := []any{bun, libraryRow(101, "水煮蛋", eggMeasurement(1), 55), libraryRow(102, "三元 极致有机纯牛奶 250ml", milkMeasurement(250), 0)}
	text := "素包子"
	task := &domain.AnalysisTask{ID: "task-correction-library", UserID: "user-1", TaskType: "food_text", TextInput: &text, Payload: map[string]any{
		"additionalContext": "用户在列表中做了以下修改：将\"素包子\"的份量改为42g；新增食物\"水煮蛋\" 1个；新增食物\"三元 极致有机纯牛奶 250ml\" 250ml\n原始文字记录：素包子",
		"previousResult":    map[string]any{"items": []any{previous[0]}},
		"correctionItems":   rows,
	}}
	runner := &Runner{analyze: analyzeservice.NewAnalyzeService(nil, nil, nil)}

	outcome, err := runner.resolveCorrectionTask(context.Background(), task, "", nil)
	require.NoError(t, err)
	require.NotNil(t, outcome)
	items := extractItems(outcome.result["items"])
	require.Len(t, items, 3)
	require.Equal(t, 84.0, mapFromAny(items[0]["nutrients"])["calories"])
	require.Equal(t, 55.0, items[1]["estimatedWeightGrams"])
	require.Equal(t, 0.0, items[2]["estimatedWeightGrams"])
	require.Equal(t, 250.0, scopedMeasurement(t, items[2])["amount"])
	require.Equal(t, 196.0, mapFromAny(items[2]["nutrients"])["calories"])
	require.Empty(t, outcome.disputes)
	require.NoError(t, analyzeservice.ValidateResolvedNutritionItems(items), "任务完成前的营养校验")

	// 结果页按返回的条目保存记录：带计量信息的条目要能通过记录入口的校验。
	raw, err := json.Marshal(items)
	require.NoError(t, err)
	var saved []foodrecorddomain.FoodItem
	require.NoError(t, json.Unmarshal(raw, &saved))
	for index := range saved {
		saved[index].Ratio = 100
		if saved[index].Measurement == nil {
			saved[index].Weight, _ = floatFromAny(items[index]["estimatedWeightGrams"])
		}
	}
	require.NoError(t, foodrecorddomain.ValidateFoodItemsForRecording(saved))

	noRows, err := runner.resolveCorrectionTask(context.Background(), &domain.AnalysisTask{Payload: map[string]any{}}, "", nil)
	require.NoError(t, err)
	require.Nil(t, noRows, "没有纠错清单的任务不走这条流程")
}

func TestReestimateCorrectionWritesMillilitreAmountNotGrams(t *testing.T) {
	previous, correction := riceAndMilk()
	correction[1][analyzeservice.CorrectionReestimateWeightKey] = true
	correction[1][analyzeservice.CorrectionHintKey] = "牛奶只喝了一半"
	analyze := &reestimateRunner{result: map[string]any{"items": []any{map[string]any{"index": 1.0, "weight_grams": 120.0}}}}
	runner := &Runner{analyze: analyze}
	input := analyzeservice.AnalyzeInput{ImageURLs: []string{"https://img.example/meal.jpg"}, PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction}

	items, _, err := runner.reestimateCorrectionItems(context.Background(), input, "")
	require.NoError(t, err)
	require.Contains(t, analyze.prompt, "当前 250毫升", "模型要看到真实数量和单位，而不是 0g")
	require.Contains(t, analyze.prompt, "当前 180g")
	require.Contains(t, analyze.prompt, "单位：毫升")
	require.Equal(t, 120.0, scopedMeasurement(t, items[1])["amount"])
	require.Equal(t, 0.0, items[1]["weight"], "毫升数不能写进克数字段")
	require.Equal(t, 250.0, scopedMeasurement(t, correction[1])["amount"], "不改写输入")

	input.CorrectionItems = items
	result, err := runner.resolveScopedCorrection(context.Background(), "", input, nil)
	require.NoError(t, err)
	out := extractItems(result["items"])
	require.Equal(t, 120.0, scopedMeasurement(t, out[1])["amount"])
	require.Equal(t, 94.08, mapFromAny(out[1]["nutrients"])["calories"])
	require.Equal(t, previous[0], out[0])
}

func TestReestimateCorrectionDisputedNutritionOfMillilitreFoodRewritesItsLabel(t *testing.T) {
	previous, correction := riceAndMilk()
	correction[1][analyzeservice.CorrectionDisputeNutritionKey] = true
	correction[1][analyzeservice.CorrectionHintKey] = "这是脱脂的"
	analyze := &reestimateRunner{result: map[string]any{"items": []any{map[string]any{"index": 1.0, "protein": 8.5, "carbs": 12.5, "fat": 0.5}}}}
	runner := &Runner{analyze: analyze}
	input := analyzeservice.AnalyzeInput{ImageURLs: []string{"https://img.example/meal.jpg"}, PreviousResult: map[string]any{"items": previous}, CorrectionItems: correction}

	items, disputes, err := runner.reestimateCorrectionItems(context.Background(), input, "")
	require.NoError(t, err)
	require.Len(t, disputes, 1)
	require.Equal(t, 88.5, mapFromAny(items[1]["nutrients"])["calories"], "8.5*4+12.5*4+0.5*9")
	require.Equal(t, 312.5, mapFromAny(items[1]["nutrients"])["calciumMg"], "微量营养沿用原记录")

	input.CorrectionItems = items
	result, err := runner.resolveScopedCorrection(context.Background(), "", input, nil)
	require.NoError(t, err)
	milk := extractItems(result["items"])[1]
	require.Equal(t, 88.5, mapFromAny(milk["nutrients"])["calories"])
	require.Equal(t, 0.5, mapFromAny(milk["nutrients"])["fat"])
	measurement := scopedMeasurement(t, milk)
	require.Equal(t, 250.0, measurement["amount"])
	require.Equal(t, 35.4, mapFromAny(measurement["nutrients_per_basis"])["calories"], "结果页按计量信息重算营养，标示值要跟着改")
	require.Equal(t, 78.4, mapFromAny(scopedMeasurement(t, previous[1])["nutrients_per_basis"])["calories"], "不改写原餐")
}
