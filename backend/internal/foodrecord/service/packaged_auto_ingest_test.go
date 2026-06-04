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
