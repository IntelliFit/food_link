package service

import (
	"context"
	"math"
	"strings"

	"food_link/backend/internal/foodrecord/domain"
)

const (
	PackagedIngestMethodHumanPhotoBatch = "human_photo_batch"
	PackagedSourceHumanPhotoBatch       = "human_photo_batch_20260526"
)

type PackagedImportIngestOptions struct {
	Source       string
	IngestMethod string
	ForceApply   bool
}

func (s *FoodNutritionService) IngestPackagedProductExtract(
	ctx context.Context,
	result *PackagedProductExtractResult,
	opts PackagedImportIngestOptions,
) (*PackagedAutoIngestResult, *domain.PackagedFood, error) {
	auto := evaluatePackagedAutoIngest(result)
	if auto.Status != "ready" {
		if !opts.ForceApply || !canForceIngestPackagedProduct(result) {
			return auto, nil, nil
		}
		auto.Reason = "force_apply"
		auto.Status = "ready"
	}
	input := buildPackagedFoodInputFromExtract(result, opts)
	created, action, err := s.CreatePackagedFoodWithAction(ctx, input)
	if err != nil {
		return nil, nil, err
	}
	auto.Status = "ingested"
	auto.PackagedFoodID = created.ID
	auto.UpsertAction = action
	return auto, created, nil
}

func (s *FoodNutritionService) TryAutoIngestPackagedProduct(ctx context.Context, result *PackagedProductExtractResult) (*PackagedAutoIngestResult, *domain.PackagedFood, error) {
	return s.IngestPackagedProductExtract(ctx, result, PackagedImportIngestOptions{
		Source:       "user_capture_ocr",
		IngestMethod: packagedFoodIngestMethodUserCaptureOCR,
	})
}

func EvaluatePackagedProductExtract(result *PackagedProductExtractResult) *PackagedAutoIngestResult {
	return evaluatePackagedAutoIngest(result)
}

func buildPackagedFoodInputFromExtract(result *PackagedProductExtractResult, opts PackagedImportIngestOptions) PackagedFoodInput {
	ingestMethod := strings.TrimSpace(opts.IngestMethod)
	if ingestMethod == "" {
		ingestMethod = packagedFoodIngestMethodUserCaptureOCR
	}
	source := strings.TrimSpace(opts.Source)
	if source == "" {
		source = "user_capture_ocr"
	}
	input := PackagedFoodInput{
		Brand:                 result.Brand,
		ProductName:           result.ProductName,
		DisplayName:           result.DisplayName,
		SearchText:            result.SearchText,
		ProductFamilyKey:      result.ProductFamilyKey,
		SpecText:              result.SpecText,
		Barcode:               result.Barcode,
		FlavorText:            result.FlavorText,
		PackageCategory:       result.PackageCategory,
		IngredientsText:       result.IngredientsText,
		SourceImageURLs:       result.SourceImageURLs,
		OCRRawText:            result.OCRRawText,
		NutritionBasisUnit:    result.NutritionBasisUnit,
		EnergyUnitRaw:         result.EnergyUnitRaw,
		RawLabelPayload:       result.RawLabelPayload,
		ConversionStatus:      result.ConversionStatus,
		ExtractConfidence:     result.ExtractConfidence,
		FieldConfidence:       result.FieldConfidence,
		IngestMethod:          ingestMethod,
		NetContentValue:       result.NetContentValue,
		NetContentUnit:        result.NetContentUnit,
		UnitCount:             result.UnitCount,
		UnitContentValue:      result.UnitContentValue,
		UnitContentUnit:       result.UnitContentUnit,
		ReviewStatus:          result.ReviewStatus,
		NetWeightG:            result.NetWeightG,
		ServingWeightG:        effectiveServingWeight(result),
		KcalPer100g:           numberFromAny(result.UnitNutritionPer100g["calories"]),
		ProteinPer100g:        numberFromAny(result.UnitNutritionPer100g["protein"]),
		CarbsPer100g:          numberFromAny(result.UnitNutritionPer100g["carbs"]),
		FatPer100g:            numberFromAny(result.UnitNutritionPer100g["fat"]),
		FiberPer100g:          numberFromAny(result.UnitNutritionPer100g["fiber"]),
		SugarPer100g:          numberFromAny(result.UnitNutritionPer100g["sugar"]),
		SaturatedFatPer100g:   numberFromAny(result.UnitNutritionPer100g["saturatedFat"]),
		CholesterolMgPer100g:  numberFromAny(result.UnitNutritionPer100g["cholesterolMg"]),
		SodiumMgPer100g:       numberFromAny(result.UnitNutritionPer100g["sodiumMg"]),
		PotassiumMgPer100g:    numberFromAny(result.UnitNutritionPer100g["potassiumMg"]),
		CalciumMgPer100g:      numberFromAny(result.UnitNutritionPer100g["calciumMg"]),
		IronMgPer100g:         numberFromAny(result.UnitNutritionPer100g["ironMg"]),
		MagnesiumMgPer100g:    numberFromAny(result.UnitNutritionPer100g["magnesiumMg"]),
		ZincMgPer100g:         numberFromAny(result.UnitNutritionPer100g["zincMg"]),
		VitaminARaeMcgPer100g: numberFromAny(result.UnitNutritionPer100g["vitaminARaeMcg"]),
		VitaminCMgPer100g:     numberFromAny(result.UnitNutritionPer100g["vitaminCMg"]),
		VitaminDMcgPer100g:    numberFromAny(result.UnitNutritionPer100g["vitaminDMcg"]),
		VitaminEMgPer100g:     numberFromAny(result.UnitNutritionPer100g["vitaminEMg"]),
		VitaminKMcgPer100g:    numberFromAny(result.UnitNutritionPer100g["vitaminKMcg"]),
		ThiaminMgPer100g:      numberFromAny(result.UnitNutritionPer100g["thiaminMg"]),
		RiboflavinMgPer100g:   numberFromAny(result.UnitNutritionPer100g["riboflavinMg"]),
		NiacinMgPer100g:       numberFromAny(result.UnitNutritionPer100g["niacinMg"]),
		VitaminB6MgPer100g:    numberFromAny(result.UnitNutritionPer100g["vitaminB6Mg"]),
		FolateMcgPer100g:      numberFromAny(result.UnitNutritionPer100g["folateMcg"]),
		VitaminB12McgPer100g:  numberFromAny(result.UnitNutritionPer100g["vitaminB12Mcg"]),
		Source:                source,
	}
	roundPackagedFoodInputNutrients(&input)
	return input
}

func roundPackagedFoodInputNutrients(input *PackagedFoodInput) {
	input.KcalPer100g = roundToPrecision(input.KcalPer100g, 1)
	input.ProteinPer100g = roundToPrecision(input.ProteinPer100g, 1)
	input.CarbsPer100g = roundToPrecision(input.CarbsPer100g, 1)
	input.FatPer100g = roundToPrecision(input.FatPer100g, 1)
	input.FiberPer100g = roundToPrecision(input.FiberPer100g, 1)
	input.SugarPer100g = roundToPrecision(input.SugarPer100g, 1)
	input.SaturatedFatPer100g = roundToPrecision(input.SaturatedFatPer100g, 1)
	input.CholesterolMgPer100g = roundToPrecision(input.CholesterolMgPer100g, 0)
	input.SodiumMgPer100g = roundToPrecision(input.SodiumMgPer100g, 0)
	input.PotassiumMgPer100g = roundToPrecision(input.PotassiumMgPer100g, 0)
	input.CalciumMgPer100g = roundToPrecision(input.CalciumMgPer100g, 0)
	input.IronMgPer100g = roundToPrecision(input.IronMgPer100g, 0)
	input.MagnesiumMgPer100g = roundToPrecision(input.MagnesiumMgPer100g, 0)
	input.ZincMgPer100g = roundToPrecision(input.ZincMgPer100g, 0)
	input.VitaminARaeMcgPer100g = roundToPrecision(input.VitaminARaeMcgPer100g, 2)
	input.VitaminCMgPer100g = roundToPrecision(input.VitaminCMgPer100g, 2)
	input.VitaminDMcgPer100g = roundToPrecision(input.VitaminDMcgPer100g, 2)
	input.VitaminEMgPer100g = roundToPrecision(input.VitaminEMgPer100g, 2)
	input.VitaminKMcgPer100g = roundToPrecision(input.VitaminKMcgPer100g, 2)
	input.ThiaminMgPer100g = roundToPrecision(input.ThiaminMgPer100g, 2)
	input.RiboflavinMgPer100g = roundToPrecision(input.RiboflavinMgPer100g, 2)
	input.NiacinMgPer100g = roundToPrecision(input.NiacinMgPer100g, 2)
	input.VitaminB6MgPer100g = roundToPrecision(input.VitaminB6MgPer100g, 2)
	input.FolateMcgPer100g = roundToPrecision(input.FolateMcgPer100g, 2)
	input.VitaminB12McgPer100g = roundToPrecision(input.VitaminB12McgPer100g, 2)
}

// RoundPackagedNutritionMap 对 map 形式的营养值按统一规则 round，用于测试接口返回。
func RoundPackagedNutritionMap(values map[string]any) map[string]any {
	if values == nil {
		return map[string]any{}
	}
	precisionRules := map[string]int{
		"calories":       1,
		"protein":        1,
		"carbs":          1,
		"fat":            1,
		"fiber":          1,
		"sugar":          1,
		"saturatedFat":   1,
		"cholesterolMg":  0,
		"sodiumMg":       0,
		"potassiumMg":    0,
		"calciumMg":      0,
		"ironMg":         0,
		"magnesiumMg":    0,
		"zincMg":         0,
		"vitaminARaeMcg": 2,
		"vitaminCMg":     2,
		"vitaminDMcg":    2,
		"vitaminEMg":     2,
		"vitaminKMcg":    2,
		"thiaminMg":      2,
		"riboflavinMg":   2,
		"niacinMg":       2,
		"vitaminB6Mg":    2,
		"folateMcg":      2,
		"vitaminB12Mcg":  2,
	}
	out := make(map[string]any, len(values))
	for k, v := range values {
		precision, ok := precisionRules[k]
		if !ok {
			out[k] = v
			continue
		}
		out[k] = roundToPrecision(numberFromAny(v), precision)
	}
	return out
}

func roundToPrecision(value float64, precision int) float64 {
	if value == 0 {
		return 0
	}
	factor := math.Pow(10, float64(precision))
	return math.Round(value*factor) / factor
}

func canForceIngestPackagedProduct(result *PackagedProductExtractResult) bool {
	if result == nil {
		return false
	}
	if strings.TrimSpace(result.ProductName) == "" {
		return false
	}
	if strings.TrimSpace(result.ConversionStatus) != "converted" {
		return false
	}
	return hasValidPackagedNutrition(result.UnitNutritionPer100g) || PackagedExtractHasVerifiedZeroNutritionEvidence(result)
}
