package service

import (
	"context"
	"strings"
	"testing"

	commonerrors "food_link/backend/internal/common/errors"
)

func TestBuildPackagedProductExtractPromptTreatsImagesAsOneProduct(t *testing.T) {
	prompt := buildPackagedProductExtractPrompt("蛋白棒", 3)

	for _, want := range []string{
		"同一个商品的一组照片",
		"不要把多张图拆成多个商品",
		"本次实际有 3 张图片",
		"综合 1-3 张图片",
		"弯曲",
		"大包装",
		"组合装/多口味",
		"raw_label_payload",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestBuildPackagedProductExtractPromptMentionsActualImageCount(t *testing.T) {
	cases := []struct {
		name       string
		imageCount int
		want       string
	}{
		{name: "one image", imageCount: 1, want: "本次实际只有 1 张图片"},
		{name: "two images", imageCount: 2, want: "本次实际有 2 张图片"},
		{name: "three images", imageCount: 3, want: "本次实际有 3 张图片"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			prompt := buildPackagedProductExtractPrompt("", tc.imageCount)
			if !strings.Contains(prompt, tc.want) {
				t.Fatalf("prompt missing %q:\n%s", tc.want, prompt)
			}
		})
	}
}

func TestSubmitPackagedProductExtractTaskValidatesImageCount(t *testing.T) {
	svc := NewFoodNutritionService(nil)
	ctx := context.Background()

	_, err := svc.SubmitPackagedProductExtractTask(ctx, "u1", SubmitPackagedProductExtractInput{})
	if appErr, ok := err.(*commonerrors.AppError); !ok || appErr.HTTPStatus != 400 {
		t.Fatalf("empty images err=%#v want 400 AppError", err)
	}

	_, err = svc.SubmitPackagedProductExtractTask(ctx, "u1", SubmitPackagedProductExtractInput{
		ImageURLs: []string{"1", "2", "3", "4"},
	})
	if appErr, ok := err.(*commonerrors.AppError); !ok || appErr.HTTPStatus != 400 || !strings.Contains(appErr.Message, "最多上传 3 张") {
		t.Fatalf("too many images err=%#v want 400 max images AppError", err)
	}
}

func TestCreatePackagedFoodRejectsMissingSourceImage(t *testing.T) {
	svc := NewFoodNutritionService(nil)
	ctx := context.Background()

	_, err := svc.CreatePackagedFood(ctx, PackagedFoodInput{
		ProductName:    "蛋白棒",
		NetWeightG:     60,
		KcalPer100g:    420,
		ProteinPer100g: 28,
		CarbsPer100g:   42,
		FatPer100g:     14,
	})
	if appErr, ok := err.(*commonerrors.AppError); !ok || appErr.HTTPStatus != 400 || !strings.Contains(appErr.Message, "包装图片") {
		t.Fatalf("missing image err=%#v want 400 packaged image AppError", err)
	}
}

func TestNormalizePackagedServingWeightRejectsNutritionBasisAsServing(t *testing.T) {
	input := PackagedFoodInput{
		NetWeightG:     45,
		ServingWeightG: 100,
	}

	normalizePackagedServingWeight(&input)

	if input.ServingWeightG != 45 {
		t.Fatalf("serving_weight_g=%v want net weight 45g", input.ServingWeightG)
	}
}

func TestNormalizePackagedServingWeightRejectsUnsupportedSmallerServing(t *testing.T) {
	input := PackagedFoodInput{
		NetWeightG:     50,
		ServingWeightG: 25,
	}

	normalizePackagedServingWeight(&input)

	if input.ServingWeightG != 50 {
		t.Fatalf("serving_weight_g=%v want evidence-backed package weight 50g", input.ServingWeightG)
	}
}

func TestNormalizePackagedServingWeightKeepsExplicitPerServingEvidence(t *testing.T) {
	input := PackagedFoodInput{
		NetWeightG:     90,
		ServingWeightG: 30,
		OCRRawText:     "营养成分表 每份食用量:30克",
	}

	normalizePackagedServingWeight(&input)

	if input.ServingWeightG != 30 {
		t.Fatalf("serving_weight_g=%v want explicit serving 30g", input.ServingWeightG)
	}
}

func TestNormalizePackagedServingWeightKeepsExplicitUnitBreakdown(t *testing.T) {
	input := PackagedFoodInput{
		NetWeightG:       91,
		ServingWeightG:   13,
		SpecText:         "91克(7条×13克)",
		UnitCount:        7,
		UnitContentValue: 13,
		UnitContentUnit:  "g",
	}

	normalizePackagedServingWeight(&input)

	if input.ServingWeightG != 13 {
		t.Fatalf("serving_weight_g=%v want explicit unit 13g", input.ServingWeightG)
	}
}

func TestEvaluatePackagedProductExtract_AllowsMissingIngredientsWhenNutritionReady(t *testing.T) {
	result := packagedReadyExtract()
	result.IngredientsText = ""
	result.NeedsMoreImages = []string{"ingredients"}
	result.MissingFields = []string{"barcode", "ingredients_text"}
	result.FieldConfidence["ingredients_text"] = 0
	result.ExtractConfidence = 0.7

	auto := EvaluatePackagedProductExtract(result)
	if auto.Status != "ready" || auto.Reason != "passed" {
		t.Fatalf("auto=%#v want ready/passed", auto)
	}
}

func TestEvaluatePackagedProductExtract_BlocksMissingNetContent(t *testing.T) {
	result := packagedReadyExtract()
	result.NetWeightG = 0
	result.NetContentValue = 0
	result.NetContentUnit = ""
	result.ServingWeightG = 0
	result.SpecText = ""
	result.NutritionBasisUnit = "100ml"

	auto := EvaluatePackagedProductExtract(result)
	if auto.Status != "blocked" || auto.Reason != "missing_net_content" {
		t.Fatalf("auto=%#v want blocked/missing_net_content", auto)
	}
}

func TestEvaluatePackagedProductExtract_AllowsLowConfidenceWhenCoreNutritionReady(t *testing.T) {
	result := packagedReadyExtract()
	result.ExtractConfidence = 0.4
	result.FieldConfidence["product_name"] = 0.4
	result.FieldConfidence["nutrition"] = 0.5

	auto := EvaluatePackagedProductExtract(result)
	if auto.Status != "ready" || auto.Reason != "passed" {
		t.Fatalf("auto=%#v want ready/passed", auto)
	}
}

func TestEvaluatePackagedProductExtract_BlocksKJWrittenAsKcal(t *testing.T) {
	result := packagedReadyExtract()
	result.UnitNutritionPer100g["calories"] = 1668

	auto := EvaluatePackagedProductExtract(result)
	if auto.Status != "blocked" || auto.Reason != "nutrition_out_of_range" {
		t.Fatalf("auto=%#v want blocked/nutrition_out_of_range", auto)
	}
}

func TestEvaluatePackagedProductExtract_BlocksImpossibleMacroSum(t *testing.T) {
	result := packagedReadyExtract()
	result.UnitNutritionPer100g["calories"] = 420
	result.UnitNutritionPer100g["protein"] = 45
	result.UnitNutritionPer100g["carbs"] = 50
	result.UnitNutritionPer100g["fat"] = 35

	auto := EvaluatePackagedProductExtract(result)
	if auto.Status != "blocked" || auto.Reason != "nutrition_out_of_range" {
		t.Fatalf("auto=%#v want blocked/nutrition_out_of_range", auto)
	}
}

func TestEvaluatePackagedProductExtract_AllowsVerifiedZeroNutritionDrink(t *testing.T) {
	result := verifiedZeroDrinkExtract()
	auto := EvaluatePackagedProductExtract(result)

	if auto.Status != "ready" || auto.Reason != "passed" {
		t.Fatalf("auto=%#v want ready/passed for verified zero drink", auto)
	}
	if !PackagedExtractHasVerifiedZeroNutritionEvidence(result) {
		t.Fatal("expected verified zero nutrition evidence")
	}
}

func TestEvaluatePackagedProductExtract_BlocksZeroNutritionWithoutEvidence(t *testing.T) {
	result := packagedReadyExtract()
	result.UnitNutritionPer100g = map[string]any{
		"calories": 0,
		"protein":  0,
		"carbs":    0,
		"fat":      0,
	}
	result.RawNutritionPerBasis = PackagedLabelRawNutrition{}
	result.RawLabelPayload = nil
	result.OCRRawText = ""

	auto := EvaluatePackagedProductExtract(result)
	if auto.Status != "blocked" || auto.Reason != "missing_nutrition" {
		t.Fatalf("auto=%#v want blocked/missing_nutrition without zero-label evidence", auto)
	}
}

func TestEvaluatePackagedProductExtract_NilIsBlocked(t *testing.T) {
	auto := EvaluatePackagedProductExtract(nil)
	if auto.Status != "blocked" || auto.Reason != "empty_result" {
		t.Fatalf("auto=%#v want blocked/empty_result", auto)
	}
}

func TestEnrichPackagedProductExtractResult_DoesNotRequestConfirmationWhenStable(t *testing.T) {
	result := packagedReadyExtractForConfirmation()

	enrichPackagedProductExtractResult(result)

	if result.NeedsUserConfirmation {
		t.Fatalf("needs_user_confirmation=%v want false, reasons=%v", result.NeedsUserConfirmation, result.ConfirmationReasons)
	}
	if len(result.ConfirmationReasons) != 0 {
		t.Fatalf("confirmation_reasons=%v want empty", result.ConfirmationReasons)
	}
}

func TestEnrichPackagedProductExtractResult_RequestsConfirmationForImplausibleNutrition(t *testing.T) {
	result := packagedReadyExtractForConfirmation()
	result.RawNutritionPerBasis.Energy = PackagedLabelNutritionValue{Value: 6980, Unit: "kj"}

	enrichPackagedProductExtractResult(result)

	if !result.NeedsUserConfirmation {
		t.Fatal("expected needs_user_confirmation")
	}
	if !containsString(result.ConfirmationReasons, "nutrition_out_of_range") {
		t.Fatalf("confirmation_reasons=%v want nutrition_out_of_range", result.ConfirmationReasons)
	}
	if !containsString(result.ConfirmationFields, "unit_nutrition_per_100g") {
		t.Fatalf("confirmation_fields=%v want unit_nutrition_per_100g", result.ConfirmationFields)
	}
}

func TestEnrichPackagedProductExtractResult_RequestsConfirmationForMissingCoreFields(t *testing.T) {
	result := packagedReadyExtractForConfirmation()
	result.ProductName = ""
	result.NetWeightG = 0
	result.SpecText = ""
	result.UnitNutritionPer100g = map[string]any{}
	result.RawNutritionBasis = PackagedLabelNutritionBasis{}
	result.RawNutritionPerBasis = PackagedLabelRawNutrition{}
	result.MissingFields = []string{"product_name", "net_weight_g"}
	result.NeedsMoreImages = []string{"front_package", "nutrition_label", "net_weight"}

	enrichPackagedProductExtractResult(result)

	if !result.NeedsUserConfirmation {
		t.Fatal("expected needs_user_confirmation")
	}
	for _, want := range []string{
		"missing_product_name",
		"missing_net_content",
		"conversion_not_closed",
		"missing_nutrition",
		"need_clearer_front_package",
		"need_clearer_nutrition_label",
		"need_clearer_net_weight",
	} {
		if !containsString(result.ConfirmationReasons, want) {
			t.Fatalf("confirmation_reasons=%v want %s", result.ConfirmationReasons, want)
		}
	}
	for _, wantField := range []string{"product_name", "net_weight_g", "spec_text", "unit_nutrition_per_100g"} {
		if !containsString(result.ConfirmationFields, wantField) {
			t.Fatalf("confirmation_fields=%v want %s", result.ConfirmationFields, wantField)
		}
	}
}

func TestConvertPackagedNutrition_NormalizesChinesePer100ML(t *testing.T) {
	result := packagedReadyExtract()
	result.NutritionBasisUnit = "每100毫升（冲调后）"
	result.RawNutritionBasis = PackagedLabelNutritionBasis{Type: "每100毫升", Value: 100, Unit: "毫升"}
	result.RawNutritionPerBasis = PackagedLabelRawNutrition{
		Energy:   PackagedLabelNutritionValue{Value: 168, Unit: "千焦"},
		Carbs:    PackagedLabelNutritionValue{Value: 6.6, Unit: "克"},
		Fat:      PackagedLabelNutritionValue{Value: 1.5, Unit: "克"},
		SodiumMg: PackagedLabelNutritionValue{Value: 62, Unit: "毫克"},
	}
	result.UnitNutritionPer100g = map[string]any{}

	convertPackagedNutrition(result)

	if result.ConversionStatus != "converted" || result.NutritionBasisUnit != "100ml" {
		t.Fatalf("status=%s basis=%s want converted/100ml", result.ConversionStatus, result.NutritionBasisUnit)
	}
	if got := numberFromAny(result.UnitNutritionPer100g["carbs"]); got != 6.6 {
		t.Fatalf("carbs=%v want 6.6", got)
	}
}

func TestConvertPackagedNutrition_NormalizesChinesePer100G(t *testing.T) {
	result := packagedReadyExtract()
	result.NutritionBasisUnit = "每100克"
	result.RawNutritionBasis = PackagedLabelNutritionBasis{Type: "每100g", Value: 100, Unit: "克"}
	result.RawNutritionPerBasis = PackagedLabelRawNutrition{
		Energy:  PackagedLabelNutritionValue{Value: 1912, Unit: "千焦"},
		Protein: PackagedLabelNutritionValue{Value: 14.1, Unit: "克"},
		Carbs:   PackagedLabelNutritionValue{Value: 63.1, Unit: "克"},
		Fat:     PackagedLabelNutritionValue{Value: 16.2, Unit: "克"},
	}
	result.UnitNutritionPer100g = map[string]any{}

	convertPackagedNutrition(result)

	if result.ConversionStatus != "converted" || result.NutritionBasisUnit != "100g" {
		t.Fatalf("status=%s basis=%s want converted/100g", result.ConversionStatus, result.NutritionBasisUnit)
	}
	if got := numberFromAny(result.UnitNutritionPer100g["calories"]); got < 456 || got > 458 {
		t.Fatalf("calories=%v want about 457 kcal", got)
	}
}

func TestConvertPackagedNutrition_ConvertsServingToPer100G(t *testing.T) {
	result := packagedReadyExtract()
	result.ServingWeightG = 19
	result.RawNutritionBasis = PackagedLabelNutritionBasis{Type: "每份", Value: 19, Unit: "g"}
	result.RawNutritionPerBasis = PackagedLabelRawNutrition{
		Energy:   PackagedLabelNutritionValue{Value: 318, Unit: "千焦"},
		Protein:  PackagedLabelNutritionValue{Value: 2.7, Unit: "g"},
		Carbs:    PackagedLabelNutritionValue{Value: 13.2, Unit: "g"},
		Fat:      PackagedLabelNutritionValue{Value: 1.3, Unit: "g"},
		SodiumMg: PackagedLabelNutritionValue{Value: 75, Unit: "毫克"},
	}
	result.UnitNutritionPer100g = map[string]any{}

	convertPackagedNutrition(result)

	if result.ConversionStatus != "converted" || result.NutritionBasisUnit != "100g" {
		t.Fatalf("status=%s basis=%s want converted/100g", result.ConversionStatus, result.NutritionBasisUnit)
	}
	if got := numberFromAny(result.UnitNutritionPer100g["carbs"]); got < 69.4 || got > 69.5 {
		t.Fatalf("carbs=%v want about 69.47", got)
	}
}

func TestConvertPackagedNutrition_TreatsSolidBeverageServingAsPer100G(t *testing.T) {
	result := packagedReadyExtract()
	result.PackageCategory = "固体饮料"
	result.ServingWeightG = 2
	result.SpecText = "每份2克"
	result.RawNutritionBasis = PackagedLabelNutritionBasis{Type: "每份", Value: 2, Unit: "份"}
	result.RawNutritionPerBasis = PackagedLabelRawNutrition{
		Energy:  PackagedLabelNutritionValue{Value: 31, Unit: "千焦"},
		Protein: PackagedLabelNutritionValue{Value: 0.4, Unit: "克"},
		Carbs:   PackagedLabelNutritionValue{Value: 1.4, Unit: "克"},
	}
	result.UnitNutritionPer100g = map[string]any{}

	convertPackagedNutrition(result)

	if result.ConversionStatus != "converted" || result.NutritionBasisUnit != "100g" {
		t.Fatalf("status=%s basis=%s want converted/100g", result.ConversionStatus, result.NutritionBasisUnit)
	}
	if got := numberFromAny(result.UnitNutritionPer100g["carbs"]); got != 70 {
		t.Fatalf("carbs=%v want 70", got)
	}
}

func TestConvertPackagedNutrition_CombinesMultiFlavorServingPayload(t *testing.T) {
	result := &PackagedProductExtractResult{
		Brand:              "梦龙",
		ProductName:        "迷你梦龙浓郁黑巧克力冰淇淋、松露巧克力口味冰淇淋组合装",
		PackageCategory:    "冰淇淋",
		NetWeightG:         255,
		NetContentValue:    255,
		NetContentUnit:     "g",
		UnitCount:          6,
		SpecText:           "6支装，其中浓郁黑巧克力冰淇淋3支（每支42克），松露巧克力口味冰淇淋3支（每支43克）",
		NutritionBasisUnit: "100g",
		RawNutritionBasis:  PackagedLabelNutritionBasis{Type: "每份"},
		RawNutritionPerBasis: PackagedLabelRawNutrition{
			Energy: PackagedLabelNutritionValue{},
		},
		RawLabelPayload: map[string]any{
			"浓郁黑巧克力冰淇淋单支营养（42g）": map[string]any{
				"能量":    "575千焦",
				"蛋白质":   "1.8克",
				"脂肪":    "10.5克",
				"饱和脂肪":  "6.5克",
				"碳水化合物": "9.0克",
				"糖":     "8.4克",
				"膳食纤维":  "0.3克",
				"钠":     "18毫克",
			},
			"松露巧克力口味冰淇淋单支营养（43g）": map[string]any{
				"能量":    "623千焦",
				"蛋白质":   "1.6克",
				"脂肪":    "10.4克",
				"饱和脂肪":  "6.1克",
				"碳水化合物": "12.1克",
				"糖":     "11.1克",
				"膳食纤维":  "0.7克",
				"钠":     "24毫克",
			},
		},
		UnitNutritionPer100g: map[string]any{},
	}

	convertPackagedNutrition(result)
	auto := EvaluatePackagedProductExtract(result)

	if result.ConversionStatus != "converted" || result.NutritionBasisUnit != "100g" {
		t.Fatalf("status=%s basis=%s want converted/100g", result.ConversionStatus, result.NutritionBasisUnit)
	}
	if got := numberFromAny(result.UnitNutritionPer100g["calories"]); got < 336 || got > 337 {
		t.Fatalf("calories=%v want about 336.8 kcal/100g", got)
	}
	if got := numberFromAny(result.UnitNutritionPer100g["protein"]); got < 3.9 || got > 4.1 {
		t.Fatalf("protein=%v want about 4.0g/100g", got)
	}
	if got := numberFromAny(result.UnitNutritionPer100g["fat"]); got < 24.5 || got > 24.7 {
		t.Fatalf("fat=%v want about 24.6g/100g", got)
	}
	if got := numberFromAny(result.UnitNutritionPer100g["sodiumMg"]); got < 49 || got > 50 {
		t.Fatalf("sodium=%v want about 49.4mg/100g", got)
	}
	if got := result.ServingWeightG; got < 42.4 || got > 42.6 {
		t.Fatalf("serving_weight_g=%v want package average 42.5g", got)
	}
	if auto.Status != "ready" || auto.Reason != "passed" {
		t.Fatalf("auto=%#v want ready/passed", auto)
	}
}

func TestConvertPackagedNutrition_AllowsZeroEnergyPer100ML(t *testing.T) {
	result := verifiedZeroDrinkExtract()
	result.UnitNutritionPer100g = map[string]any{}
	result.ConversionStatus = ""

	convertPackagedNutrition(result)

	if result.ConversionStatus != "converted" || result.NutritionBasisUnit != "100ml" {
		t.Fatalf("status=%s basis=%s want converted/100ml", result.ConversionStatus, result.NutritionBasisUnit)
	}
	for _, key := range []string{"calories", "protein", "carbs", "fat"} {
		if got := numberFromAny(result.UnitNutritionPer100g[key]); got != 0 {
			t.Fatalf("%s=%v want 0", key, got)
		}
	}
}

func packagedReadyExtract() *PackagedProductExtractResult {
	return &PackagedProductExtractResult{
		Brand:              "雀巢咖啡",
		ProductName:        "雀巢咖啡1+2 奶香 咖啡固体饮料",
		PackageCategory:    "固体饮料",
		NetWeightG:         105,
		SpecText:           "105克(7条X15克)",
		NutritionBasisUnit: "100g",
		ConversionStatus:   "converted",
		UnitNutritionPer100g: map[string]any{
			"calories": 40.15,
			"carbs":    6.6,
			"fat":      1.5,
			"sodiumMg": 62,
		},
		FieldConfidence: map[string]any{
			"product_name":     0.9,
			"spec_text":        0.95,
			"nutrition":        0.9,
			"brand":            1,
			"ingredients_text": 1,
		},
		ExtractConfidence: 0.95,
	}
}

func packagedReadyExtractForConfirmation() *PackagedProductExtractResult {
	return &PackagedProductExtractResult{
		Brand:              "测试品牌",
		ProductName:        "测试蛋白棒",
		PackageCategory:    "零食",
		NetWeightG:         60,
		NetContentValue:    60,
		NetContentUnit:     "g",
		SpecText:           "60g",
		NutritionBasisUnit: "100g",
		RawNutritionBasis:  PackagedLabelNutritionBasis{Type: "100g", Value: 100, Unit: "g"},
		RawNutritionPerBasis: PackagedLabelRawNutrition{
			Energy:  PackagedLabelNutritionValue{Value: 1757, Unit: "kj"},
			Protein: PackagedLabelNutritionValue{Value: 20, Unit: "g"},
			Carbs:   PackagedLabelNutritionValue{Value: 40, Unit: "g"},
			Fat:     PackagedLabelNutritionValue{Value: 15, Unit: "g"},
		},
		UnitNutritionPer100g: map[string]any{
			"calories": 420,
			"protein":  20,
			"carbs":    40,
			"fat":      15,
		},
		FieldConfidence: map[string]any{
			"product_name": 0.92,
			"spec_text":    0.9,
			"nutrition":    0.93,
		},
		ExtractConfidence: 0.95,
	}
}

func verifiedZeroDrinkExtract() *PackagedProductExtractResult {
	return &PackagedProductExtractResult{
		Brand:              "三得利",
		ProductName:        "无糖荷叶茉莉花味风味饮料",
		PackageCategory:    "饮料",
		NetContentValue:    500,
		NetContentUnit:     "ml",
		SpecText:           "500ml",
		NutritionBasisUnit: "100ml",
		ConversionStatus:   "converted",
		RawNutritionBasis:  PackagedLabelNutritionBasis{Type: "每100毫升", Value: 100, Unit: "毫升"},
		RawNutritionPerBasis: PackagedLabelRawNutrition{
			Energy:  PackagedLabelNutritionValue{Value: 0, Unit: "千焦"},
			Protein: PackagedLabelNutritionValue{Value: 0, Unit: "克"},
			Carbs:   PackagedLabelNutritionValue{Value: 0, Unit: "克"},
			Fat:     PackagedLabelNutritionValue{Value: 0, Unit: "克"},
		},
		UnitNutritionPer100g: map[string]any{
			"calories": 0,
			"protein":  0,
			"carbs":    0,
			"fat":      0,
			"sodiumMg": 5,
		},
		OCRRawText: "营养成分表 每100ml 能量 0kJ 蛋白质 0g 脂肪 0g 碳水化合物 0g",
		FieldConfidence: map[string]any{
			"product_name": 0.9,
			"spec_text":    0.95,
			"nutrition":    0.9,
		},
		ExtractConfidence: 0.95,
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
