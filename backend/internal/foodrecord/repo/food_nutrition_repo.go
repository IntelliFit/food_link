package repo

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"food_link/backend/internal/foodrecord/domain"

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

type PackagedResolveResult struct {
	Food        *domain.PackagedFood
	Status      string
	MatchSource string
	Score       float64
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

	var alias domain.FoodNutritionAlias
	err := r.db.WithContext(ctx).
		Where("LOWER(alias_name) = ? OR normalized_alias = ?", lower, normalized).
		First(&alias).Error
	if err == nil && alias.FoodID != "" {
		var food domain.FoodNutrition
		if foodErr := r.db.WithContext(ctx).Where("is_active = ? AND id = ?", true, alias.FoodID).First(&food).Error; foodErr == nil {
			return &ResolveResult{Food: &food, Status: "exact_alias", MatchSource: "alias", Score: 1}, nil
		} else if foodErr != gorm.ErrRecordNotFound {
			return nil, foodErr
		}
	} else if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	var food domain.FoodNutrition
	err = r.db.WithContext(ctx).
		Where("is_active = ? AND (LOWER(canonical_name) = ? OR normalized_name = ?)", true, lower, normalized).
		First(&food).Error
	if err == nil {
		return &ResolveResult{Food: &food, Status: "exact_canonical", MatchSource: "canonical", Score: 1}, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	candidates, err := r.Search(ctx, raw, 1)
	if err != nil {
		return nil, err
	}
	if len(candidates) > 0 {
		return &ResolveResult{Food: &candidates[0], Status: "fuzzy", MatchSource: "fuzzy", Score: 0.72}, nil
	}
	return &ResolveResult{Status: "unresolved", Score: 0}, nil
}

func (r *FoodNutritionRepo) ResolvePackagedFood(ctx context.Context, name string) (*PackagedResolveResult, error) {
	raw := strings.TrimSpace(name)
	if raw == "" {
		return &PackagedResolveResult{Status: "unresolved", Score: 0}, nil
	}
	lower := strings.ToLower(raw)
	normalized := normalizeFoodName(raw)

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
	if limit <= 0 {
		limit = 5
	}
	pattern := fmt.Sprintf("%%%s%%", strings.ToLower(query))
	normalizedPattern := fmt.Sprintf("%%%s%%", normalizeFoodName(query))
	var foods []domain.FoodNutrition
	err := r.db.WithContext(ctx).
		Where("is_active = ? AND LOWER(canonical_name) LIKE ?", true, pattern).
		Limit(limit).
		Find(&foods).Error
	if err != nil {
		return nil, err
	}

	var aliases []domain.FoodNutritionAlias
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
			var extra []domain.FoodNutrition
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
