package service

import (
	"context"
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
	return PackagedFoodInput{
		Brand:                 result.Brand,
		ProductName:           result.ProductName,
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
	return hasValidPackagedNutrition(result.UnitNutritionPer100g)
}
