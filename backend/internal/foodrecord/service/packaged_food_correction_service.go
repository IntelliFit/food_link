package service

import (
	"context"
	"encoding/json"
	"math"
	"strings"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
)

type SubmitPackagedFoodCorrectionInput struct {
	PackagedFoodID string
	ReasonType     string
	Comment        string
	Payload        PackagedFoodInput
	ProvidedFields map[string]bool
}

func (s *FoodNutritionService) GetPackagedFood(ctx context.Context, id string) (*domain.PackagedFood, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "包装食品 ID 不能为空", HTTPStatus: 400}
	}
	return s.nutritionRepo.GetPackagedFoodByID(ctx, id)
}

func (s *FoodNutritionService) SubmitPackagedFoodCorrection(ctx context.Context, userID string, input SubmitPackagedFoodCorrectionInput) (*domain.PackagedFoodCorrectionSubmission, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "用户信息缺失", HTTPStatus: 401}
	}
	item, err := s.GetPackagedFood(ctx, input.PackagedFoodID)
	if err != nil {
		return nil, err
	}

	reasonType := normalizeCorrectionReasonType(input.ReasonType)
	comment := strings.TrimSpace(input.Comment)
	if comment == "" && reasonType == "other" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "请补充纠错说明", HTTPStatus: 400}
	}

	input.Payload.ProductName = firstNonEmpty(strings.TrimSpace(input.Payload.ProductName), item.ProductName)
	input.Payload.DisplayName = firstNonEmpty(strings.TrimSpace(input.Payload.DisplayName), item.DisplayName, item.ProductName)
	input.Payload.Brand = firstNonEmpty(strings.TrimSpace(input.Payload.Brand), item.Brand)
	input.Payload.SourceImageURLs = normalizeStringSlice(input.Payload.SourceImageURLs)
	if len(input.Payload.SourceImageURLs) == 0 {
		input.Payload.SourceImageURLs = normalizeStringSlice(item.SourceImageURLs)
	}
	if len(input.Payload.SourceImageURLs) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "至少需要一张包装或营养成分证据图", HTTPStatus: 400}
	}

	patch := buildPackagedFoodPatch(input.Payload, input.ProvidedFields)
	beforeSnapshot, err := foodrecordrepoSnapshot(*item)
	if err != nil {
		return nil, err
	}
	diff := foodrecordrepo.DiffPackagedFoodPatch(beforeSnapshot, patch)
	if len(diff) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "未检测到有效修改字段", HTTPStatus: 400}
	}

	riskFlags := collectCorrectionRiskFlags(beforeSnapshot, diff)
	confidenceScore := correctionConfidenceScore(diff, input.Payload.SourceImageURLs, riskFlags)
	submission := &domain.PackagedFoodCorrectionSubmission{
		UserID:            userID,
		PackagedFoodID:    item.ID,
		Status:            "pending",
		ReasonType:        reasonType,
		Comment:           comment,
		BeforeSnapshot:    beforeSnapshot,
		ProposedPatch:     diff,
		EvidenceImageURLs: normalizeStringSlice(input.Payload.SourceImageURLs),
		EvidenceBarcode:   nilIfEmpty(firstNonEmpty(input.Payload.Barcode, stringValue(item.Barcode))),
		OCRRawText:        nilIfEmpty(strings.TrimSpace(input.Payload.OCRRawText)),
		ConfidenceScore:   confidenceScore,
		RiskFlags:         riskFlags,
	}
	if err := s.nutritionRepo.CreatePackagedFoodCorrectionSubmission(ctx, submission); err != nil {
		return nil, err
	}
	return submission, nil
}

func buildPackagedFoodPatch(input PackagedFoodInput, providedFields map[string]bool) map[string]any {
	candidates := map[string]any{
		"brand":                      strings.TrimSpace(input.Brand),
		"product_name":               strings.TrimSpace(input.ProductName),
		"display_name":               firstNonEmpty(strings.TrimSpace(input.DisplayName), strings.TrimSpace(input.ProductName)),
		"barcode":                    nullableValue(input.Barcode),
		"spec_text":                  nullableValue(input.SpecText),
		"flavor_text":                nullableValue(input.FlavorText),
		"package_category":           nullableValue(input.PackageCategory),
		"source_image_urls":          normalizeStringSlice(input.SourceImageURLs),
		"ingredients_text":           nullableValue(input.IngredientsText),
		"ocr_raw_text":               nullableValue(input.OCRRawText),
		"nutrition_basis_unit":       nullableValue(input.NutritionBasisUnit),
		"energy_unit_raw":            nullableValue(input.EnergyUnitRaw),
		"extract_confidence":         input.ExtractConfidence,
		"field_confidence":           input.FieldConfidence,
		"raw_label_payload":          input.RawLabelPayload,
		"conversion_status":          nullableValue(input.ConversionStatus),
		"net_weight_g":               input.NetWeightG,
		"serving_weight_g":           input.ServingWeightG,
		"kcal_per_100g":              input.KcalPer100g,
		"protein_per_100g":           input.ProteinPer100g,
		"carbs_per_100g":             input.CarbsPer100g,
		"fat_per_100g":               input.FatPer100g,
		"fiber_per_100g":             input.FiberPer100g,
		"sugar_per_100g":             input.SugarPer100g,
		"saturated_fat_per_100g":     input.SaturatedFatPer100g,
		"cholesterol_mg_per_100g":    input.CholesterolMgPer100g,
		"sodium_mg_per_100g":         input.SodiumMgPer100g,
		"potassium_mg_per_100g":      input.PotassiumMgPer100g,
		"calcium_mg_per_100g":        input.CalciumMgPer100g,
		"iron_mg_per_100g":           input.IronMgPer100g,
		"magnesium_mg_per_100g":      input.MagnesiumMgPer100g,
		"zinc_mg_per_100g":           input.ZincMgPer100g,
		"vitamin_a_rae_mcg_per_100g": input.VitaminARaeMcgPer100g,
		"vitamin_c_mg_per_100g":      input.VitaminCMgPer100g,
		"vitamin_d_mcg_per_100g":     input.VitaminDMcgPer100g,
		"vitamin_e_mg_per_100g":      input.VitaminEMgPer100g,
		"vitamin_k_mcg_per_100g":     input.VitaminKMcgPer100g,
		"thiamin_mg_per_100g":        input.ThiaminMgPer100g,
		"riboflavin_mg_per_100g":     input.RiboflavinMgPer100g,
		"niacin_mg_per_100g":         input.NiacinMgPer100g,
		"vitamin_b6_mg_per_100g":     input.VitaminB6MgPer100g,
		"folate_mcg_per_100g":        input.FolateMcgPer100g,
		"vitamin_b12_mcg_per_100g":   input.VitaminB12McgPer100g,
	}
	patch := make(map[string]any, len(providedFields))
	for field := range providedFields {
		if value, ok := candidates[field]; ok {
			patch[field] = value
		}
	}
	return patch
}

func foodrecordrepoSnapshot(item domain.PackagedFood) (map[string]any, error) {
	encoded, err := json.Marshal(item)
	if err != nil {
		return nil, err
	}
	var snapshot map[string]any
	if err := json.Unmarshal(encoded, &snapshot); err != nil {
		return nil, err
	}
	delete(snapshot, "created_at")
	delete(snapshot, "updated_at")
	return snapshot, nil
}

func normalizeCorrectionReasonType(value string) string {
	switch strings.TrimSpace(value) {
	case "nutrition_wrong", "barcode_wrong", "name_wrong", "spec_wrong", "duplicate":
		return strings.TrimSpace(value)
	default:
		return "other"
	}
}

func collectCorrectionRiskFlags(before map[string]any, diff map[string]any) []string {
	flags := []string{}
	if kcal, ok := asFloat(diff["kcal_per_100g"]); ok {
		protein, _ := asFloat(coalesceDiffValue(diff, before, "protein_per_100g"))
		carbs, _ := asFloat(coalesceDiffValue(diff, before, "carbs_per_100g"))
		fat, _ := asFloat(coalesceDiffValue(diff, before, "fat_per_100g"))
		expected := protein*4 + carbs*4 + fat*9
		if kcal > 0 && expected > 0 && math.Abs(kcal-expected) > math.Max(25, expected*0.35) {
			flags = append(flags, "macro_kcal_mismatch")
		}
	}
	if current, ok := asFloat(before["kcal_per_100g"]); ok {
		if next, ok := asFloat(diff["kcal_per_100g"]); ok && current > 0 {
			if math.Abs(next-current)/current >= 0.5 {
				flags = append(flags, "large_calorie_delta")
			}
		}
	}
	if sourceImages, ok := diff["source_image_urls"].([]string); ok && len(sourceImages) == 0 {
		flags = append(flags, "missing_evidence_images")
	}
	return uniqueStrings(flags)
}

func correctionConfidenceScore(diff map[string]any, evidence []string, riskFlags []string) float64 {
	score := 0.55
	if len(evidence) >= 2 {
		score += 0.2
	} else if len(evidence) == 1 {
		score += 0.1
	}
	if _, ok := diff["barcode"]; ok {
		score += 0.1
	}
	score -= float64(len(riskFlags)) * 0.15
	if score < 0.05 {
		return 0.05
	}
	if score > 0.98 {
		return 0.98
	}
	return score
}

func coalesceDiffValue(diff map[string]any, before map[string]any, key string) any {
	if value, ok := diff[key]; ok {
		return value
	}
	return before[key]
}

func asFloat(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	default:
		return 0, false
	}
}

func nilIfEmpty(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func nullableValue(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}
