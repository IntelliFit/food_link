package service

import (
	"testing"

	analyzedomain "food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/foodrecord/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// guobaExtract 复现 2026-11-16 无糖黄金锅巴任务：散装小包没印净含量，其余都识别到了。
func guobaExtract() *PackagedProductExtractResult {
	return &PackagedProductExtractResult{
		Brand:            "可可买",
		ProductName:      "无糖黄金锅巴",
		ConversionStatus: "converted",
		UnitNutritionPer100g: map[string]any{
			"calories": 581.2619502868068,
			"protein":  7.0,
			"carbs":    71.5,
			"fat":      20.1,
			"sodiumMg": 293.0,
		},
		MissingFields:   []string{"net_content", "net_weight_g"},
		SourceImageURLs: []string{"https://cdn.example.com/front.jpg", "https://cdn.example.com/back.jpg"},
		AutoIngestResult: PackagedAutoIngestResult{
			Status:        "blocked",
			Reason:        "missing_net_content",
			MissingFields: []string{"net_content", "net_weight_g"},
		},
	}
}

func guobaSupplement() PackagedFoodInput {
	return PackagedFoodInput{
		Brand:           "可可买",
		ProductName:     "无糖黄金锅巴",
		NetWeightG:      48,
		ServingWeightG:  48,
		KcalPer100g:     581.3,
		ProteinPer100g:  7,
		CarbsPer100g:    71.5,
		FatPer100g:      20.1,
		SourceImageURLs: []string{"https://cdn.example.com/front.jpg"},
	}
}

func TestPlanPackagedSupplementPassesWhenOnlyNetWeightAdded(t *testing.T) {
	extracted := guobaExtract()

	plan := planPackagedSupplement(extracted, guobaSupplement())

	assert.Equal(t, "", plan.BlockReason)
	assert.Equal(t, []string{"net_weight_g"}, plan.FilledFields)
	assert.Empty(t, plan.EditedFields)
	assert.Equal(t, 48.0, plan.Merged.NetWeightG)
	assert.Equal(t, 48.0, plan.Merged.NetContentValue)
	assert.Equal(t, "g", plan.Merged.NetContentUnit)
	assert.Equal(t, "48g", plan.Merged.SpecText)
	assert.Empty(t, plan.Merged.MissingFields)
	// 原识别结果不能被改动。
	assert.Equal(t, 0.0, extracted.NetWeightG)
	assert.Equal(t, []string{"net_content", "net_weight_g"}, extracted.MissingFields)
}

func TestPlanPackagedSupplementSendsEditedNutritionToReview(t *testing.T) {
	input := guobaSupplement()
	input.KcalPer100g = 380

	plan := planPackagedSupplement(guobaExtract(), input)

	assert.Equal(t, "edited_recognized_fields", plan.BlockReason)
	assert.Equal(t, []string{"kcal_per_100g"}, plan.EditedFields)
}

func TestPlanPackagedSupplementSendsRenamedProductToReview(t *testing.T) {
	input := guobaSupplement()
	input.ProductName = "黄金锅巴（原味）"

	plan := planPackagedSupplement(guobaExtract(), input)

	assert.Equal(t, "edited_recognized_fields", plan.BlockReason)
	assert.Contains(t, plan.EditedFields, "product_name")
}

func TestPlanPackagedSupplementIgnoresWhitespaceAndCaseInName(t *testing.T) {
	input := guobaSupplement()
	input.ProductName = " 无糖 黄金锅巴 "

	plan := planPackagedSupplement(guobaExtract(), input)

	assert.Equal(t, "", plan.BlockReason)
}

func TestPlanPackagedSupplementUserFilledNutritionNeedsReview(t *testing.T) {
	extracted := guobaExtract()
	extracted.UnitNutritionPer100g = map[string]any{}
	extracted.ConversionStatus = ""

	plan := planPackagedSupplement(extracted, guobaSupplement())

	assert.Equal(t, "edited_recognized_fields", plan.BlockReason)
	assert.ElementsMatch(t, []string{"kcal_per_100g", "protein_per_100g", "carbs_per_100g", "fat_per_100g"}, plan.EditedFields)
}

func TestPlanPackagedSupplementRejectsImplausibleNetWeight(t *testing.T) {
	input := guobaSupplement()
	input.NetWeightG = 48000
	input.ServingWeightG = 0

	plan := planPackagedSupplement(guobaExtract(), input)

	assert.Equal(t, "net_weight_out_of_range", plan.BlockReason)
}

func TestPlanPackagedSupplementNothingFilledStaysInReview(t *testing.T) {
	input := guobaSupplement()
	input.NetWeightG = 0
	input.ServingWeightG = 0

	plan := planPackagedSupplement(guobaExtract(), input)

	assert.Equal(t, "nothing_supplemented", plan.BlockReason)
}

func TestPlanPackagedSupplementChangedRecognizedNetWeightNeedsReview(t *testing.T) {
	extracted := guobaExtract()
	extracted.NetWeightG = 60
	extracted.NetContentValue = 60
	extracted.NetContentUnit = "g"
	extracted.MissingFields = nil

	plan := planPackagedSupplement(extracted, guobaSupplement())

	assert.Equal(t, "edited_recognized_fields", plan.BlockReason)
	assert.Contains(t, plan.EditedFields, "net_weight_g")
}

func TestPlanPackagedSupplementServingLargerThanPackIsConflict(t *testing.T) {
	input := guobaSupplement()
	input.ServingWeightG = 100

	plan := planPackagedSupplement(guobaExtract(), input)

	assert.Equal(t, "conflict", plan.BlockReason)
}

func TestApplyPackagedSupplementToTaskResultMarksIngested(t *testing.T) {
	plan := planPackagedSupplement(guobaExtract(), guobaSupplement())
	original := map[string]any{
		"packaged_product": map[string]any{"product_name": "无糖黄金锅巴"},
		"nutrition":        map[string]any{"product_name": "无糖黄金锅巴"},
		"reward_result":    map[string]any{"awarded": false},
		"analysis_engine":  "packaged_product_extract_ocr",
	}
	outcome := &PackagedSupplementOutcome{
		Status:         PackagedSupplementStatusIngested,
		Reason:         "passed",
		PackagedFoodID: "food-1",
		UpsertAction:   "created",
		RewardResult:   map[string]any{"awarded": true, "reward_credits": 1},
	}

	next := applyPackagedSupplementToTaskResult(original, plan.Merged, outcome)

	packaged := next["packaged_product"].(map[string]any)
	auto := packaged["auto_ingest_result"].(map[string]any)
	assert.Equal(t, "ingested", auto["status"])
	assert.Equal(t, "food-1", auto["packaged_food_id"])
	assert.Equal(t, "food-1", packaged["packaged_food_id"])
	assert.Equal(t, 48.0, packaged["net_weight_g"])
	assert.Equal(t, packaged, next["nutrition"])
	assert.Equal(t, true, next["reward_result"].(map[string]any)["awarded"])
	assert.Equal(t, "ingested", next["supplement_result"].(map[string]any)["status"])
	assert.Equal(t, "packaged_product_extract_ocr", next["analysis_engine"])
	// 输入 map 不被修改。
	assert.Equal(t, false, original["reward_result"].(map[string]any)["awarded"])
	_, hasSupplement := original["supplement_result"]
	assert.False(t, hasSupplement)
}

func TestApplyPackagedSupplementToTaskResultPendingKeepsRecognition(t *testing.T) {
	plan := planPackagedSupplement(guobaExtract(), guobaSupplement())
	packaged := map[string]any{"auto_ingest_result": map[string]any{"status": "blocked"}}
	original := map[string]any{"packaged_product": packaged}
	outcome := &PackagedSupplementOutcome{
		Status:         PackagedSupplementStatusPendingReview,
		Reason:         "edited_recognized_fields",
		PackagedFoodID: "food-2",
	}

	next := applyPackagedSupplementToTaskResult(original, plan.Merged, outcome)

	assert.Equal(t, packaged, next["packaged_product"])
	supplement := next["supplement_result"].(map[string]any)
	assert.Equal(t, "pending_review", supplement["status"])
	assert.Equal(t, "edited_recognized_fields", supplement["reason"])
}

func TestPackagedExtractFromTaskResult(t *testing.T) {
	extracted, ok := packagedExtractFromTaskResult(map[string]any{
		"packaged_product": map[string]any{
			"product_name":            "无糖黄金锅巴",
			"conversion_status":       "converted",
			"unit_nutrition_per_100g": map[string]any{"calories": 581.26},
			"auto_ingest_result":      map[string]any{"status": "blocked", "reason": "missing_net_content"},
		},
	})
	require.True(t, ok)
	assert.Equal(t, "无糖黄金锅巴", extracted.ProductName)
	assert.Equal(t, "blocked", extracted.AutoIngestResult.Status)

	_, ok = packagedExtractFromTaskResult(map[string]any{})
	assert.False(t, ok)
}

func TestPackagedFoodQualifiesForRewardAfterSupplement(t *testing.T) {
	unit := "g"
	converted := "converted"
	food := &domain.PackagedFood{
		IsActive:         true,
		ProductName:      "无糖黄金锅巴",
		SourceImageURLs:  []string{"https://cdn.example.com/front.jpg"},
		NetContentValue:  48,
		NetContentUnit:   &unit,
		NetWeightG:       48,
		ConversionStatus: &converted,
		KcalPer100g:      581.3,
		ProteinPer100g:   7,
		CarbsPer100g:     71.5,
		FatPer100g:       20.1,
	}
	assert.True(t, PackagedFoodQualifiesForReward(food))

	food.NetWeightG = 0
	assert.False(t, PackagedFoodQualifiesForReward(food))
}

func TestIsSupplementablePackagedTask(t *testing.T) {
	task := &analyzedomain.AnalysisTask{UserID: "u1", TaskType: packagedProductExtractTaskType, Status: "done"}
	assert.True(t, isSupplementablePackagedTask(task, "u1"))
	assert.False(t, isSupplementablePackagedTask(task, "u2"))
	assert.False(t, isSupplementablePackagedTask(task, ""))
	assert.False(t, isSupplementablePackagedTask(nil, "u1"))

	foodTask := *task
	foodTask.TaskType = "food"
	assert.False(t, isSupplementablePackagedTask(&foodTask, "u1"))

	running := *task
	running.Status = "processing"
	assert.False(t, isSupplementablePackagedTask(&running, "u1"))
}
