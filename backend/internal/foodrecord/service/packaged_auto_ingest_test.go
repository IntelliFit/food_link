package service

import "testing"

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

func TestEvaluatePackagedProductExtract_AllowsMissingNetWeightWhenNutritionReady(t *testing.T) {
	result := packagedReadyExtract()
	result.NetWeightG = 0
	result.ServingWeightG = 0
	result.SpecText = "净含量:250mL"
	result.NutritionBasisUnit = "100ml"

	auto := EvaluatePackagedProductExtract(result)
	if auto.Status != "ready" || auto.Reason != "passed" {
		t.Fatalf("auto=%#v want ready/passed", auto)
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
