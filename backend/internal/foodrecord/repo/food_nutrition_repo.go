package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
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
	Name       string
	Brand      string
	SpecText   string
	NetWeightG float64
	Barcode    string
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
	productKey := buildPackagedProductKey(brand, raw, specText, input.NetWeightG)

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
		err := r.db.WithContext(ctx).
			Where("is_active = ? AND product_key = ?", true, productKey).
			First(&productKeyFood).Error
		if err == nil {
			return &PackagedResolveResult{Food: &productKeyFood, Status: "product_key", MatchSource: "product_key", Score: 1}, nil
		}
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
	}

	var alias domain.PackagedFoodAlias
	err := r.db.WithContext(ctx).
		Where("LOWER(alias_name) = ? OR normalized_alias = ?", lower, normalized).
		First(&alias).Error
	if err == nil && alias.FoodID != "" {
		var food domain.PackagedFood
		if foodErr := r.db.WithContext(ctx).Where("is_active = ? AND id = ?", true, alias.FoodID).First(&food).Error; foodErr == nil {
			return &PackagedResolveResult{Food: &food, Status: "exact_alias", MatchSource: "alias", Score: 1}, nil
		} else if foodErr != gorm.ErrRecordNotFound {
			return nil, foodErr
		}
	} else if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	var food domain.PackagedFood
	err = r.db.WithContext(ctx).
		Where("is_active = ? AND (LOWER(product_name) = ? OR normalized_name = ?)", true, lower, normalized).
		First(&food).Error
	if err == nil {
		return &PackagedResolveResult{Food: &food, Status: "exact_canonical", MatchSource: "canonical", Score: 1}, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	candidates, err := r.SearchPackagedFood(ctx, raw, 1)
	if err != nil {
		return nil, err
	}
	if len(candidates) > 0 {
		return &PackagedResolveResult{Food: &candidates[0], Status: "fuzzy", MatchSource: "fuzzy", Score: 0.72}, nil
	}
	return &PackagedResolveResult{Status: "unresolved", Score: 0}, nil
}

func (r *FoodNutritionRepo) UpsertPackagedFood(ctx context.Context, input PackagedFoodInput) (*domain.PackagedFood, error) {
	item, _, err := r.UpsertPackagedFoodWithAction(ctx, input)
	return item, err
}

func (r *FoodNutritionRepo) UpsertPackagedFoodWithAction(ctx context.Context, input PackagedFoodInput) (*domain.PackagedFood, string, error) {
	productName := strings.TrimSpace(input.ProductName)
	normalized := normalizeFoodName(productName)
	productKey := buildPackagedProductKey(input.Brand, productName, input.SpecText, input.NetWeightG)
	if productName == "" || normalized == "" || productKey == "" {
		return nil, "", fmt.Errorf("product_name is required")
	}
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "user_submitted"
	}
	values := map[string]any{
		"brand":                      strings.TrimSpace(input.Brand),
		"product_name":               productName,
		"normalized_name":            normalized,
		"product_key":                productKey,
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
		"net_weight_g":               nonNegative(input.NetWeightG),
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

	var existing domain.PackagedFood
	err := r.db.WithContext(ctx).
		Where("product_key = ? OR normalized_name = ? OR (barcode IS NOT NULL AND barcode <> '' AND barcode = ?)", productKey, normalized, strings.TrimSpace(input.Barcode)).
		Order(gorm.Expr("CASE WHEN barcode = ? THEN 0 WHEN product_key = ? THEN 1 ELSE 2 END", strings.TrimSpace(input.Barcode), productKey)).
		First(&existing).Error
	if err == nil {
		if err := r.db.WithContext(ctx).Model(&domain.PackagedFood{}).Where("id = ?", existing.ID).Updates(values).Error; err != nil {
			return nil, "", err
		}
		_ = r.createPackagedFoodAlias(ctx, existing.ID, productName, normalized)
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
	_ = r.createPackagedFoodAlias(ctx, id, productName, normalized)
	var created domain.PackagedFood
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&created).Error; err != nil {
		return nil, "", err
	}
	return &created, "created", nil
}

func (r *FoodNutritionRepo) SearchPackagedFood(ctx context.Context, query string, limit int) ([]domain.PackagedFood, error) {
	if limit <= 0 {
		limit = 5
	}
	pattern := fmt.Sprintf("%%%s%%", strings.ToLower(query))
	normalizedPattern := fmt.Sprintf("%%%s%%", normalizeFoodName(query))
	var foods []domain.PackagedFood
	err := r.db.WithContext(ctx).
		Where("is_active = ? AND (LOWER(product_name) LIKE ? OR LOWER(brand) LIKE ?)", true, pattern, pattern).
		Limit(limit).
		Find(&foods).Error
	if err != nil {
		return nil, err
	}

	var aliases []domain.PackagedFoodAlias
	err = r.db.WithContext(ctx).
		Where("LOWER(alias_name) LIKE ? OR normalized_alias LIKE ?", pattern, normalizedPattern).
		Limit(limit).
		Find(&aliases).Error
	if err != nil {
		return nil, err
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
	if len(foods) > limit {
		foods = foods[:limit]
	}
	return foods, nil
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

func buildPackagedProductKey(brand, productName, specText string, netWeightG float64) string {
	brandKey := normalizeFoodName(brand)
	productKey := normalizeFoodName(productName)
	specKey := normalizeFoodName(specText)
	switch {
	case productKey == "":
		return ""
	case specKey != "":
		return strings.TrimSpace(strings.Join(filterNonEmptyStrings(brandKey, productKey, specKey), ""))
	case netWeightG > 0:
		weightKey := normalizeFoodName(strings.TrimSpace(fmt.Sprintf("%.2fg", netWeightG)))
		return strings.TrimSpace(strings.Join(filterNonEmptyStrings(brandKey, productKey, weightKey), ""))
	default:
		return strings.TrimSpace(strings.Join(filterNonEmptyStrings(brandKey, productKey), ""))
	}
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
	return r.db.WithContext(ctx).
		Table((&domain.PackagedFoodAlias{}).TableName()).
		Clauses(clause.OnConflict{DoNothing: true}).
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
