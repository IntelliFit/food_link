package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"

	"food_link/backend/internal/foodrecord/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FoodNutritionRepo struct {
	db *gorm.DB
}

func NewFoodNutritionRepo(db *gorm.DB) *FoodNutritionRepo {
	return &FoodNutritionRepo{db: db}
}

type ResolveResult struct {
	Food        *domain.FoodNutrition
	Status      string
	MatchSource string
	Score       float64
}

type SearchCandidate struct {
	Food        domain.FoodNutrition
	MatchSource string
	Score       float64
}

type PackagedResolveResult struct {
	Food        *domain.PackagedFood
	Status      string
	MatchSource string
	Score       float64
}

type PackagedFoodInput struct {
	Brand                 string
	ProductName           string
	DisplayName           string
	SearchText            string
	ProductFamilyKey      string
	SpecText              string
	Barcode               string
	FlavorText            string
	PackageCategory       string
	IngredientsText       string
	SourceImageURLs       []string
	OCRRawText            string
	NutritionBasisUnit    string
	EnergyUnitRaw         string
	RawLabelPayload       map[string]any
	ConversionStatus      string
	ExtractConfidence     float64
	FieldConfidence       map[string]any
	IngestMethod          string
	NetContentValue       float64
	NetContentUnit        string
	UnitCount             float64
	UnitContentValue      float64
	UnitContentUnit       string
	ReviewStatus          string
	NetWeightG            float64
	ServingWeightG        float64
	KcalPer100g           float64
	ProteinPer100g        float64
	CarbsPer100g          float64
	FatPer100g            float64
	FiberPer100g          float64
	SugarPer100g          float64
	SaturatedFatPer100g   float64
	CholesterolMgPer100g  float64
	SodiumMgPer100g       float64
	PotassiumMgPer100g    float64
	CalciumMgPer100g      float64
	IronMgPer100g         float64
	MagnesiumMgPer100g    float64
	ZincMgPer100g         float64
	VitaminARaeMcgPer100g float64
	VitaminCMgPer100g     float64
	VitaminDMcgPer100g    float64
	VitaminEMgPer100g     float64
	VitaminKMcgPer100g    float64
	ThiaminMgPer100g      float64
	RiboflavinMgPer100g   float64
	NiacinMgPer100g       float64
	VitaminB6MgPer100g    float64
	FolateMcgPer100g      float64
	VitaminB12McgPer100g  float64
	SourceURL             string
	Source                string
}

type PackagedFoodResolveInput struct {
	Name            string
	Brand           string
	SpecText        string
	NetWeightG      float64
	NetContentValue float64
	NetContentUnit  string
	UnitCount       float64
	Barcode         string
	FlavorText      string
}

type PackagedProductNormalizer struct{}

type PackagedProductNormalizeInput struct {
	Brand            string
	ProductName      string
	DisplayName      string
	SearchText       string
	ProductFamilyKey string
	FlavorText       string
	SpecText         string
	Barcode          string
	PackageCategory  string
	OCRRawText       string
	Aliases          []string
	NetWeightG       float64
	NetContentValue  float64
	NetContentUnit   string
	UnitCount        float64
	UnitContentValue float64
	UnitContentUnit  string
	ReviewStatus     string
}

type PackagedProductNormalizedFields struct {
	Brand            string
	ProductName      string
	NormalizedName   string
	ProductKey       string
	DisplayName      string
	SearchText       string
	ProductFamilyKey string
	NetWeightG       float64
	NetContentValue  float64
	NetContentUnit   string
	UnitCount        float64
	UnitContentValue float64
	UnitContentUnit  string
	ReviewStatus     string
}

func (PackagedProductNormalizer) Normalize(input PackagedProductNormalizeInput) PackagedProductNormalizedFields {
	return normalizePackagedProductFields(input)
}

type nutrientFillColumn struct {
	UnitKey string
	Column  string
	Current func(domain.FoodNutrition) float64
}

var deepSeekFillOnlyColumns = []nutrientFillColumn{
	{UnitKey: "fiber", Column: "fiber_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.FiberPer100g }},
	{UnitKey: "sugar", Column: "sugar_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.SugarPer100g }},
	{UnitKey: "saturatedFat", Column: "saturated_fat_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.SaturatedFatPer100g }},
	{UnitKey: "cholesterolMg", Column: "cholesterol_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.CholesterolMgPer100g }},
	{UnitKey: "sodiumMg", Column: "sodium_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.SodiumMgPer100g }},
	{UnitKey: "potassiumMg", Column: "potassium_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.PotassiumMgPer100g }},
	{UnitKey: "calciumMg", Column: "calcium_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.CalciumMgPer100g }},
	{UnitKey: "ironMg", Column: "iron_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.IronMgPer100g }},
	{UnitKey: "magnesiumMg", Column: "magnesium_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.MagnesiumMgPer100g }},
	{UnitKey: "zincMg", Column: "zinc_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.ZincMgPer100g }},
	{UnitKey: "vitaminARaeMcg", Column: "vitamin_a_rae_mcg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.VitaminARaeMcgPer100g }},
	{UnitKey: "vitaminCMg", Column: "vitamin_c_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.VitaminCMgPer100g }},
	{UnitKey: "vitaminDMcg", Column: "vitamin_d_mcg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.VitaminDMcgPer100g }},
	{UnitKey: "vitaminEMg", Column: "vitamin_e_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.VitaminEMgPer100g }},
	{UnitKey: "vitaminKMcg", Column: "vitamin_k_mcg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.VitaminKMcgPer100g }},
	{UnitKey: "thiaminMg", Column: "thiamin_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.ThiaminMgPer100g }},
	{UnitKey: "riboflavinMg", Column: "riboflavin_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.RiboflavinMgPer100g }},
	{UnitKey: "niacinMg", Column: "niacin_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.NiacinMgPer100g }},
	{UnitKey: "vitaminB6Mg", Column: "vitamin_b6_mg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.VitaminB6MgPer100g }},
	{UnitKey: "folateMcg", Column: "folate_mcg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.FolateMcgPer100g }},
	{UnitKey: "vitaminB12Mcg", Column: "vitamin_b12_mcg_per_100g", Current: func(f domain.FoodNutrition) float64 { return f.VitaminB12McgPer100g }},
}

const macroNutritionBackfillWhere = `
is_active = ?
AND COALESCE(kcal_per_100g, 0) + COALESCE(protein_per_100g, 0) + COALESCE(carbs_per_100g, 0) + COALESCE(fat_per_100g, 0) > 0
`

var vitaminBackfillColumns = []string{
	"vitamin_a_rae_mcg_per_100g",
	"vitamin_c_mg_per_100g",
	"vitamin_d_mcg_per_100g",
	"vitamin_e_mg_per_100g",
	"vitamin_k_mcg_per_100g",
	"thiamin_mg_per_100g",
	"riboflavin_mg_per_100g",
	"niacin_mg_per_100g",
	"vitamin_b6_mg_per_100g",
	"folate_mcg_per_100g",
	"vitamin_b12_mcg_per_100g",
}

var mineralBackfillColumns = []string{
	"sodium_mg_per_100g",
	"potassium_mg_per_100g",
	"calcium_mg_per_100g",
	"iron_mg_per_100g",
	"magnesium_mg_per_100g",
	"zinc_mg_per_100g",
}

func micronutrientBackfillWhere() string {
	return macroNutritionBackfillWhere +
		"\nAND ((" + missingColumnGroupCondition(vitaminBackfillColumns) + ") OR (" + missingColumnGroupCondition(mineralBackfillColumns) + "))"
}

func missingColumnGroupCondition(columns []string) string {
	parts := make([]string, 0, len(columns))
	for _, column := range columns {
		parts = append(parts, fmt.Sprintf("COALESCE(%s, 0)", column))
	}
	return strings.Join(parts, " + ") + " <= 0"
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func numberFromAny(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case float32:
		return float64(typed)
	case float64:
		return typed
	case json.Number:
		n, _ := typed.Float64()
		return n
	case string:
		var n float64
		if _, err := fmt.Sscanf(strings.TrimSpace(typed), "%f", &n); err == nil {
			return n
		}
		return 0
	default:
		var n float64
		if _, err := fmt.Sscanf(fmt.Sprintf("%v", typed), "%f", &n); err == nil {
			return n
		}
		return 0
	}
}

func (r *FoodNutritionRepo) ResolveFood(ctx context.Context, name string) (*ResolveResult, error) {
	raw := strings.TrimSpace(name)
	if raw == "" {
		return &ResolveResult{Status: "unresolved", Score: 0}, nil
	}
	lower := strings.ToLower(raw)
	normalized := normalizeFoodName(raw)

	var food domain.FoodNutrition
	err := r.db.WithContext(ctx).
		Where("is_active = ? AND (LOWER(canonical_name) = ? OR normalized_name = ?)", true, lower, normalized).
		First(&food).Error
	if err == nil {
		return &ResolveResult{Food: &food, Status: "exact_canonical", MatchSource: "canonical", Score: 1}, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	var alias domain.FoodNutritionAlias
	err = r.db.WithContext(ctx).
		Where("LOWER(alias_name) = ? OR normalized_alias = ?", lower, normalized).
		First(&alias).Error
	if err == nil && alias.FoodID != "" {
		if foodErr := r.db.WithContext(ctx).Where("is_active = ? AND id = ?", true, alias.FoodID).First(&food).Error; foodErr == nil {
			return &ResolveResult{Food: &food, Status: "exact_alias", MatchSource: "alias", Score: 1}, nil
		} else if foodErr != gorm.ErrRecordNotFound {
			return nil, foodErr
		}
	} else if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	candidates, err := r.SearchCandidates(ctx, raw, 1)
	if err != nil {
		return nil, err
	}
	if len(candidates) > 0 {
		food := candidates[0].Food
		return &ResolveResult{Food: &food, Status: "fuzzy", MatchSource: candidates[0].MatchSource, Score: candidates[0].Score}, nil
	}
	return &ResolveResult{Status: "unresolved", Score: 0}, nil
}

func (r *FoodNutritionRepo) ResolvePackagedFood(ctx context.Context, input PackagedFoodResolveInput) (*PackagedResolveResult, error) {
	raw := strings.TrimSpace(input.Name)
	brand := strings.TrimSpace(input.Brand)
	specText := strings.TrimSpace(input.SpecText)
	barcode := strings.TrimSpace(input.Barcode)
	if raw == "" && barcode == "" {
		return &PackagedResolveResult{Status: "unresolved", Score: 0}, nil
	}
	lower := strings.ToLower(raw)
	normalized := normalizeFoodName(raw)
	normalizedFields := normalizePackagedProductFields(PackagedProductNormalizeInput{
		Brand:           brand,
		ProductName:     raw,
		FlavorText:      input.FlavorText,
		SpecText:        specText,
		Barcode:         barcode,
		NetWeightG:      input.NetWeightG,
		NetContentValue: input.NetContentValue,
		NetContentUnit:  input.NetContentUnit,
		UnitCount:       input.UnitCount,
	})
	productKey := normalizedFields.ProductKey

	if barcode != "" {
		var barcodeFood domain.PackagedFood
		err := r.db.WithContext(ctx).
			Where("is_active = ? AND barcode = ?", true, barcode).
			First(&barcodeFood).Error
		if err == nil {
			return &PackagedResolveResult{Food: &barcodeFood, Status: "barcode", MatchSource: "barcode", Score: 1}, nil
		}
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
	}

	if productKey != "" {
		var productKeyFood domain.PackagedFood
		query := r.db.WithContext(ctx).
			Where("is_active = ? AND product_key = ?", true, productKey).
			Order("updated_at DESC")
		if barcode != "" {
			query = query.Where("(barcode IS NULL OR barcode = '' OR barcode = ?)", barcode)
		}
		err := query.First(&productKeyFood).Error
		if err == nil {
			return &PackagedResolveResult{Food: &productKeyFood, Status: "product_key", MatchSource: "product_key", Score: 1}, nil
		}
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
	}

	var aliases []domain.PackagedFoodAlias
	err := r.db.WithContext(ctx).
		Where("LOWER(alias_name) = ? OR normalized_alias = ?", lower, normalized).
		Limit(20).
		Find(&aliases).Error
	if err != nil {
		return nil, err
	}
	if len(aliases) > 0 {
		foodIDs := make([]string, 0, len(aliases))
		seenAliasFoodIDs := map[string]bool{}
		for _, alias := range aliases {
			if alias.FoodID == "" || seenAliasFoodIDs[alias.FoodID] {
				continue
			}
			seenAliasFoodIDs[alias.FoodID] = true
			foodIDs = append(foodIDs, alias.FoodID)
		}
		if len(foodIDs) > 0 {
			var aliasFoods []domain.PackagedFood
			if foodErr := r.db.WithContext(ctx).
				Where("is_active = ? AND id IN ?", true, foodIDs).
				Find(&aliasFoods).Error; foodErr != nil {
				return nil, foodErr
			}
			if len(aliasFoods) == 1 {
				food := aliasFoods[0]
				return &PackagedResolveResult{Food: &food, Status: "exact_alias", MatchSource: "alias", Score: 1}, nil
			}
			if productKey != "" {
				for _, food := range aliasFoods {
					if food.ProductKey == productKey {
						matched := food
						return &PackagedResolveResult{Food: &matched, Status: "exact_alias", MatchSource: "alias_product_key", Score: 1}, nil
					}
				}
			}
		}
	}

	var exactFoods []domain.PackagedFood
	err = r.db.WithContext(ctx).
		Where("is_active = ? AND (LOWER(product_name) = ? OR normalized_name = ? OR LOWER(COALESCE(display_name, '')) = ? OR product_key = ?)", true, lower, normalized, lower, productKey).
		Limit(3).
		Find(&exactFoods).Error
	if err != nil {
		return nil, err
	}
	if len(exactFoods) == 1 {
		food := exactFoods[0]
		return &PackagedResolveResult{Food: &food, Status: "exact_canonical", MatchSource: "canonical", Score: 1}, nil
	}
	if len(exactFoods) > 1 && productKey != "" {
		for _, food := range exactFoods {
			if food.ProductKey == productKey {
				matched := food
				return &PackagedResolveResult{Food: &matched, Status: "exact_canonical", MatchSource: "canonical_product_key", Score: 1}, nil
			}
		}
	}

	candidates, err := r.SearchPackagedFood(ctx, raw, 1)
	if err != nil {
		return nil, err
	}
	if len(candidates) > 0 {
		score := packagedFoodSearchScore(raw, candidates[0])
		if score < 0.35 {
			return &PackagedResolveResult{Status: "unresolved", Score: 0}, nil
		}
		if score > 0.99 {
			score = 0.99
		}
		return &PackagedResolveResult{Food: &candidates[0], Status: "fuzzy", MatchSource: "fuzzy", Score: score}, nil
	}
	return &PackagedResolveResult{Status: "unresolved", Score: 0}, nil
}

func (r *FoodNutritionRepo) UpsertPackagedFood(ctx context.Context, input PackagedFoodInput) (*domain.PackagedFood, error) {
	item, _, err := r.UpsertPackagedFoodWithAction(ctx, input)
	return item, err
}

func (r *FoodNutritionRepo) UpsertPackagedFoodWithAction(ctx context.Context, input PackagedFoodInput) (*domain.PackagedFood, string, error) {
	productName := strings.TrimSpace(input.ProductName)
	normalizedFields := normalizePackagedProductFields(PackagedProductNormalizeInput{
		Brand:            input.Brand,
		ProductName:      productName,
		DisplayName:      input.DisplayName,
		SearchText:       input.SearchText,
		ProductFamilyKey: input.ProductFamilyKey,
		FlavorText:       input.FlavorText,
		SpecText:         input.SpecText,
		Barcode:          input.Barcode,
		PackageCategory:  input.PackageCategory,
		OCRRawText:       input.OCRRawText,
		NetWeightG:       input.NetWeightG,
		NetContentValue:  input.NetContentValue,
		NetContentUnit:   input.NetContentUnit,
		UnitCount:        input.UnitCount,
		UnitContentValue: input.UnitContentValue,
		UnitContentUnit:  input.UnitContentUnit,
		ReviewStatus:     input.ReviewStatus,
	})
	if productName == "" || normalizedFields.NormalizedName == "" || normalizedFields.ProductKey == "" {
		return nil, "", fmt.Errorf("product_name is required")
	}
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "user_submitted"
	}
	values := map[string]any{
		"brand":                      strings.TrimSpace(input.Brand),
		"product_name":               productName,
		"normalized_name":            normalizedFields.NormalizedName,
		"product_key":                normalizedFields.ProductKey,
		"display_name":               normalizedFields.DisplayName,
		"search_text":                normalizedFields.SearchText,
		"product_family_key":         normalizedFields.ProductFamilyKey,
		"spec_text":                  nullableTrimmedString(input.SpecText),
		"barcode":                    nullableTrimmedString(input.Barcode),
		"flavor_text":                nullableTrimmedString(input.FlavorText),
		"package_category":           nullableTrimmedString(input.PackageCategory),
		"ingredients_text":           nullableTrimmedString(input.IngredientsText),
		"source_image_urls":          normalizeStringSlice(input.SourceImageURLs),
		"ocr_raw_text":               nullableTrimmedString(input.OCRRawText),
		"nutrition_basis_unit":       nullableTrimmedString(input.NutritionBasisUnit),
		"energy_unit_raw":            nullableTrimmedString(input.EnergyUnitRaw),
		"raw_label_payload":          normalizeJSONMap(input.RawLabelPayload),
		"conversion_status":          nullableTrimmedString(input.ConversionStatus),
		"extract_confidence":         nonNegative(input.ExtractConfidence),
		"field_confidence":           normalizeJSONMap(input.FieldConfidence),
		"ingest_method":              nullableTrimmedString(input.IngestMethod),
		"net_content_value":          normalizedFields.NetContentValue,
		"net_content_unit":           nullableTrimmedString(normalizedFields.NetContentUnit),
		"unit_count":                 normalizedFields.UnitCount,
		"unit_content_value":         normalizedFields.UnitContentValue,
		"unit_content_unit":          nullableTrimmedString(normalizedFields.UnitContentUnit),
		"review_status":              normalizedFields.ReviewStatus,
		"net_weight_g":               normalizedFields.NetWeightG,
		"serving_weight_g":           nonNegative(input.ServingWeightG),
		"kcal_per_100g":              nonNegative(input.KcalPer100g),
		"protein_per_100g":           nonNegative(input.ProteinPer100g),
		"carbs_per_100g":             nonNegative(input.CarbsPer100g),
		"fat_per_100g":               nonNegative(input.FatPer100g),
		"fiber_per_100g":             nonNegative(input.FiberPer100g),
		"sugar_per_100g":             nonNegative(input.SugarPer100g),
		"saturated_fat_per_100g":     nonNegative(input.SaturatedFatPer100g),
		"cholesterol_mg_per_100g":    nonNegative(input.CholesterolMgPer100g),
		"sodium_mg_per_100g":         nonNegative(input.SodiumMgPer100g),
		"potassium_mg_per_100g":      nonNegative(input.PotassiumMgPer100g),
		"calcium_mg_per_100g":        nonNegative(input.CalciumMgPer100g),
		"iron_mg_per_100g":           nonNegative(input.IronMgPer100g),
		"magnesium_mg_per_100g":      nonNegative(input.MagnesiumMgPer100g),
		"zinc_mg_per_100g":           nonNegative(input.ZincMgPer100g),
		"vitamin_a_rae_mcg_per_100g": nonNegative(input.VitaminARaeMcgPer100g),
		"vitamin_c_mg_per_100g":      nonNegative(input.VitaminCMgPer100g),
		"vitamin_d_mcg_per_100g":     nonNegative(input.VitaminDMcgPer100g),
		"vitamin_e_mg_per_100g":      nonNegative(input.VitaminEMgPer100g),
		"vitamin_k_mcg_per_100g":     nonNegative(input.VitaminKMcgPer100g),
		"thiamin_mg_per_100g":        nonNegative(input.ThiaminMgPer100g),
		"riboflavin_mg_per_100g":     nonNegative(input.RiboflavinMgPer100g),
		"niacin_mg_per_100g":         nonNegative(input.NiacinMgPer100g),
		"vitamin_b6_mg_per_100g":     nonNegative(input.VitaminB6MgPer100g),
		"folate_mcg_per_100g":        nonNegative(input.FolateMcgPer100g),
		"vitamin_b12_mcg_per_100g":   nonNegative(input.VitaminB12McgPer100g),
		"source":                     source,
		"is_active":                  true,
	}
	if err := normalizePackagedFoodJSONFields(values); err != nil {
		return nil, "", err
	}
	if sourceURL := strings.TrimSpace(input.SourceURL); sourceURL != "" {
		values["source_url"] = sourceURL
	}

	barcode := strings.TrimSpace(input.Barcode)
	var existing domain.PackagedFood
	err := gorm.ErrRecordNotFound
	if barcode != "" {
		err = r.db.WithContext(ctx).
			Where("barcode IS NOT NULL AND barcode <> '' AND barcode = ?", barcode).
			First(&existing).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return nil, "", err
		}
	}
	if err == gorm.ErrRecordNotFound {
		query := r.db.WithContext(ctx).Where("product_key = ?", normalizedFields.ProductKey)
		if barcode != "" {
			query = query.Where("(barcode IS NULL OR barcode = '' OR barcode = ?)", barcode)
		}
		err = query.First(&existing).Error
	}
	if err == nil {
		if err := r.db.WithContext(ctx).Model(&domain.PackagedFood{}).Where("id = ?", existing.ID).Updates(values).Error; err != nil {
			return nil, "", err
		}
		_ = r.createPackagedFoodAlias(ctx, existing.ID, productName, normalizedFields.NormalizedName)
		var updated domain.PackagedFood
		if err := r.db.WithContext(ctx).Where("id = ?", existing.ID).First(&updated).Error; err != nil {
			return nil, "", err
		}
		return &updated, "updated", nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, "", err
	}
	id := uuid.New().String()
	values["id"] = id
	if err := r.db.WithContext(ctx).Table((&domain.PackagedFood{}).TableName()).Create(values).Error; err != nil {
		return nil, "", err
	}
	_ = r.createPackagedFoodAlias(ctx, id, productName, normalizedFields.NormalizedName)
	var created domain.PackagedFood
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&created).Error; err != nil {
		return nil, "", err
	}
	return &created, "created", nil
}

func (r *FoodNutritionRepo) PatchPackagedFood(ctx context.Context, foodID string, values map[string]any) (*domain.PackagedFood, error) {
	foodID = strings.TrimSpace(foodID)
	if foodID == "" {
		return nil, fmt.Errorf("packaged food id is required")
	}
	if len(values) == 0 {
		var existing domain.PackagedFood
		if err := r.db.WithContext(ctx).Where("id = ?", foodID).First(&existing).Error; err != nil {
			return nil, err
		}
		return &existing, nil
	}

	var existing domain.PackagedFood
	if err := r.db.WithContext(ctx).Where("id = ?", foodID).First(&existing).Error; err != nil {
		return nil, err
	}
	updates := map[string]any{}
	for key, value := range values {
		key = strings.TrimSpace(key)
		if key == "" || key == "id" || key == "created_at" || key == "updated_at" {
			continue
		}
		updates[key] = value
	}
	if err := normalizePackagedFoodPatchJSONFields(updates); err != nil {
		return nil, err
	}

	finalBrand := existing.Brand
	if value, ok := updates["brand"]; ok {
		finalBrand = strings.TrimSpace(fmt.Sprintf("%v", value))
		updates["brand"] = finalBrand
	}
	finalProductName := existing.ProductName
	if value, ok := updates["product_name"]; ok {
		finalProductName = strings.TrimSpace(fmt.Sprintf("%v", value))
		updates["product_name"] = finalProductName
		updates["normalized_name"] = normalizeFoodName(finalProductName)
	}
	finalFlavor := derefString(existing.FlavorText)
	if value, ok := updates["flavor_text"]; ok {
		finalFlavor = strings.TrimSpace(fmt.Sprintf("%v", value))
		updates["flavor_text"] = nullableTrimmedString(finalFlavor)
	}
	finalSpec := derefString(existing.SpecText)
	if value, ok := updates["spec_text"]; ok {
		finalSpec = strings.TrimSpace(fmt.Sprintf("%v", value))
		updates["spec_text"] = nullableTrimmedString(finalSpec)
	}
	finalNetWeight := existing.NetWeightG
	if value, ok := updates["net_weight_g"]; ok {
		finalNetWeight = nonNegative(numberFromAny(value))
		updates["net_weight_g"] = finalNetWeight
	}
	finalBarcode := derefString(existing.Barcode)
	if value, ok := updates["barcode"]; ok {
		finalBarcode = strings.TrimSpace(fmt.Sprintf("%v", value))
		updates["barcode"] = nullableTrimmedString(finalBarcode)
	}
	finalCategory := derefString(existing.PackageCategory)
	if value, ok := updates["package_category"]; ok {
		finalCategory = strings.TrimSpace(fmt.Sprintf("%v", value))
		updates["package_category"] = nullableTrimmedString(finalCategory)
	}
	finalOCR := derefString(existing.OCRRawText)
	if value, ok := updates["ocr_raw_text"]; ok {
		finalOCR = strings.TrimSpace(fmt.Sprintf("%v", value))
		updates["ocr_raw_text"] = nullableTrimmedString(finalOCR)
	}
	finalNetContentValue := existing.NetContentValue
	if value, ok := updates["net_content_value"]; ok {
		finalNetContentValue = nonNegative(numberFromAny(value))
		updates["net_content_value"] = finalNetContentValue
	}
	finalNetContentUnit := derefString(existing.NetContentUnit)
	if value, ok := updates["net_content_unit"]; ok {
		finalNetContentUnit = strings.TrimSpace(fmt.Sprintf("%v", value))
		updates["net_content_unit"] = nullableTrimmedString(finalNetContentUnit)
	}
	finalUnitCount := existing.UnitCount
	if value, ok := updates["unit_count"]; ok {
		finalUnitCount = nonNegative(numberFromAny(value))
		updates["unit_count"] = finalUnitCount
	}
	finalUnitContentValue := existing.UnitContentValue
	if value, ok := updates["unit_content_value"]; ok {
		finalUnitContentValue = nonNegative(numberFromAny(value))
		updates["unit_content_value"] = finalUnitContentValue
	}
	finalUnitContentUnit := derefString(existing.UnitContentUnit)
	if value, ok := updates["unit_content_unit"]; ok {
		finalUnitContentUnit = strings.TrimSpace(fmt.Sprintf("%v", value))
		updates["unit_content_unit"] = nullableTrimmedString(finalUnitContentUnit)
	}
	computed := normalizePackagedProductFields(PackagedProductNormalizeInput{
		Brand:            finalBrand,
		ProductName:      finalProductName,
		DisplayName:      stringFromMap(updates, "display_name", existing.DisplayName),
		SearchText:       stringFromMap(updates, "search_text", existing.SearchText),
		ProductFamilyKey: stringFromMap(updates, "product_family_key", existing.ProductFamilyKey),
		FlavorText:       finalFlavor,
		SpecText:         finalSpec,
		Barcode:          finalBarcode,
		PackageCategory:  finalCategory,
		OCRRawText:       finalOCR,
		NetWeightG:       finalNetWeight,
		NetContentValue:  finalNetContentValue,
		NetContentUnit:   finalNetContentUnit,
		UnitCount:        finalUnitCount,
		UnitContentValue: finalUnitContentValue,
		UnitContentUnit:  finalUnitContentUnit,
		ReviewStatus:     stringFromMap(updates, "review_status", existing.ReviewStatus),
	})
	if computed.ProductKey != "" {
		updates["product_key"] = computed.ProductKey
	}
	updates["display_name"] = computed.DisplayName
	updates["search_text"] = computed.SearchText
	updates["product_family_key"] = computed.ProductFamilyKey
	updates["net_content_value"] = computed.NetContentValue
	updates["net_content_unit"] = nullableTrimmedString(computed.NetContentUnit)
	updates["unit_count"] = computed.UnitCount
	updates["unit_content_value"] = computed.UnitContentValue
	updates["unit_content_unit"] = nullableTrimmedString(computed.UnitContentUnit)
	updates["review_status"] = computed.ReviewStatus

	if err := r.db.WithContext(ctx).Model(&domain.PackagedFood{}).Where("id = ?", foodID).Updates(updates).Error; err != nil {
		return nil, err
	}
	if name := strings.TrimSpace(finalProductName); name != "" {
		_ = r.createPackagedFoodAlias(ctx, foodID, name, normalizeFoodName(name))
	}
	var updated domain.PackagedFood
	if err := r.db.WithContext(ctx).Where("id = ?", foodID).First(&updated).Error; err != nil {
		return nil, err
	}
	return &updated, nil
}

func (r *FoodNutritionRepo) SearchPackagedFood(ctx context.Context, query string, limit int) ([]domain.PackagedFood, error) {
	if limit <= 0 {
		limit = 5
	}
	raw := strings.TrimSpace(query)
	if raw == "" {
		return []domain.PackagedFood{}, nil
	}
	terms := packagedFoodSearchTerms(raw)
	if len(terms) == 0 {
		terms = []string{raw}
	}
	candidateLimit := limit * 6
	if candidateLimit < 300 {
		candidateLimit = 300
	}
	if candidateLimit > 500 {
		candidateLimit = 500
	}
	whereParts := make([]string, 0, len(terms))
	args := make([]any, 0, len(terms)*9)
	for _, term := range terms {
		term = strings.TrimSpace(term)
		if term == "" || runeCount(term) < 2 {
			continue
		}
		pattern := fmt.Sprintf("%%%s%%", strings.ToLower(term))
		normalizedPattern := fmt.Sprintf("%%%s%%", normalizeFoodName(term))
		whereParts = append(whereParts, "(LOWER(product_name) LIKE ? OR LOWER(COALESCE(display_name, '')) LIKE ? OR LOWER(COALESCE(search_text, '')) LIKE ? OR LOWER(COALESCE(brand, '')) LIKE ? OR LOWER(COALESCE(flavor_text, '')) LIKE ? OR LOWER(COALESCE(spec_text, '')) LIKE ? OR LOWER(COALESCE(package_category, '')) LIKE ? OR LOWER(COALESCE(ocr_raw_text, '')) LIKE ? OR normalized_name LIKE ? OR product_family_key LIKE ? OR LOWER(COALESCE(barcode, '')) = ?)")
		args = append(args, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, normalizedPattern, normalizedPattern, strings.ToLower(term))
	}
	if len(whereParts) == 0 {
		pattern := fmt.Sprintf("%%%s%%", strings.ToLower(raw))
		normalizedPattern := fmt.Sprintf("%%%s%%", normalizeFoodName(raw))
		whereParts = append(whereParts, "(LOWER(product_name) LIKE ? OR LOWER(COALESCE(display_name, '')) LIKE ? OR LOWER(COALESCE(search_text, '')) LIKE ? OR normalized_name LIKE ? OR product_family_key LIKE ?)")
		args = append(args, pattern, pattern, pattern, normalizedPattern, normalizedPattern)
	}
	var foods []domain.PackagedFood
	err := r.db.WithContext(ctx).
		Where("is_active = ? AND ("+strings.Join(whereParts, " OR ")+")", append([]any{true}, args...)...).
		Limit(candidateLimit).
		Find(&foods).Error
	if err != nil {
		return nil, err
	}

	aliasWhereParts := make([]string, 0, len(terms))
	aliasArgs := make([]any, 0, len(terms)*2)
	for _, term := range terms {
		term = strings.TrimSpace(term)
		if term == "" || runeCount(term) < 2 {
			continue
		}
		pattern := fmt.Sprintf("%%%s%%", strings.ToLower(term))
		normalizedPattern := fmt.Sprintf("%%%s%%", normalizeFoodName(term))
		aliasWhereParts = append(aliasWhereParts, "(LOWER(alias_name) LIKE ? OR normalized_alias LIKE ?)")
		aliasArgs = append(aliasArgs, pattern, normalizedPattern)
	}
	var aliases []domain.PackagedFoodAlias
	if len(aliasWhereParts) > 0 {
		err = r.db.WithContext(ctx).
			Where(strings.Join(aliasWhereParts, " OR "), aliasArgs...).
			Limit(candidateLimit).
			Find(&aliases).Error
		if err != nil {
			return nil, err
		}
	}

	seen := map[string]bool{}
	for _, f := range foods {
		seen[f.ID] = true
	}
	if len(aliases) > 0 {
		foodIDs := make([]string, 0, len(aliases))
		for _, a := range aliases {
			if !seen[a.FoodID] {
				foodIDs = append(foodIDs, a.FoodID)
			}
		}
		if len(foodIDs) > 0 {
			var extra []domain.PackagedFood
			err = r.db.WithContext(ctx).
				Where("is_active = ? AND id IN ?", true, foodIDs).
				Find(&extra).Error
			if err != nil {
				return nil, err
			}
			for _, f := range extra {
				if !seen[f.ID] {
					foods = append(foods, f)
					seen[f.ID] = true
				}
			}
		}
	}
	sort.SliceStable(foods, func(i, j int) bool {
		left := packagedFoodSearchScore(raw, foods[i])
		right := packagedFoodSearchScore(raw, foods[j])
		if left == right {
			if foods[i].NetWeightG == foods[j].NetWeightG {
				return foods[i].ProductName < foods[j].ProductName
			}
			return foods[i].NetWeightG > foods[j].NetWeightG
		}
		return left > right
	})
	if len(foods) > limit {
		foods = foods[:limit]
	}
	return foods, nil
}

func packagedFoodSearchTerms(query string) []string {
	raw := strings.TrimSpace(query)
	if raw == "" {
		return nil
	}
	seen := map[string]bool{}
	out := []string{}
	add := func(value string) {
		value = strings.TrimSpace(strings.ToLower(value))
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}
	add(raw)
	if normalized := normalizeFoodName(raw); normalized != "" {
		add(normalized)
	}
	var b strings.Builder
	var mode string
	flush := func() {
		if b.Len() == 0 {
			return
		}
		add(b.String())
		b.Reset()
		mode = ""
	}
	for _, r := range raw {
		nextMode := ""
		switch {
		case unicode.Is(unicode.Han, r):
			nextMode = "han"
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			nextMode = "latin"
		default:
			flush()
			continue
		}
		if mode != "" && mode != nextMode {
			flush()
		}
		mode = nextMode
		b.WriteRune(r)
	}
	flush()
	normalizedRaw := normalizeFoodName(raw)
	for _, keyword := range []string{
		"果冻爽", "果冻", "橙味", "橙汁", "葡萄味", "葡萄", "蜜桃味", "蜜桃", "苹果味", "苹果", "草莓味", "草莓",
		"冰淇淋", "雪糕", "蛋筒", "酸奶", "饮料", "汽水", "啤酒", "薯片", "饼干", "巧克力", "cici",
	} {
		if strings.Contains(normalizedRaw, normalizeFoodName(keyword)) || strings.Contains(strings.ToLower(raw), strings.ToLower(keyword)) {
			add(keyword)
		}
	}
	if len(out) > 12 {
		out = out[:12]
	}
	return out
}

func packagedFoodSearchScore(query string, food domain.PackagedFood) float64 {
	normalizedQuery := normalizeFoodName(query)
	brand := normalizeFoodName(food.Brand)
	productName := normalizeFoodName(food.ProductName)
	displayName := normalizeFoodName(food.DisplayName)
	storedSearchText := normalizeFoodName(food.SearchText)
	familyKey := normalizeFoodName(food.ProductFamilyKey)
	flavorText := normalizeFoodName(stringPtr(food.FlavorText))
	specText := normalizeFoodName(stringPtr(food.SpecText))
	category := normalizeFoodName(stringPtr(food.PackageCategory))
	ocrText := normalizeFoodName(stringPtr(food.OCRRawText))
	searchText := strings.Join(filterNonEmptyStrings(displayName, storedSearchText, familyKey, brand, productName, flavorText, specText, category, ocrText, normalizeFoodName(stringPtr(food.Barcode))), "")
	score := 0.0
	if normalizedQuery != "" {
		switch {
		case productName == normalizedQuery:
			score += 1.0
		case displayName == normalizedQuery:
			score += 0.98
		case strings.Contains(productName, normalizedQuery):
			score += 0.72
		case displayName != "" && strings.Contains(displayName, normalizedQuery):
			score += 0.7
		case strings.Contains(searchText, normalizedQuery):
			score += 0.58
		}
	}
	terms := packagedFoodSearchTerms(query)
	matchedTerms := 0
	for _, term := range terms {
		termNorm := normalizeFoodName(term)
		if termNorm == "" {
			continue
		}
		if runeCount(termNorm) < 2 && !isKnownShortFlavorTerm(termNorm) {
			continue
		}
		if strings.Contains(searchText, termNorm) {
			matchedTerms++
			weight := 0.08
			if termNorm == brand || strings.Contains(productName, termNorm) || strings.Contains(displayName, termNorm) {
				weight = 0.14
			}
			if flavorText != "" && strings.Contains(flavorText, termNorm) {
				weight = 0.18
			}
			score += weight
		}
	}
	if len(terms) > 0 {
		score += float64(matchedTerms) / float64(len(terms)) * 0.18
	}
	if brand != "" && strings.Contains(normalizedQuery, brand) {
		score += 0.12
	}
	if flavorText != "" && strings.Contains(normalizedQuery, flavorText) {
		score += 0.16
	}
	queryFlavorGroups := packagedFoodFlavorGroups(normalizedQuery)
	foodFlavorGroups := packagedFoodFlavorGroups(strings.Join([]string{displayName, productName, flavorText, ocrText}, ""))
	if len(queryFlavorGroups) > 0 {
		matchedFlavor := false
		for group := range queryFlavorGroups {
			if foodFlavorGroups[group] {
				matchedFlavor = true
				score += 0.35
			}
		}
		if !matchedFlavor && len(foodFlavorGroups) > 0 {
			score -= 0.22
		}
	}
	if food.NetWeightG > 0 && strings.Contains(normalizedQuery, normalizeFoodName(fmt.Sprintf("%.0fg", food.NetWeightG))) {
		score += 0.12
	}
	if food.NetContentValue > 0 && food.NetContentUnit != nil && strings.Contains(normalizedQuery, normalizeFoodName(formatContentAmount(food.NetContentValue, *food.NetContentUnit))) {
		score += 0.12
	}
	return score
}

func packagedFoodFlavorGroups(value string) map[string]bool {
	value = normalizeFoodName(value)
	if value == "" {
		return nil
	}
	groups := map[string][]string{
		"orange":     {"橙", "橙味", "橙汁", "橘", "柑橘"},
		"grape":      {"葡萄", "葡萄味", "葡萄汁", "红葡萄", "白葡萄"},
		"peach":      {"桃", "蜜桃", "黄桃", "桃味", "蜜桃味", "黄桃味"},
		"apple":      {"苹果", "苹果味", "苹果汁"},
		"strawberry": {"草莓", "草莓味"},
		"lemon":      {"柠檬", "柠檬味", "柠檬汁"},
	}
	out := map[string]bool{}
	for group, keywords := range groups {
		for _, keyword := range keywords {
			if strings.Contains(value, normalizeFoodName(keyword)) {
				out[group] = true
				break
			}
		}
	}
	return out
}

func stringPtr(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func runeCount(value string) int {
	return len([]rune(value))
}

func isKnownShortFlavorTerm(value string) bool {
	switch value {
	case "橙", "桃", "梨", "瓜", "莓", "葡萄", "苹果", "柠檬":
		return true
	default:
		return false
	}
}

func (r *FoodNutritionRepo) Search(ctx context.Context, query string, limit int) ([]domain.FoodNutrition, error) {
	candidates, err := r.SearchCandidates(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	foods := make([]domain.FoodNutrition, 0, len(candidates))
	for _, candidate := range candidates {
		foods = append(foods, candidate.Food)
	}
	return foods, nil
}

func (r *FoodNutritionRepo) SearchCandidates(ctx context.Context, query string, limit int) ([]SearchCandidate, error) {
	if limit <= 0 {
		limit = 5
	}
	raw := strings.TrimSpace(query)
	if raw == "" {
		return []SearchCandidate{}, nil
	}
	pattern := fmt.Sprintf("%%%s%%", strings.ToLower(raw))
	normalized := normalizeFoodName(raw)
	normalizedPattern := fmt.Sprintf("%%%s%%", normalized)

	type aliasRow struct {
		FoodID string `gorm:"column:food_id"`
	}
	var canonicalFoods []domain.FoodNutrition
	if err := r.db.WithContext(ctx).
		Where("is_active = ? AND (LOWER(canonical_name) LIKE ? OR normalized_name LIKE ?)", true, pattern, normalizedPattern).
		Limit(limit * 2).
		Find(&canonicalFoods).Error; err != nil {
		return nil, err
	}

	var aliasRows []aliasRow
	if err := r.db.WithContext(ctx).
		Table((&domain.FoodNutritionAlias{}).TableName()).
		Select("DISTINCT food_id").
		Where("LOWER(alias_name) LIKE ? OR normalized_alias LIKE ?", pattern, normalizedPattern).
		Limit(limit * 2).
		Find(&aliasRows).Error; err != nil {
		return nil, err
	}

	seen := map[string]SearchCandidate{}
	for _, food := range canonicalFoods {
		score := searchCandidateScore(raw, food.CanonicalName)
		matchSource := "canonical"
		if normalized != "" && food.NormalizedName == normalized {
			score = 0.99
		}
		if existing, ok := seen[food.ID]; !ok || score > existing.Score {
			seen[food.ID] = SearchCandidate{
				Food:        food,
				MatchSource: matchSource,
				Score:       score,
			}
		}
	}

	if len(aliasRows) > 0 {
		foodIDs := make([]string, 0, len(aliasRows))
		for _, row := range aliasRows {
			row.FoodID = strings.TrimSpace(row.FoodID)
			if row.FoodID == "" {
				continue
			}
			foodIDs = append(foodIDs, row.FoodID)
		}
		if len(foodIDs) > 0 {
			var aliasFoods []domain.FoodNutrition
			if err := r.db.WithContext(ctx).
				Where("is_active = ? AND id IN ?", true, foodIDs).
				Find(&aliasFoods).Error; err != nil {
				return nil, err
			}
			for _, food := range aliasFoods {
				score := searchCandidateScore(raw, food.CanonicalName) + 0.03
				if score > 0.99 {
					score = 0.99
				}
				if existing, ok := seen[food.ID]; !ok || score > existing.Score {
					seen[food.ID] = SearchCandidate{
						Food:        food,
						MatchSource: "alias",
						Score:       score,
					}
				}
			}
		}
	}

	candidates := make([]SearchCandidate, 0, len(seen))
	for _, candidate := range seen {
		candidates = append(candidates, candidate)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Score == candidates[j].Score {
			return candidates[i].Food.CanonicalName < candidates[j].Food.CanonicalName
		}
		return candidates[i].Score > candidates[j].Score
	})
	if len(candidates) > limit {
		candidates = candidates[:limit]
	}
	return candidates, nil
}

func (r *FoodNutritionRepo) GetUnresolvedTop(ctx context.Context, limit int) ([]domain.FoodUnresolvedLog, error) {
	if limit <= 0 {
		limit = 50
	}
	var rows []domain.FoodUnresolvedLog
	err := r.db.WithContext(ctx).
		Order("hit_count DESC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *FoodNutritionRepo) LogUnresolved(ctx context.Context, rawName string) error {
	if rawName == "" {
		return nil
	}
	normalized := normalizeUnresolvedName(rawName)
	var existing domain.FoodUnresolvedLog
	err := r.db.WithContext(ctx).
		Where("normalized_name = ?", normalized).
		First(&existing).Error
	if err == nil {
		return r.db.WithContext(ctx).
			Model(&domain.FoodUnresolvedLog{}).
			Where("id = ?", existing.ID).
			Update("hit_count", gorm.Expr("hit_count + 1")).Error
	}
	if err != gorm.ErrRecordNotFound {
		return err
	}
	row := domain.FoodUnresolvedLog{
		RawName:        strings.TrimSpace(rawName),
		NormalizedName: normalized,
		HitCount:       1,
	}
	return r.db.WithContext(ctx).Create(&row).Error
}

func normalizeUnresolvedName(raw string) string {
	return normalizeFoodName(raw)
}

func normalizeFoodName(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func buildPackagedProductKey(brand, productName, flavorText, specText string, netWeightG float64) string {
	fields := normalizePackagedProductFields(PackagedProductNormalizeInput{
		Brand:       brand,
		ProductName: productName,
		FlavorText:  flavorText,
		SpecText:    specText,
		NetWeightG:  netWeightG,
	})
	return fields.ProductKey
}

func normalizePackagedProductFields(input PackagedProductNormalizeInput) PackagedProductNormalizedFields {
	brand := strings.TrimSpace(input.Brand)
	productName := strings.TrimSpace(input.ProductName)
	flavor := strings.TrimSpace(input.FlavorText)
	spec := strings.TrimSpace(input.SpecText)
	parsed := parsePackagedSpec(spec + " " + input.OCRRawText)
	netWeight := nonNegative(input.NetWeightG)
	netValue := nonNegative(input.NetContentValue)
	netUnit := normalizeContentUnit(input.NetContentUnit)
	unitCount := nonNegative(input.UnitCount)
	unitValue := nonNegative(input.UnitContentValue)
	unitUnit := normalizeContentUnit(input.UnitContentUnit)
	if parsed.UnitCount > 0 && unitCount <= 0 {
		unitCount = parsed.UnitCount
	}
	if parsed.UnitContentValue > 0 && unitValue <= 0 {
		unitValue = parsed.UnitContentValue
		unitUnit = parsed.UnitContentUnit
	}
	if parsed.NetContentValue > 0 && netValue <= 0 {
		netValue = parsed.NetContentValue
		netUnit = parsed.NetContentUnit
	}
	if netValue <= 0 && unitValue > 0 && unitCount > 0 {
		netValue = round2(unitValue * unitCount)
		netUnit = unitUnit
	}
	if netValue <= 0 && netWeight > 0 {
		netValue = netWeight
		netUnit = "g"
	}
	if netWeight <= 0 && netValue > 0 && netUnit == "g" {
		netWeight = netValue
	}
	if unitUnit == "" && unitValue > 0 {
		unitUnit = netUnit
	}
	normalizedName := normalizeFoodName(productName)
	familyKey := strings.TrimSpace(input.ProductFamilyKey)
	if familyKey == "" {
		familyKey = strings.Join(filterNonEmptyStrings(normalizeFoodName(brand), normalizedName), "")
	} else {
		familyKey = normalizeFoodName(familyKey)
	}
	productKey := buildPackagedProductKeyFromFields(brand, productName, flavor, spec, netValue, netUnit, unitCount)
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		displayName = buildPackagedDisplayName(brand, productName, flavor, spec, netValue, netUnit, unitCount, unitValue, unitUnit)
	}
	searchText := strings.TrimSpace(input.SearchText)
	if searchText == "" {
		searchParts := []string{displayName, brand, productName, flavor, spec, input.Barcode, input.PackageCategory, input.OCRRawText}
		searchParts = append(searchParts, input.Aliases...)
		searchText = strings.Join(normalizeStringParts(searchParts), " ")
	}
	reviewStatus := strings.TrimSpace(input.ReviewStatus)
	if reviewStatus == "" {
		reviewStatus = "active"
	}
	return PackagedProductNormalizedFields{
		Brand:            brand,
		ProductName:      productName,
		NormalizedName:   normalizedName,
		ProductKey:       productKey,
		DisplayName:      displayName,
		SearchText:       searchText,
		ProductFamilyKey: familyKey,
		NetWeightG:       netWeight,
		NetContentValue:  netValue,
		NetContentUnit:   netUnit,
		UnitCount:        unitCount,
		UnitContentValue: unitValue,
		UnitContentUnit:  unitUnit,
		ReviewStatus:     reviewStatus,
	}
}

type packagedSpecParts struct {
	NetContentValue  float64
	NetContentUnit   string
	UnitCount        float64
	UnitContentValue float64
	UnitContentUnit  string
}

var (
	packagedSpecMulPattern        = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(g|克|kg|千克|ml|毫升|l|升)\s*[*x×]\s*(\d+(?:\.\d+)?)`)
	packagedSpecReverseMulPattern = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*[*x×]\s*(\d+(?:\.\d+)?)\s*(g|克|kg|千克|ml|毫升|l|升)`)
	packagedSpecUnitCountPattern  = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(g|克|kg|千克|ml|毫升|l|升)\s*(\d+(?:\.\d+)?)\s*(条|袋|支|包|瓶|罐|盒|枚|片|个)`)
	packagedSpecNetPattern        = regexp.MustCompile(`(?i)(?:净含量|净重|规格|net\s*(?:weight|content))\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(g|克|kg|千克|ml|毫升|l|升)`)
	packagedSpecCountPattern      = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(条|袋|支|包|瓶|罐|盒|枚|片|个)\s*装?`)
)

func parsePackagedSpec(text string) packagedSpecParts {
	text = strings.TrimSpace(text)
	out := packagedSpecParts{}
	if text == "" {
		return out
	}
	if match := packagedSpecMulPattern.FindStringSubmatch(text); len(match) == 4 {
		if unitValue := parsePositiveFloat(match[1]); unitValue > 0 {
			out.UnitContentValue = convertContentValue(unitValue, match[2])
			out.UnitContentUnit = normalizeContentUnit(match[2])
		}
		out.UnitCount = parsePositiveFloat(match[3])
	}
	if out.UnitContentValue <= 0 {
		if match := packagedSpecReverseMulPattern.FindStringSubmatch(text); len(match) == 4 {
			out.UnitCount = parsePositiveFloat(match[1])
			if unitValue := parsePositiveFloat(match[2]); unitValue > 0 {
				out.UnitContentValue = convertContentValue(unitValue, match[3])
				out.UnitContentUnit = normalizeContentUnit(match[3])
			}
		}
	}
	if out.UnitContentValue <= 0 {
		if match := packagedSpecUnitCountPattern.FindStringSubmatch(text); len(match) == 5 {
			if unitValue := parsePositiveFloat(match[1]); unitValue > 0 {
				out.UnitContentValue = convertContentValue(unitValue, match[2])
				out.UnitContentUnit = normalizeContentUnit(match[2])
			}
			out.UnitCount = parsePositiveFloat(match[3])
		}
	}
	if out.UnitCount <= 0 {
		if match := packagedSpecCountPattern.FindStringSubmatch(text); len(match) == 3 {
			out.UnitCount = parsePositiveFloat(match[1])
		}
	}
	if out.UnitContentValue > 0 && out.UnitCount > 0 {
		out.NetContentValue = round2(out.UnitContentValue * out.UnitCount)
		out.NetContentUnit = out.UnitContentUnit
	}
	if match := packagedSpecNetPattern.FindStringSubmatch(text); len(match) == 3 {
		value := convertContentValue(parsePositiveFloat(match[1]), match[2])
		unit := normalizeContentUnit(match[2])
		if value > 0 {
			out.NetContentValue = value
			out.NetContentUnit = unit
		}
	}
	return out
}

func buildPackagedProductKeyFromFields(brand, productName, flavorText, specText string, netValue float64, netUnit string, unitCount float64) string {
	brandKey := normalizeFoodName(brand)
	productKey := normalizeFoodName(productName)
	flavorKey := normalizeFoodName(flavorText)
	if flavorKey != "" && strings.Contains(productKey, flavorKey) {
		flavorKey = ""
	}
	contentKey := ""
	if netValue > 0 && netUnit != "" {
		contentKey = normalizeFoodName(formatContentAmount(netValue, netUnit))
	} else if specText != "" {
		contentKey = normalizeFoodName(specText)
	}
	countKey := ""
	if unitCount > 1 {
		countKey = normalizeFoodName(packagedCountLabel(specText, unitCount))
		if countKey == "" {
			countKey = normalizeFoodName(fmt.Sprintf("%s装", formatCleanNumber(unitCount)))
		}
	}
	if productKey == "" {
		return ""
	}
	return strings.Join(filterNonEmptyStrings(brandKey, productKey, flavorKey, contentKey, countKey), "")
}

func buildPackagedDisplayName(brand, productName, flavorText, specText string, netValue float64, netUnit string, unitCount, unitValue float64, unitUnit string) string {
	product := strings.TrimSpace(productName)
	flavor := strings.TrimSpace(flavorText)
	if flavor != "" && normalizeFoodName(product) != "" && strings.Contains(normalizeFoodName(product), normalizeFoodName(flavor)) {
		flavor = ""
	}
	specLabel := ""
	switch {
	case unitCount > 1 && unitValue > 0 && unitUnit != "":
		countLabel := packagedCountLabel(specText, unitCount)
		if countLabel == "" {
			countLabel = fmt.Sprintf("%s装", formatCleanNumber(unitCount))
		}
		specLabel = strings.TrimSpace(countLabel + " " + formatContentAmount(netValue, netUnit))
	case netValue > 0 && netUnit != "":
		specLabel = formatContentAmount(netValue, netUnit)
	case strings.TrimSpace(specText) != "":
		specLabel = strings.TrimSpace(specText)
	}
	return strings.Join(filterNonEmptyStrings(brand, product, flavor, specLabel), " ")
}

func packagedCountLabel(specText string, unitCount float64) string {
	if unitCount <= 1 {
		return ""
	}
	if match := packagedSpecCountPattern.FindStringSubmatch(specText); len(match) == 3 {
		if math.Abs(parsePositiveFloat(match[1])-unitCount) < 0.01 {
			return formatCleanNumber(unitCount) + match[2] + "装"
		}
	}
	return ""
}

func formatContentAmount(value float64, unit string) string {
	if value <= 0 || unit == "" {
		return ""
	}
	return formatCleanNumber(value) + unit
}

func formatCleanNumber(value float64) string {
	if value <= 0 {
		return "0"
	}
	if math.Abs(value-math.Round(value)) < 0.005 {
		return fmt.Sprintf("%.0f", math.Round(value))
	}
	return strconv.FormatFloat(round2(value), 'f', -1, 64)
}

func normalizeContentUnit(unit string) string {
	unit = strings.ToLower(strings.TrimSpace(unit))
	switch unit {
	case "g", "克", "gram", "grams":
		return "g"
	case "kg", "千克":
		return "g"
	case "ml", "毫升":
		return "ml"
	case "l", "升":
		return "ml"
	default:
		return ""
	}
}

func convertContentValue(value float64, unit string) float64 {
	unit = strings.ToLower(strings.TrimSpace(unit))
	switch unit {
	case "kg", "千克", "l", "升":
		return round2(value * 1000)
	default:
		return round2(value)
	}
}

func parsePositiveFloat(value string) float64 {
	out, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || out <= 0 {
		return 0
	}
	return out
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func normalizeStringParts(parts []string) []string {
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" || seen[part] {
			continue
		}
		seen[part] = true
		out = append(out, part)
	}
	return out
}

func stringFromMap(values map[string]any, key, fallback string) string {
	if value, ok := values[key]; ok {
		return strings.TrimSpace(fmt.Sprintf("%v", value))
	}
	return strings.TrimSpace(fallback)
}

func filterNonEmptyStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		out = append(out, value)
	}
	return out
}

func nullableTrimmedString(value string) any {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func normalizeStringSlice(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
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

func normalizeJSONMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(values))
	for key, value := range values {
		if strings.TrimSpace(key) == "" {
			continue
		}
		out[key] = value
	}
	if len(out) == 0 {
		return map[string]any{}
	}
	return out
}

func normalizePackagedFoodJSONFields(values map[string]any) error {
	defaults := map[string]any{
		"source_image_urls": []string{},
		"raw_label_payload": map[string]any{},
		"field_confidence":  map[string]any{},
	}
	for key, fallback := range defaults {
		value, ok := values[key]
		if !ok || value == nil {
			value = fallback
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("marshal packaged food json field %s: %w", key, err)
		}
		values[key] = datatypes.JSON(encoded)
	}
	return nil
}

func normalizePackagedFoodPatchJSONFields(values map[string]any) error {
	for _, key := range []string{"source_image_urls", "raw_label_payload", "field_confidence"} {
		value, ok := values[key]
		if !ok {
			continue
		}
		if value == nil {
			switch key {
			case "source_image_urls":
				value = []string{}
			default:
				value = map[string]any{}
			}
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("marshal packaged food json patch field %s: %w", key, err)
		}
		values[key] = datatypes.JSON(encoded)
	}
	return nil
}

func (r *FoodNutritionRepo) UpsertDeepSeekNutrition(ctx context.Context, rawName string, unit map[string]any, sources ...string) (string, error) {
	raw := strings.TrimSpace(rawName)
	normalized := normalizeFoodName(raw)
	if raw == "" || normalized == "" || len(unit) == 0 {
		return "", nil
	}
	source := "deepseek_v4_pro_auto"
	if len(sources) > 0 && strings.TrimSpace(sources[0]) != "" {
		source = strings.TrimSpace(sources[0])
	}
	var existing domain.FoodNutrition
	err := r.db.WithContext(ctx).Where("normalized_name = ?", normalized).First(&existing).Error
	if err == nil {
		if !existing.IsActive {
			updates := map[string]any{
				"kcal_per_100g":              number(unit["calories"]),
				"protein_per_100g":           number(unit["protein"]),
				"carbs_per_100g":             number(unit["carbs"]),
				"fat_per_100g":               number(unit["fat"]),
				"fiber_per_100g":             number(unit["fiber"]),
				"sugar_per_100g":             number(unit["sugar"]),
				"saturated_fat_per_100g":     number(unit["saturatedFat"]),
				"cholesterol_mg_per_100g":    number(unit["cholesterolMg"]),
				"sodium_mg_per_100g":         number(unit["sodiumMg"]),
				"potassium_mg_per_100g":      number(unit["potassiumMg"]),
				"calcium_mg_per_100g":        number(unit["calciumMg"]),
				"iron_mg_per_100g":           number(unit["ironMg"]),
				"magnesium_mg_per_100g":      number(unit["magnesiumMg"]),
				"zinc_mg_per_100g":           number(unit["zincMg"]),
				"vitamin_a_rae_mcg_per_100g": number(unit["vitaminARaeMcg"]),
				"vitamin_c_mg_per_100g":      number(unit["vitaminCMg"]),
				"vitamin_d_mcg_per_100g":     number(unit["vitaminDMcg"]),
				"vitamin_e_mg_per_100g":      number(unit["vitaminEMg"]),
				"vitamin_k_mcg_per_100g":     number(unit["vitaminKMcg"]),
				"thiamin_mg_per_100g":        number(unit["thiaminMg"]),
				"riboflavin_mg_per_100g":     number(unit["riboflavinMg"]),
				"niacin_mg_per_100g":         number(unit["niacinMg"]),
				"vitamin_b6_mg_per_100g":     number(unit["vitaminB6Mg"]),
				"folate_mcg_per_100g":        number(unit["folateMcg"]),
				"vitamin_b12_mcg_per_100g":   number(unit["vitaminB12Mcg"]),
				"source":                     source,
				"is_active":                  true,
			}
			if err := r.db.WithContext(ctx).Model(&domain.FoodNutrition{}).Where("id = ?", existing.ID).Updates(updates).Error; err != nil {
				return "", err
			}
			_ = r.createNutritionAlias(ctx, existing.ID, raw, normalized)
		}
		return existing.ID, nil
	}
	if err != gorm.ErrRecordNotFound {
		return "", err
	}
	if err := r.db.WithContext(ctx).Table((&domain.FoodNutrition{}).TableName()).Create(nutritionCreateValues(raw, normalized, unit, source)).Error; err != nil {
		return "", err
	}
	var created domain.FoodNutrition
	if err := r.db.WithContext(ctx).Where("normalized_name = ?", normalized).First(&created).Error; err != nil {
		return "", err
	}
	if created.ID != "" {
		_ = r.createNutritionAlias(ctx, created.ID, raw, normalized)
	}
	return created.ID, nil
}

func nutritionCreateValues(raw, normalized string, unit map[string]any, source string) map[string]any {
	return map[string]any{
		"canonical_name":             raw,
		"normalized_name":            normalized,
		"kcal_per_100g":              number(unit["calories"]),
		"protein_per_100g":           number(unit["protein"]),
		"carbs_per_100g":             number(unit["carbs"]),
		"fat_per_100g":               number(unit["fat"]),
		"fiber_per_100g":             number(unit["fiber"]),
		"sugar_per_100g":             number(unit["sugar"]),
		"saturated_fat_per_100g":     number(unit["saturatedFat"]),
		"cholesterol_mg_per_100g":    number(unit["cholesterolMg"]),
		"sodium_mg_per_100g":         number(unit["sodiumMg"]),
		"potassium_mg_per_100g":      number(unit["potassiumMg"]),
		"calcium_mg_per_100g":        number(unit["calciumMg"]),
		"iron_mg_per_100g":           number(unit["ironMg"]),
		"magnesium_mg_per_100g":      number(unit["magnesiumMg"]),
		"zinc_mg_per_100g":           number(unit["zincMg"]),
		"vitamin_a_rae_mcg_per_100g": number(unit["vitaminARaeMcg"]),
		"vitamin_c_mg_per_100g":      number(unit["vitaminCMg"]),
		"vitamin_d_mcg_per_100g":     number(unit["vitaminDMcg"]),
		"vitamin_e_mg_per_100g":      number(unit["vitaminEMg"]),
		"vitamin_k_mcg_per_100g":     number(unit["vitaminKMcg"]),
		"thiamin_mg_per_100g":        number(unit["thiaminMg"]),
		"riboflavin_mg_per_100g":     number(unit["riboflavinMg"]),
		"niacin_mg_per_100g":         number(unit["niacinMg"]),
		"vitamin_b6_mg_per_100g":     number(unit["vitaminB6Mg"]),
		"folate_mcg_per_100g":        number(unit["folateMcg"]),
		"vitamin_b12_mcg_per_100g":   number(unit["vitaminB12Mcg"]),
		"source":                     source,
		"is_active":                  true,
	}
}

func (r *FoodNutritionRepo) createNutritionAlias(ctx context.Context, foodID, raw, normalized string) error {
	if strings.TrimSpace(foodID) == "" || strings.TrimSpace(raw) == "" || strings.TrimSpace(normalized) == "" {
		return nil
	}
	return r.db.WithContext(ctx).
		Table((&domain.FoodNutritionAlias{}).TableName()).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(map[string]any{
			"food_id":          foodID,
			"alias_name":       raw,
			"normalized_alias": normalized,
		}).Error
}

func (r *FoodNutritionRepo) EnsureNutritionAlias(ctx context.Context, foodID, rawName string) error {
	raw := strings.TrimSpace(rawName)
	if strings.TrimSpace(foodID) == "" || raw == "" {
		return nil
	}
	return r.createNutritionAlias(ctx, foodID, raw, normalizeFoodName(raw))
}

func (r *FoodNutritionRepo) createPackagedFoodAlias(ctx context.Context, foodID, raw, normalized string) error {
	if strings.TrimSpace(foodID) == "" || strings.TrimSpace(raw) == "" || strings.TrimSpace(normalized) == "" {
		return nil
	}
	var count int64
	if err := r.db.WithContext(ctx).
		Table((&domain.PackagedFoodAlias{}).TableName()).
		Where("food_id = ? AND normalized_alias = ?", foodID, normalized).
		Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Table((&domain.PackagedFoodAlias{}).TableName()).
		Create(map[string]any{
			"id":               uuid.New().String(),
			"food_id":          foodID,
			"alias_name":       raw,
			"normalized_alias": normalized,
		}).Error
}

func nonNegative(value float64) float64 {
	if value < 0 {
		return 0
	}
	return value
}

func (r *FoodNutritionRepo) ListFoodsNeedingVitaminBackfill(ctx context.Context, limit int, offsets ...int) ([]domain.FoodNutrition, error) {
	if limit <= 0 {
		limit = 100
	}
	offset := 0
	if len(offsets) > 0 && offsets[0] > 0 {
		offset = offsets[0]
	}
	var foods []domain.FoodNutrition
	err := r.db.WithContext(ctx).
		Where(micronutrientBackfillWhere(), true).
		Order("CASE WHEN source LIKE '历史%' THEN 0 ELSE 1 END, canonical_name ASC, id ASC").
		Offset(offset).
		Limit(limit).
		Find(&foods).Error
	return foods, err
}

func (r *FoodNutritionRepo) CountFoodsNeedingVitaminBackfill(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).
		Model(&domain.FoodNutrition{}).
		Where(micronutrientBackfillWhere(), true).
		Count(&count).Error
	return count, err
}

func (r *FoodNutritionRepo) FillMissingDeepSeekNutrients(ctx context.Context, foodID string, unit map[string]any) ([]string, error) {
	foodID = strings.TrimSpace(foodID)
	if foodID == "" || len(unit) == 0 {
		return nil, nil
	}
	var food domain.FoodNutrition
	if err := r.db.WithContext(ctx).Where("id = ?", foodID).First(&food).Error; err != nil {
		return nil, err
	}
	updates := map[string]any{}
	filled := make([]string, 0, len(deepSeekFillOnlyColumns))
	for _, column := range deepSeekFillOnlyColumns {
		if column.Current(food) > 0 {
			continue
		}
		value := number(unit[column.UnitKey])
		if value <= 0 {
			continue
		}
		updates[column.Column] = value
		filled = append(filled, column.Column)
	}
	if len(updates) == 0 {
		return filled, nil
	}
	if err := r.db.WithContext(ctx).
		Model(&domain.FoodNutrition{}).
		Where("id = ?", foodID).
		Updates(updates).Error; err != nil {
		return nil, err
	}
	return filled, nil
}

func number(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case float32:
		return float64(v)
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case int32:
		return float64(v)
	default:
		return 0
	}
}

func searchCandidateScore(query, candidate string) float64 {
	q := strings.ToLower(strings.TrimSpace(query))
	value := strings.ToLower(strings.TrimSpace(candidate))
	if q == "" || value == "" {
		return 0
	}
	qNorm := normalizeFoodName(q)
	valueNorm := normalizeFoodName(value)
	switch {
	case value == q || valueNorm == qNorm:
		return 0.98
	case strings.HasPrefix(value, q) || strings.HasPrefix(valueNorm, qNorm):
		return 0.9
	case strings.Contains(value, q) || strings.Contains(valueNorm, qNorm):
		return 0.82
	default:
		return 0.68
	}
}
