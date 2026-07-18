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

type NutritionEmbeddingSource struct {
	IdentityKey   string
	FoodID        string
	SourceType    string
	SourceID      string
	EmbeddingText string
}

type NutritionEmbeddingIndexRow struct {
	IdentityKey    string
	FoodID         string
	EmbeddingBytes []byte
}

type PackagedResolveResult struct {
	Food        *domain.PackagedFood
	Status      string
	MatchSource string
	Score       float64
}

func activePackagedFoodScope(db *gorm.DB) *gorm.DB {
	return db.Where("COALESCE(NULLIF(review_status, ''), 'active') = ?", "active")
}

func pendingPackagedFoodScope(db *gorm.DB) *gorm.DB {
	return db.Where("review_status = ?", "pending")
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
	// Direct nutrition reuse is intentionally stricter than candidate search.
	// It may normalize punctuation, safe synonyms and quantity words, but it
	// must never drop preparation/state words or use a partial-name heuristic.
	variants := nutritionExactQueryVariants(raw)

	for _, variant := range variants {
		var food domain.FoodNutrition
		err := r.db.WithContext(ctx).
			Where("is_active = ? AND (LOWER(canonical_name) = ? OR normalized_name = ?)", true, strings.ToLower(variant.Text), variant.Normalized).
			First(&food).Error
		if err == nil {
			if isAutoMatchEligibleNutritionFood(food) && !isImplausibleNutritionFoodMatch(raw, food) {
				return &ResolveResult{Food: &food, Status: "exact_canonical", MatchSource: variant.matchSource("canonical"), Score: 1}, nil
			}
			continue
		}
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
	}

	for _, variant := range variants {
		var alias domain.FoodNutritionAlias
		err := r.db.WithContext(ctx).
			Where("LOWER(alias_name) = ? OR normalized_alias = ?", strings.ToLower(variant.Text), variant.Normalized).
			First(&alias).Error
		if err == nil {
			if alias.FoodID != "" && domain.IsApprovedExactNutritionAlias(alias.MatchStatus) {
				var food domain.FoodNutrition
				if foodErr := r.db.WithContext(ctx).Where("is_active = ? AND id = ?", true, alias.FoodID).First(&food).Error; foodErr == nil {
					if isAutoMatchEligibleNutritionFood(food) && !isUnsafeNutritionAliasMatch(raw, alias.AliasName, food.CanonicalName) && !isImplausibleNutritionFoodMatch(raw, food) {
						return &ResolveResult{Food: &food, Status: "exact_alias", MatchSource: variant.matchSource("alias"), Score: 1}, nil
					}
				} else if foodErr != gorm.ErrRecordNotFound {
					return nil, foodErr
				}
			}
			continue
		}
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
	}

	// Fuzzy search is candidate recall only. The analyze service may ask a
	// small model to confirm one of those candidates, but the repository never
	// upgrades a top-1 lexical result into a nutrition match by itself.
	return &ResolveResult{Status: "unresolved", Score: 0}, nil
}

func isAutoMatchEligibleNutritionFood(food domain.FoodNutrition) bool {
	return domain.IsNutritionExactMatchEligible(food)
}

func isCandidateMatchEligibleNutritionFood(food domain.FoodNutrition) bool {
	return domain.IsNutritionCandidateMatchEligible(food)
}

func allNutritionAliasesUnsafe(query string, aliasNames []string, canonicalName string) bool {
	if len(aliasNames) == 0 {
		return false
	}
	for _, aliasName := range aliasNames {
		if !isUnsafeNutritionAliasMatch(query, aliasName, canonicalName) {
			return false
		}
	}
	return true
}

func isUnsafeNutritionAliasMatch(query, aliasName, canonicalName string) bool {
	queryNorm := normalizeFoodName(query)
	aliasNorm := normalizeFoodName(aliasName)
	canonicalNorm := normalizeFoodName(canonicalName)
	if queryNorm == "" || canonicalNorm == "" || queryNorm == canonicalNorm {
		return false
	}
	queryText := queryNorm + aliasNorm
	processedTokens := []string{"肠", "香肠", "火腿", "热狗", "肉肠", "鱼肠", "鸡肉肠", "玉米肠"}
	if containsAnyToken(canonicalNorm, processedTokens) && !containsAnyToken(queryText, processedTokens) {
		return true
	}
	if containsCJK(queryNorm) && isMostlyASCII(canonicalName) {
		return true
	}
	if isNutritionMixedDishName(queryText) && !isNutritionMixedDishName(canonicalNorm) && containsAnyToken(canonicalNorm, nutritionIngredientTokens) {
		return true
	}
	if isNutritionDryForm(queryText) && !isNutritionDryForm(canonicalNorm) && containsAnyToken(canonicalNorm, nutritionLiquidTokens) {
		return true
	}
	if isFreshFruitToProcessedProductMismatch(queryText, canonicalNorm) {
		return true
	}
	return false
}

var nutritionMixedDishTokens = []string{
	"面", "饭", "粥", "饺", "馄饨", "云吞", "包子", "披萨", "汉堡", "麻辣烫",
	"盖浇", "便当", "套餐", "咖喱", "沙拉", "米线", "河粉",
	"noodle", "rice", "sandwich", "platter", "menu", "burger", "pizza", "cereal",
	"macaroni", "lasagna", "dumpling", "bagel", "entree", "croissant",
}

var nutritionIngredientTokens = []string{
	"肉", "牛", "猪", "鸡", "鸭", "羊", "鱼", "虾", "蛋", "豆腐", "菜", "玉米",
	"beef", "pork", "chicken", "lamb", "duck", "fish", "shrimp", "egg", "tofu",
}

var nutritionLiquidTokens = []string{"豆浆", "牛奶", "奶", "茶", "咖啡", "果汁", "饮料", "汤", "milk", "juice", "drink", "beverage"}

var nutritionStarchDishTokens = []string{
	"面", "饭", "粥", "饺", "馄饨", "云吞", "包子", "馒头", "面包", "披萨", "汉堡", "米线", "河粉",
	"noodle", "rice", "porridge", "dumpling", "bun", "bread", "pizza", "burger", "macaroni", "lasagna", "bagel",
}

func isNutritionMixedDishName(text string) bool {
	if containsAnyToken(text, nutritionMixedDishTokens) {
		return true
	}
	return strings.Contains(text, "粉") && containsAnyToken(text, []string{"红烧", "炒", "汤", "酸辣", "螺蛳"})
}

func isNutritionDryForm(text string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(text))
	return strings.HasSuffix(trimmed, "粉") || containsAnyToken(trimmed, []string{"干粉", "powder", "flour", "dried", "dehydrated"})
}

func isImplausibleNutritionFoodMatch(query string, food domain.FoodNutrition) bool {
	normalized := normalizeFoodName(query)
	starchyDish := containsAnyToken(normalized, nutritionStarchDishTokens) ||
		(strings.Contains(normalized, "粉") && containsAnyToken(normalized, []string{"红烧", "炒", "汤", "酸辣", "螺蛳"}))
	if starchyDish && food.CarbsPer100g <= 2 {
		return true
	}
	canonical := normalizeFoodName(food.CanonicalName)
	if isFreshFruitToProcessedProductMismatch(normalized, canonical) {
		return true
	}
	return isHydratedFoodToDryNutritionMismatch(normalized, canonical, food)
}

var nutritionFruitTokens = []string{
	"桃", "苹果", "梨", "葡萄", "草莓", "蓝莓", "樱桃", "橙", "橘", "柑", "柚",
	"香蕉", "芒果", "菠萝", "凤梨", "猕猴桃", "西瓜", "哈密瓜", "山楂", "杏", "李子",
}

var nutritionProcessedFruitTokens = []string{
	"糖", "软糖", "果脯", "果干", "蜜饯", "冻干", "罐头", "果酱", "果汁", "饮料", "果粉", "糖水",
}

func isFreshFruitToProcessedProductMismatch(query, canonical string) bool {
	if query == "" || canonical == "" {
		return false
	}
	if containsAnyToken(query, nutritionProcessedFruitTokens) {
		return false
	}
	sharedFruit := false
	for _, token := range nutritionFruitTokens {
		if strings.Contains(query, token) && strings.Contains(canonical, token) {
			sharedFruit = true
			break
		}
	}
	return sharedFruit && containsAnyToken(canonical, nutritionProcessedFruitTokens)
}

var nutritionHydratedCues = []string{
	"泡发", "泡开", "泡好", "水泡", "泡水", "浸泡", "泡过", "煮熟", "煮好", "熬煮", "熟重", "湿重", "粥", "糊",
}

var nutritionPreparedCues = []string{
	"泡发", "泡开", "水泡", "浸泡", "煮", "熟", "粥", "糊", "饭", "汤", "饮",
}

var nutritionHydratableStaples = []string{
	"燕麦", "麦片", "大米", "小米", "糙米", "藜麦", "薏米", "红豆", "绿豆", "黄豆", "木耳", "银耳", "腐竹", "粉条", "宽粉", "粉丝", "米粉",
}

func isHydratedFoodToDryNutritionMismatch(query, canonical string, food domain.FoodNutrition) bool {
	if !containsAnyToken(query, nutritionHydratedCues) || containsAnyToken(query, []string{"干重", "干燕麦", "干麦片", "未泡"}) {
		return false
	}
	if !containsAnyToken(query, nutritionHydratableStaples) || containsAnyToken(canonical, nutritionPreparedCues) {
		return false
	}
	return food.KcalPer100g >= 250 || food.CarbsPer100g >= 45
}

// ValidateNutritionAliasTarget applies the same hard safety gates used by
// runtime matching. Admin approval and automated proposal generation must call
// this before an alias can enter food_nutrition_aliases.
func ValidateNutritionAliasTarget(aliasName string, food domain.FoodNutrition) error {
	raw := strings.TrimSpace(aliasName)
	if raw == "" {
		return fmt.Errorf("营养别名不能为空")
	}
	if strings.TrimSpace(food.ID) == "" || !food.IsActive {
		return fmt.Errorf("营养别名目标不存在或已停用")
	}
	if !domain.IsNutritionExactMatchEligible(food) {
		return fmt.Errorf("营养别名目标尚未达到精确复用可信等级")
	}
	if isUnsafeNutritionAliasMatch(raw, raw, food.CanonicalName) {
		return fmt.Errorf("形态或食物层级不兼容: %s -> %s", raw, food.CanonicalName)
	}
	if isImplausibleNutritionFoodMatch(raw, food) {
		return fmt.Errorf("主食碳水合理性校验失败: %s -> %s", raw, food.CanonicalName)
	}
	return nil
}

func containsAnyToken(text string, tokens []string) bool {
	for _, token := range tokens {
		if token != "" && strings.Contains(text, token) {
			return true
		}
	}
	return false
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
		err := activePackagedFoodScope(r.db.WithContext(ctx)).
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
		query := activePackagedFoodScope(r.db.WithContext(ctx)).
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
			if foodErr := activePackagedFoodScope(r.db.WithContext(ctx)).
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
	err = activePackagedFoodScope(r.db.WithContext(ctx)).
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

	if isGenericPackagedResolveQuery(raw) && !hasPackagedResolveEvidence(brand, specText, input.FlavorText, barcode) {
		return &PackagedResolveResult{Status: "unresolved", Score: 0}, nil
	}

	// Product-name similarity is useful for showing candidates, but it cannot
	// prove product identity or package weight. Only barcode, product key,
	// approved exact alias or an unambiguous exact canonical row may resolve a
	// packaged food automatically. Callers can still use SearchPackagedFood to
	// present/inspect candidates.
	return &PackagedResolveResult{Status: "unresolved", Score: 0}, nil
}

func packagedFoodFuzzyQuery(values ...string) string {
	parts := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := strings.ToLower(value)
		if seen[key] {
			continue
		}
		seen[key] = true
		parts = append(parts, value)
	}
	return strings.Join(parts, " ")
}

func hasPackagedResolveEvidence(values ...string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return true
		}
	}
	return false
}

func isGenericPackagedResolveQuery(query string) bool {
	normalized := normalizeFoodName(query)
	if normalized == "" {
		return false
	}
	switch normalized {
	case "面包", "酸奶", "咖啡", "饮料", "零食", "雪糕", "冰淇淋", "薯片", "饼干", "巧克力", "奶茶", "果汁", "汽水", "啤酒":
		return true
	default:
		return false
	}
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
	lookupDB := r.db.WithContext(ctx)
	if normalizedFields.ReviewStatus == "pending" {
		lookupDB = pendingPackagedFoodScope(lookupDB)
	}
	if barcode != "" {
		err = lookupDB.
			Where("barcode IS NOT NULL AND barcode <> '' AND barcode = ?", barcode).
			First(&existing).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return nil, "", err
		}
	}
	if err == gorm.ErrRecordNotFound {
		query := lookupDB.Where("product_key = ?", normalizedFields.ProductKey)
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
	if candidateLimit < 800 {
		candidateLimit = 800
	}
	if candidateLimit > 1500 {
		candidateLimit = 1500
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
	err := activePackagedFoodScope(r.db.WithContext(ctx)).
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
			err = activePackagedFoodScope(r.db.WithContext(ctx)).
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
	filtered := foods[:0]
	for _, food := range foods {
		if packagedFoodProductTypeConflict(raw, food) {
			continue
		}
		if !packagedFoodHasSearchAnchor(raw, food) {
			continue
		}
		filtered = append(filtered, food)
	}
	foods = filtered
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
		"果冻爽", "果粒爽", "果冻", "橙味", "橙汁", "葡萄味", "葡萄", "蜜桃味", "蜜桃", "苹果味", "苹果", "草莓味", "草莓", "番茄味", "番茄",
		"冰淇淋", "雪糕", "蛋筒", "酸奶", "牛乳", "饮料", "汽水", "咖啡", "固体饮料", "啤酒", "薯片", "原切", "马铃薯片", "饼干", "巧克力", "面包", "豆沙小饼", "豆沙", "小饼", "花生夹心", "花生", "蛋白粉", "酵母蛋白", "乳清蛋白", "增肌粉", "桃李", "雀巢", "nescafe", "三得利", "suntory", "纤漾饮", "荷叶", "茉莉", "无糖", "士力架", "snickers", "cici",
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
	if packagedFoodProductTypeConflict(query, food) {
		return -1
	}
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
	if packagedFoodHasBrandAnchor(normalizedQuery, food) {
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

func packagedFoodProductTypeConflict(query string, food domain.PackagedFood) bool {
	queryType := packagedFoodProductType(normalizeFoodName(query))
	if queryType == "" {
		return false
	}
	foodText := normalizeFoodName(strings.Join(filterNonEmptyStrings(
		food.Brand,
		food.ProductName,
		food.DisplayName,
		stringPtr(food.PackageCategory),
		stringPtr(food.FlavorText),
		stringPtr(food.SpecText),
	), " "))
	foodType := packagedFoodProductType(foodText)
	if queryType == "protein_powder" {
		return foodType != "protein_powder"
	}
	return false
}

func packagedFoodHasSearchAnchor(query string, food domain.PackagedFood) bool {
	normalizedQuery := normalizeFoodName(query)
	identityText := packagedFoodIdentityText(food)
	if normalizedQuery == "" || identityText == "" {
		return false
	}
	if queryType := packagedFoodProductType(normalizedQuery); queryType != "" {
		required := packagedFoodProductTypeRequiredKeyword(queryType)
		if required != "" && !strings.Contains(identityText, required) {
			return false
		}
	}
	if packagedFoodHasExactOrContainmentAnchor(normalizedQuery, food, identityText) {
		return true
	}
	if packagedFoodHasBrandAnchor(normalizedQuery, food) {
		return true
	}
	if packagedFoodHasSpecAnchor(normalizedQuery, food) {
		return true
	}
	return packagedFoodStrongTermCount(query, identityText) > 0
}

func packagedFoodHasAutoResolveAnchor(query string, food domain.PackagedFood) bool {
	normalizedQuery := normalizeFoodName(query)
	identityText := packagedFoodIdentityText(food)
	if normalizedQuery == "" || identityText == "" {
		return false
	}
	if queryType := packagedFoodProductType(normalizedQuery); queryType != "" {
		required := packagedFoodProductTypeRequiredKeyword(queryType)
		if required != "" && !strings.Contains(identityText, required) {
			return false
		}
	}
	if packagedFoodHasExactOrContainmentAnchor(normalizedQuery, food, identityText) {
		return true
	}
	hasBrand := packagedFoodHasBrandAnchor(normalizedQuery, food)
	hasSpec := packagedFoodHasSpecAnchor(normalizedQuery, food)
	coreCount := packagedFoodCoreTermCount(query, identityText, food)
	weakCount := packagedFoodWeakIdentityTermCount(query, identityText)
	if hasBrand && (coreCount > 0 || hasSpec || weakCount >= 2) {
		return true
	}
	if hasSpec && (coreCount > 0 || weakCount > 0) {
		return true
	}
	return coreCount >= 2
}

func packagedFoodHasExactOrContainmentAnchor(normalizedQuery string, food domain.PackagedFood, identityText string) bool {
	productName := normalizeFoodName(food.ProductName)
	displayName := normalizeFoodName(food.DisplayName)
	if productName != "" && productName == normalizedQuery {
		return true
	}
	if displayName != "" && displayName == normalizedQuery {
		return true
	}
	return runeCount(normalizedQuery) >= 6 && strings.Contains(identityText, normalizedQuery)
}

func packagedFoodHasBrandAnchor(normalizedQuery string, food domain.PackagedFood) bool {
	for _, brandTerm := range packagedFoodBrandTerms(food.Brand) {
		if strings.Contains(normalizedQuery, brandTerm) {
			return true
		}
	}
	return false
}

func packagedFoodHasSpecAnchor(normalizedQuery string, food domain.PackagedFood) bool {
	if food.NetWeightG > 0 && strings.Contains(normalizedQuery, normalizeFoodName(fmt.Sprintf("%.0fg", food.NetWeightG))) {
		return true
	}
	if food.NetContentValue > 0 && food.NetContentUnit != nil && strings.Contains(normalizedQuery, normalizeFoodName(formatContentAmount(food.NetContentValue, *food.NetContentUnit))) {
		return true
	}
	specText := normalizeFoodName(stringPtr(food.SpecText))
	return specText != "" && runeCount(specText) >= 3 && strings.Contains(normalizedQuery, specText)
}

func packagedFoodStrongTermCount(query string, identityText string) int {
	count := 0
	seen := map[string]bool{}
	for _, term := range packagedFoodSearchTerms(query) {
		termNorm := normalizeFoodName(term)
		if termNorm == "" || seen[termNorm] || packagedFoodWeakMatchTerm(termNorm) {
			continue
		}
		seen[termNorm] = true
		if strings.Contains(identityText, termNorm) {
			count++
		}
	}
	return count
}

func packagedFoodCoreTermCount(query string, identityText string, food domain.PackagedFood) int {
	count := 0
	seen := map[string]bool{}
	brandTerms := map[string]bool{}
	for _, brandTerm := range packagedFoodBrandTerms(food.Brand) {
		brandTerms[brandTerm] = true
	}
	for _, term := range packagedFoodSearchTerms(query) {
		termNorm := normalizeFoodName(term)
		if termNorm == "" || seen[termNorm] || packagedFoodWeakMatchTerm(termNorm) || brandTerms[termNorm] {
			continue
		}
		seen[termNorm] = true
		if strings.Contains(identityText, termNorm) {
			count++
		}
	}
	return count
}

func packagedFoodWeakIdentityTermCount(query string, identityText string) int {
	count := 0
	seen := map[string]bool{}
	for _, term := range packagedFoodSearchTerms(query) {
		termNorm := normalizeFoodName(term)
		if termNorm == "" || seen[termNorm] || !packagedFoodWeakMatchTerm(termNorm) {
			continue
		}
		seen[termNorm] = true
		if strings.Contains(identityText, termNorm) {
			count++
		}
	}
	return count
}

func packagedFoodBrandTerms(brand string) []string {
	brand = strings.TrimSpace(brand)
	if brand == "" {
		return nil
	}
	seen := map[string]bool{}
	out := []string{}
	add := func(value string) {
		value = normalizeFoodName(value)
		if value == "" || runeCount(value) < 2 || seen[value] {
			return
		}
		seen[value] = true
		out = append(out, value)
	}
	add(brand)
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
	for _, r := range brand {
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
	return out
}

func packagedFoodWeakMatchTerm(term string) bool {
	if term == "" {
		return true
	}
	if runeCount(term) < 2 && !isKnownShortFlavorTerm(term) {
		return true
	}
	weakTerms := []string{
		"橙味", "橙汁", "葡萄味", "葡萄", "蜜桃味", "蜜桃", "苹果味", "苹果", "草莓味", "草莓", "番茄味", "番茄", "黄桃", "蓝莓", "蔓越莓",
		"荷叶", "茉莉", "无糖", "低糖", "原味", "风味", "口味",
		"零食", "雪糕", "冰淇淋", "酸奶", "牛乳", "乳", "饮料", "汽水", "咖啡", "固体饮料", "啤酒", "薯片", "饼干", "巧克力", "面包",
	}
	for _, weak := range weakTerms {
		if term == normalizeFoodName(weak) {
			return true
		}
	}
	return false
}

func packagedFoodIdentityText(food domain.PackagedFood) string {
	return normalizeFoodName(strings.Join(filterNonEmptyStrings(
		food.Brand,
		food.ProductName,
		food.DisplayName,
		food.ProductFamilyKey,
		stringPtr(food.PackageCategory),
		stringPtr(food.FlavorText),
		stringPtr(food.SpecText),
		normalizeFoodName(stringPtr(food.Barcode)),
	), " "))
}

func packagedFoodProductTypeRequiredKeyword(productType string) string {
	switch productType {
	case "protein_powder":
		return "蛋白"
	default:
		return ""
	}
}

func packagedFoodProductType(text string) string {
	if text == "" {
		return ""
	}
	if strings.Contains(text, "蛋白粉") || strings.Contains(text, "乳清蛋白") || strings.Contains(text, "增肌粉") || strings.Contains(text, "酵母蛋白") {
		return "protein_powder"
	}
	if strings.Contains(text, "酸奶") || strings.Contains(text, "酸牛奶") || strings.Contains(text, "发酵乳") || strings.Contains(text, "风味发酵乳") || strings.Contains(text, "乳酸菌") {
		return "fermented_milk"
	}
	return ""
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
		"tomato":     {"番茄", "番茄味", "西红柿"},
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
	variants := nutritionQueryVariants(raw)

	type aliasRow struct {
		FoodID          string `gorm:"column:food_id"`
		AliasName       string `gorm:"column:alias_name"`
		NormalizedAlias string `gorm:"column:normalized_alias"`
		MatchStatus     string `gorm:"column:match_status"`
	}
	var canonicalFoods []domain.FoodNutrition
	var aliasRows []aliasRow
	canonicalVariantByFoodID := map[string]nutritionQueryVariant{}
	aliasVariantsByFoodID := map[string][]nutritionQueryVariant{}
	for _, variant := range variants {
		pattern := fmt.Sprintf("%%%s%%", strings.ToLower(variant.Text))
		normalizedPattern := fmt.Sprintf("%%%s%%", variant.Normalized)
		var foods []domain.FoodNutrition
		if err := r.db.WithContext(ctx).
			Where("is_active = ? AND (LOWER(canonical_name) LIKE ? OR normalized_name LIKE ?)", true, pattern, normalizedPattern).
			Limit(limit * 4).
			Find(&foods).Error; err != nil {
			return nil, err
		}
		for _, food := range foods {
			canonicalFoods = append(canonicalFoods, food)
			if existing, ok := canonicalVariantByFoodID[food.ID]; !ok || variant.Weight > existing.Weight {
				canonicalVariantByFoodID[food.ID] = variant
			}
		}
		var rows []aliasRow
		if err := r.db.WithContext(ctx).
			Table((&domain.FoodNutritionAlias{}).TableName()).
			Select("food_id, alias_name, normalized_alias, match_status").
			Where("match_status <> ? AND (LOWER(alias_name) LIKE ? OR normalized_alias LIKE ?)", domain.NutritionAliasBlocked, pattern, normalizedPattern).
			Limit(limit * 4).
			Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			aliasRows = append(aliasRows, row)
			aliasVariantsByFoodID[row.FoodID] = append(aliasVariantsByFoodID[row.FoodID], variant)
		}
	}

	seen := map[string]SearchCandidate{}
	for _, food := range canonicalFoods {
		if !isCandidateMatchEligibleNutritionFood(food) || isImplausibleNutritionFoodMatch(raw, food) {
			continue
		}
		variant := canonicalVariantByFoodID[food.ID]
		score := nutritionSearchScore(raw, variant, food, "canonical")
		matchSource := "canonical"
		if variant.Normalized != "" && food.NormalizedName == variant.Normalized {
			score = 0.99
			if variant.Text != raw {
				score = 0.965
				matchSource = "canonical_normalized"
			}
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
		aliasNamesByFoodID := map[string][]string{}
		for _, row := range aliasRows {
			row.FoodID = strings.TrimSpace(row.FoodID)
			if row.FoodID == "" {
				continue
			}
			foodIDs = append(foodIDs, row.FoodID)
			aliasNamesByFoodID[row.FoodID] = append(aliasNamesByFoodID[row.FoodID], row.AliasName)
		}
		if len(foodIDs) > 0 {
			var aliasFoods []domain.FoodNutrition
			if err := r.db.WithContext(ctx).
				Where("is_active = ? AND id IN ?", true, foodIDs).
				Find(&aliasFoods).Error; err != nil {
				return nil, err
			}
			for _, food := range aliasFoods {
				if !isCandidateMatchEligibleNutritionFood(food) || allNutritionAliasesUnsafe(raw, aliasNamesByFoodID[food.ID], food.CanonicalName) || isImplausibleNutritionFoodMatch(raw, food) {
					continue
				}
				variant := bestNutritionVariant(aliasVariantsByFoodID[food.ID])
				score := nutritionSearchScore(raw, variant, food, "alias") + 0.03
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

// ListNutritionEmbeddingSources returns only trusted rows and non-blocked
// aliases. Aliases remain recall hints; their status never upgrades them to an
// exact nutrition match.
func (r *FoodNutritionRepo) ListNutritionEmbeddingSources(ctx context.Context) ([]NutritionEmbeddingSource, error) {
	var foods []domain.FoodNutrition
	if err := r.db.WithContext(ctx).
		Where("is_active = ? AND quality_tier IN ?", true, []string{domain.NutritionQualityAuthoritative, domain.NutritionQualityLegacyCurated}).
		Order("id ASC").
		Find(&foods).Error; err != nil {
		return nil, err
	}
	sources := make([]NutritionEmbeddingSource, 0, len(foods)*2)
	for _, food := range foods {
		name := strings.TrimSpace(food.CanonicalName)
		if name == "" {
			continue
		}
		sources = append(sources, NutritionEmbeddingSource{
			IdentityKey:   "canonical:" + food.ID,
			FoodID:        food.ID,
			SourceType:    "canonical",
			SourceID:      food.ID,
			EmbeddingText: name,
		})
	}
	type aliasSourceRow struct {
		ID            string `gorm:"column:id"`
		FoodID        string `gorm:"column:food_id"`
		AliasName     string `gorm:"column:alias_name"`
		CanonicalName string `gorm:"column:canonical_name"`
	}
	var aliases []aliasSourceRow
	if err := r.db.WithContext(ctx).
		Table("food_nutrition_aliases AS aliases").
		Select("aliases.id, aliases.food_id, aliases.alias_name, foods.canonical_name").
		Joins("JOIN food_nutrition_library AS foods ON foods.id = aliases.food_id").
		Where("foods.is_active = ? AND foods.quality_tier IN ?", true, []string{domain.NutritionQualityAuthoritative, domain.NutritionQualityLegacyCurated}).
		Where("aliases.match_status <> ?", domain.NutritionAliasBlocked).
		Order("aliases.id ASC").
		Find(&aliases).Error; err != nil {
		return nil, err
	}
	for _, alias := range aliases {
		name := strings.TrimSpace(alias.AliasName)
		if name == "" || strings.TrimSpace(alias.ID) == "" || strings.TrimSpace(alias.FoodID) == "" {
			continue
		}
		sources = append(sources, NutritionEmbeddingSource{
			IdentityKey:   "alias:" + alias.ID,
			FoodID:        alias.FoodID,
			SourceType:    "alias",
			SourceID:      alias.ID,
			EmbeddingText: name,
		})
	}
	return sources, nil
}

func (r *FoodNutritionRepo) ListNutritionEmbeddingHashes(ctx context.Context, model string, dimensions int) (map[string]string, error) {
	type row struct {
		IdentityKey string `gorm:"column:identity_key"`
		ContentHash string `gorm:"column:content_hash"`
	}
	var rows []row
	if err := r.db.WithContext(ctx).
		Table((&domain.FoodNutritionEmbedding{}).TableName()).
		Select("identity_key, content_hash").
		Where("embedding_model = ? AND embedding_dimensions = ?", strings.TrimSpace(model), dimensions).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]string, len(rows))
	for _, item := range rows {
		out[item.IdentityKey] = item.ContentHash
	}
	return out, nil
}

func (r *FoodNutritionRepo) UpsertNutritionEmbeddings(ctx context.Context, rows []domain.FoodNutritionEmbedding) error {
	if len(rows) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "identity_key"}, {Name: "embedding_model"}, {Name: "embedding_dimensions"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"food_id", "source_type", "source_id", "embedding_text", "content_hash", "embedding_bytes", "is_active", "updated_at",
		}),
	}).CreateInBatches(rows, 100).Error
}

func (r *FoodNutritionRepo) LoadNutritionEmbeddingIndex(ctx context.Context, model string, dimensions int) ([]NutritionEmbeddingIndexRow, error) {
	type row struct {
		IdentityKey    string `gorm:"column:identity_key"`
		FoodID         string `gorm:"column:food_id"`
		EmbeddingBytes []byte `gorm:"column:embedding_bytes"`
	}
	var rows []row
	if err := r.db.WithContext(ctx).
		Table("food_nutrition_embeddings AS embeddings").
		Select("embeddings.identity_key, embeddings.food_id, embeddings.embedding_bytes").
		Joins("JOIN food_nutrition_library AS foods ON foods.id = embeddings.food_id").
		Joins("LEFT JOIN food_nutrition_aliases AS aliases ON embeddings.source_type = 'alias' AND aliases.id = embeddings.source_id").
		Where("embeddings.is_active = ? AND embeddings.embedding_model = ? AND embeddings.embedding_dimensions = ?", true, strings.TrimSpace(model), dimensions).
		Where("foods.is_active = ? AND foods.quality_tier IN ?", true, []string{domain.NutritionQualityAuthoritative, domain.NutritionQualityLegacyCurated}).
		Where("embeddings.source_type = 'canonical' OR (aliases.id IS NOT NULL AND aliases.match_status <> ?)", domain.NutritionAliasBlocked).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]NutritionEmbeddingIndexRow, 0, len(rows))
	for _, item := range rows {
		out = append(out, NutritionEmbeddingIndexRow(item))
	}
	return out, nil
}

func (r *FoodNutritionRepo) FindNutritionFoodsByIDs(ctx context.Context, foodIDs []string) (map[string]domain.FoodNutrition, error) {
	if len(foodIDs) == 0 {
		return map[string]domain.FoodNutrition{}, nil
	}
	var foods []domain.FoodNutrition
	if err := r.db.WithContext(ctx).
		Where("is_active = ? AND id IN ?", true, foodIDs).
		Find(&foods).Error; err != nil {
		return nil, err
	}
	out := make(map[string]domain.FoodNutrition, len(foods))
	for _, food := range foods {
		if isCandidateMatchEligibleNutritionFood(food) {
			out[food.ID] = food
		}
	}
	return out, nil
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

type nutritionQueryVariant struct {
	Text       string
	Normalized string
	Weight     float64
}

func (v nutritionQueryVariant) matchSource(source string) string {
	if strings.TrimSpace(v.Text) == "" || v.Weight >= 1 {
		return source
	}
	return source + "_normalized"
}

func nutritionQueryVariants(raw string) []nutritionQueryVariant {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	candidates := []struct {
		text   string
		weight float64
	}{}
	for _, preferred := range preferredNutritionQueryTexts(raw) {
		candidates = append(candidates, struct {
			text   string
			weight float64
		}{preferred, 1.05})
	}
	candidates = append(candidates, struct {
		text   string
		weight float64
	}{raw, 1})
	for _, cleaned := range normalizeNutritionQueryText(raw) {
		if cleaned == "" {
			continue
		}
		candidates = append(candidates, struct {
			text   string
			weight float64
		}{cleaned, 0.92})
		for _, stripped := range stripNutritionPreparationWords(cleaned) {
			if stripped != "" && stripped != cleaned {
				candidates = append(candidates, struct {
					text   string
					weight float64
				}{stripped, 0.86})
			}
		}
	}
	out := make([]nutritionQueryVariant, 0, len(candidates))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		text := strings.TrimSpace(candidate.text)
		normalized := normalizeFoodName(text)
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, nutritionQueryVariant{Text: text, Normalized: normalized, Weight: candidate.weight})
	}
	return out
}

func nutritionExactQueryVariants(raw string) []nutritionQueryVariant {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	candidates := []string{raw}
	for _, normalized := range normalizeNutritionIdentityTexts(raw) {
		candidates = append(candidates, normalized)
	}
	out := make([]nutritionQueryVariant, 0, len(candidates))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		text := strings.TrimSpace(candidate)
		normalized := normalizeFoodName(text)
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		out = append(out, nutritionQueryVariant{Text: text, Normalized: normalized, Weight: 1})
	}
	return out
}

// normalizeNutritionIdentityTexts only performs transformations that preserve
// food identity. Component extraction and preparation-word stripping belong to
// candidate recall and are deliberately excluded from direct exact matching.
func normalizeNutritionIdentityTexts(raw string) []string {
	text := strings.ToLower(strings.TrimSpace(raw))
	if text == "" {
		return nil
	}
	variants := []string{text}
	replaced := text
	for _, item := range []struct{ old, new string }{
		{"西蓝花", "西兰花"},
		{"苞米", "玉米"},
		{"棒子", "玉米"},
		{"地瓜", "红薯"},
		{"番薯", "红薯"},
		{"甘薯", "红薯"},
		{"白饭", "白米饭"},
		{"全鸡蛋", "鸡蛋"},
		{"全蛋", "鸡蛋"},
		{"全脂牛奶", "牛奶全脂"},
		{"全脂奶", "牛奶全脂"},
	} {
		replaced = strings.ReplaceAll(replaced, item.old, item.new)
	}
	variants = append(variants, replaced)
	for _, value := range append([]string{}, variants...) {
		if cleaned := stripNutritionMeasureWords(value); cleaned != "" {
			variants = append(variants, cleaned)
			// These are stable catalog naming conventions rather than fuzzy
			// containment rules. They preserve the complete food identity after
			// quantity/container words have been removed.
			switch normalizeFoodName(cleaned) {
			case "米饭":
				variants = append(variants, "白米饭")
			}
		}
	}
	return uniqueNonEmptyStrings(variants)
}

func preferredNutritionQueryTexts(raw string) []string {
	normalized := normalizeFoodName(raw)
	if normalized == "" || looksLikeCompoundNutritionQuery(normalized) {
		return nil
	}
	out := []string{}
	hasCookedCue := containsAnyToken(normalized, []string{"熟", "煮", "水煮", "蒸", "烤", "煎", "即食"})
	switch {
	case containsAnyToken(normalized, []string{"鸡胸"}):
		out = append(out, "禽肉（去皮鸡胸肉）")
	case containsAnyToken(normalized, []string{"米饭", "白饭"}) && !containsAnyToken(normalized, []string{"紫米", "糙米", "杂粮", "黑米"}):
		out = append(out, "白米饭")
	case containsAnyToken(normalized, []string{"玉米", "苞米", "棒子"}) && !containsAnyToken(normalized, []string{"肠", "香肠", "火腿", "热狗"}):
		if hasCookedCue || !containsAnyToken(normalized, []string{"油", "粉", "面"}) {
			out = append(out, "玉米(熟)")
		}
	case containsAnyToken(normalized, []string{"鸡蛋", "煮蛋", "水煮蛋", "全蛋"}) && !containsAnyToken(normalized, []string{"蛋清", "蛋白", "蛋黄", "三明治", "青团", "蛋糕"}):
		out = append(out, "鸡蛋")
	case containsAnyToken(normalized, []string{"牛奶", "全脂奶", "纯奶", "鲜奶"}) && !containsAnyToken(normalized, []string{"奶粉", "酸奶", "拿铁", "咖啡", "奶茶"}):
		out = append(out, "牛奶(全脂)")
	case containsAnyToken(normalized, []string{"酸奶", "酸牛奶", "酸乳", "发酵乳"}) && !containsAnyToken(normalized, []string{"软糖", "溶豆", "奶昔", "饮料", "蛋糕", "冰淇淋", "雪糕"}):
		out = append(out, "酸奶")
	case containsAnyToken(normalized, []string{"油麦菜"}):
		out = append(out, "油麦菜")
	case containsAnyToken(normalized, []string{"西兰花", "西蓝花"}):
		out = append(out, "西兰花")
	case containsAnyToken(normalized, []string{"桃子", "水蜜桃", "毛桃", "黄桃", "油桃"}) &&
		!containsAnyToken(normalized, []string{"樱桃", "猕猴桃"}) &&
		!containsAnyToken(normalized, nutritionProcessedFruitTokens):
		out = append(out, "水蜜桃")
	case containsAnyToken(normalized, []string{"香蕉"}):
		out = append(out, "香蕉")
	case containsAnyToken(normalized, []string{"苹果"}) && !containsAnyToken(normalized, []string{"苹果醋", "苹果汁"}):
		out = append(out, "苹果")
	case containsAnyToken(normalized, []string{"燕麦"}):
		if containsAnyToken(normalized, nutritionHydratedCues) && !containsAnyToken(normalized, []string{"干重", "干燕麦", "干麦片", "未泡"}) {
			out = append(out, "燕麦粥")
		} else {
			out = append(out, "燕麦片")
		}
	case containsAnyToken(normalized, []string{"红薯", "地瓜", "番薯", "甘薯"}):
		out = append(out, "红薯")
	}
	return uniqueNonEmptyStrings(out)
}

func looksLikeCompoundNutritionQuery(normalized string) bool {
	if normalized == "" {
		return false
	}
	compoundTokens := []string{"三明治", "汉堡", "披萨", "蛋糕", "青团", "水饺", "汤", "粥", "面", "粉", "饭团", "沙拉"}
	if containsAnyToken(normalized, compoundTokens) {
		return true
	}
	return len([]rune(normalized)) > 12
}

func normalizeNutritionQueryText(raw string) []string {
	text := strings.ToLower(strings.TrimSpace(raw))
	if text == "" {
		return nil
	}
	variants := []string{text}
	if idx := strings.LastIndex(text, "里的"); idx >= 0 && idx+len("里的") < len(text) {
		variants = append(variants, text[idx+len("里的"):])
	}
	if strings.Contains(text, "盒饭") && strings.Contains(text, "米饭") {
		variants = append(variants, "米饭")
	}
	replaced := text
	replacements := []struct{ old, new string }{
		{"西蓝花", "西兰花"},
		{"苞米", "玉米"},
		{"棒子", "玉米"},
		{"地瓜", "红薯"},
		{"番薯", "红薯"},
		{"甘薯", "红薯"},
		{"白饭", "白米饭"},
		{"全蛋", "鸡蛋"},
		{"全鸡蛋", "鸡蛋"},
		{"纯牛奶", "牛奶"},
		{"鲜牛奶", "牛奶"},
		{"全脂牛奶", "牛奶全脂"},
		{"全脂奶", "牛奶全脂"},
	}
	for _, item := range replacements {
		replaced = strings.ReplaceAll(replaced, item.old, item.new)
	}
	variants = append(variants, replaced)
	for _, value := range append([]string{}, variants...) {
		cleaned := stripNutritionMeasureWords(value)
		if cleaned != "" {
			variants = append(variants, cleaned)
		}
	}
	return uniqueNonEmptyStrings(variants)
}

var (
	nutritionAmountPattern        = regexp.MustCompile(`(?i)\d+(?:\.\d+)?\s*(?:g|克|kg|千克|ml|毫升|l|升|kcal|千卡|卡路里)`)
	nutritionCountPrefixPattern   = regexp.MustCompile(`^(?:[一二两三四五六七八九十半]+|\d+)\s*(?:个|颗|根|块|碗|份|杯|盒|袋|片|只|枚|条|截|小碗|大碗|小块|大块)`)
	nutritionCountSuffixPattern   = regexp.MustCompile(`(?:[一二两三四五六七八九十半]+|\d+)\s*(?:个|颗|根|块|碗|份|杯|盒|袋|片|只|枚|条|截|小碗|大碗|小块|大块)$`)
	nutritionMeasurePrefixPattern = regexp.MustCompile(`^(?:一|半|两|二|三|四|五|六|七|八|九|十)?(?:小|大)?(?:碗|份|杯|盒|袋|块|根|个|颗|条|截)`)
	nutritionMeasureSuffixPattern = regexp.MustCompile(`(?:一|半|两|二|三|四|五|六|七|八|九|十)?(?:小|大)?(?:碗|份|杯|盒|袋|块|根|个|颗|条|截)$`)
)

func stripNutritionMeasureWords(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = nutritionAmountPattern.ReplaceAllString(value, "")
	value = nutritionCountPrefixPattern.ReplaceAllString(value, "")
	value = nutritionCountSuffixPattern.ReplaceAllString(value, "")
	value = nutritionMeasurePrefixPattern.ReplaceAllString(value, "")
	value = nutritionMeasureSuffixPattern.ReplaceAllString(value, "")
	for _, token := range []string{"约", "大约", "左右", "的", "里", "里面", "里面的", "底", "饭底", "底部", "剩", "昨晚"} {
		value = strings.TrimPrefix(value, token)
		value = strings.TrimSuffix(value, token)
	}
	return strings.TrimSpace(value)
}

func stripNutritionPreparationWords(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	variants := []string{value}
	prefixes := []string{"水煮", "白水煮", "煮熟的", "熟的", "熟", "清炒", "蒜蓉", "蒸熟的", "蒸", "煮", "烤", "煎", "泡好的", "泡发", "泡开", "水泡", "浸泡", "泡", "去皮", "剥壳", "常温", "热", "冷藏", "原味", "纯"}
	for _, prefix := range prefixes {
		if strings.HasPrefix(value, prefix) && len(value) > len(prefix) {
			variants = append(variants, strings.TrimSpace(strings.TrimPrefix(value, prefix)))
		}
	}
	suffixes := []string{"熟", "菜", "块", "片", "丁", "粒", "小朵"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(value, suffix) && len(value) > len(suffix) {
			variants = append(variants, strings.TrimSpace(strings.TrimSuffix(value, suffix)))
		}
	}
	return uniqueNonEmptyStrings(variants)
}

func bestNutritionVariant(variants []nutritionQueryVariant) nutritionQueryVariant {
	if len(variants) == 0 {
		return nutritionQueryVariant{}
	}
	best := variants[0]
	for _, variant := range variants[1:] {
		if variant.Weight > best.Weight {
			best = variant
		}
	}
	return best
}

func nutritionSearchScore(raw string, variant nutritionQueryVariant, food domain.FoodNutrition, source string) float64 {
	if variant.Text == "" {
		variant = nutritionQueryVariant{Text: raw, Normalized: normalizeFoodName(raw), Weight: 1}
	}
	score := searchCandidateScore(variant.Text, food.CanonicalName) * variant.Weight
	if source == "alias" {
		score += 0.02
	}
	queryNorm := normalizeFoodName(raw)
	canonicalNorm := normalizeFoodName(food.CanonicalName)
	switch {
	case variant.Normalized != "" && canonicalNorm == variant.Normalized:
		score += 0.12
	case variant.Normalized != "" && strings.Contains(canonicalNorm, variant.Normalized):
		score += 0.04
	case variant.Normalized != "" && strings.Contains(variant.Normalized, canonicalNorm):
		score += 0.03
	}
	if containsCJK(queryNorm) && isMostlyASCII(food.CanonicalName) {
		score -= 0.35
	}
	if isSpecificDishName(food.CanonicalName) && !isSpecificDishName(raw) {
		score -= 0.12
	}
	if isProcessedFoodMismatchForCandidate(raw, food.CanonicalName) {
		score -= 0.5
	}
	if score < 0 {
		return 0
	}
	if score > 0.99 {
		return 0.99
	}
	return score
}

func isSpecificDishName(value string) bool {
	normalized := normalizeFoodName(value)
	if normalized == "" {
		return false
	}
	tokens := []string{"炒", "配", "与", "盖浇", "混合", "底部", "铺垫", "覆盖", "含", "腌制", "空气炸锅", "干"}
	return containsAnyToken(normalized, tokens)
}

func isProcessedFoodMismatchForCandidate(query, canonicalName string) bool {
	queryNorm := normalizeFoodName(query)
	canonicalNorm := normalizeFoodName(canonicalName)
	if queryNorm == "" || canonicalNorm == "" {
		return false
	}
	processedTokens := []string{"肠", "香肠", "火腿", "热狗", "肉肠", "鱼肠", "鸡肉肠", "玉米肠"}
	if containsAnyToken(canonicalNorm, processedTokens) && !containsAnyToken(queryNorm, processedTokens) {
		return true
	}
	return isFreshFruitToProcessedProductMismatch(queryNorm, canonicalNorm)
}

func containsCJK(value string) bool {
	for _, r := range value {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func isMostlyASCII(value string) bool {
	letters := 0
	ascii := 0
	for _, r := range strings.TrimSpace(value) {
		if unicode.IsLetter(r) {
			letters++
			if r <= unicode.MaxASCII {
				ascii++
			}
		}
	}
	return letters > 0 && ascii*2 >= letters
}

func uniqueNonEmptyStrings(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		key := normalizeFoodName(value)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, value)
	}
	return out
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
	unit = normalizeAIGeneratedNutritionUnit(unit, source)
	var existing domain.FoodNutrition
	err := r.db.WithContext(ctx).Where("normalized_name = ?", normalized).First(&existing).Error
	if err == nil {
		// Never overwrite a curated row with a runtime estimate. Existing AI
		// rows may be refreshed for review, but they remain quarantined and are
		// not eligible for exact/fuzzy runtime matching.
		if !domain.IsAIGeneratedNutritionSource(existing.Source) ||
			domain.EffectiveNutritionQualityTier(existing) == domain.NutritionQualityReviewedEstimate {
			return existing.ID, nil
		}
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
			"is_active":                  false,
			"quality_tier":               domain.NutritionQualityPlausible,
			"quality_evidence": datatypes.JSONMap{
				"method": "runtime_single_model_estimate",
				"model":  source,
			},
		}
		if err := r.db.WithContext(ctx).Model(&domain.FoodNutrition{}).Where("id = ?", existing.ID).Updates(updates).Error; err != nil {
			return "", err
		}
		return existing.ID, nil
	}
	if err != gorm.ErrRecordNotFound {
		return "", err
	}
	id := uuid.NewString()
	values := nutritionCreateValues(raw, normalized, unit, source)
	values["id"] = id
	values["is_active"] = false
	values["quality_tier"] = domain.NutritionQualityPlausible
	values["quality_evidence"] = datatypes.JSONMap{
		"method": "runtime_single_model_estimate",
		"model":  source,
	}
	if err := r.db.WithContext(ctx).Table((&domain.FoodNutrition{}).TableName()).Create(values).Error; err != nil {
		return "", err
	}
	return id, nil
}

func normalizeAIGeneratedNutritionUnit(unit map[string]any, source string) map[string]any {
	if !domain.IsAIGeneratedNutritionSource(source) {
		return unit
	}
	out := make(map[string]any, len(unit)+1)
	for key, value := range unit {
		out[key] = value
	}
	out["calories"] = domain.MacroCalories(
		number(out["protein"]),
		number(out["carbs"]),
		number(out["fat"]),
	)
	return out
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
		"quality_tier":               domain.NutritionQualityUnreviewed,
		"quality_evidence":           datatypes.JSONMap{},
	}
}

func (r *FoodNutritionRepo) createNutritionAlias(ctx context.Context, foodID, raw, normalized string) error {
	if strings.TrimSpace(foodID) == "" || strings.TrimSpace(raw) == "" || strings.TrimSpace(normalized) == "" {
		return nil
	}
	var food domain.FoodNutrition
	if err := r.db.WithContext(ctx).Where("is_active = ? AND id = ?", true, foodID).First(&food).Error; err != nil {
		return fmt.Errorf("校验营养别名目标失败: %w", err)
	}
	if err := ValidateNutritionAliasTarget(raw, food); err != nil {
		return fmt.Errorf("拒绝创建营养别名: %w", err)
	}
	return r.db.WithContext(ctx).
		Table((&domain.FoodNutritionAlias{}).TableName()).
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(map[string]any{
			"id":                uuid.NewString(),
			"food_id":           foodID,
			"alias_name":        raw,
			"normalized_alias":  normalized,
			"match_status":      domain.NutritionAliasCandidateOnly,
			"approval_evidence": datatypes.JSONMap{},
		}).Error
}

func (r *FoodNutritionRepo) EnsureNutritionAlias(ctx context.Context, foodID, rawName string) error {
	raw := strings.TrimSpace(rawName)
	if strings.TrimSpace(foodID) == "" || raw == "" {
		return nil
	}
	return r.createNutritionAlias(ctx, foodID, raw, normalizeFoodName(raw))
}

// ProposeNutritionAliasCandidate records a semantic match in the isolated
// review queue. It never writes food_nutrition_aliases and therefore cannot
// affect runtime matching before an administrator approves the proposal.
func (r *FoodNutritionRepo) ProposeNutritionAliasCandidate(ctx context.Context, foodID, rawName, model string, confidence float64, reason string) error {
	raw := strings.TrimSpace(rawName)
	foodID = strings.TrimSpace(foodID)
	if foodID == "" || raw == "" {
		return nil
	}
	var food domain.FoodNutrition
	if err := r.db.WithContext(ctx).Where("id = ? AND is_active = ?", foodID, true).First(&food).Error; err != nil {
		return fmt.Errorf("校验营养别名候选目标失败: %w", err)
	}
	if normalizeFoodName(raw) == normalizeFoodName(food.CanonicalName) {
		return nil
	}
	if err := ValidateNutritionAliasTarget(raw, food); err != nil {
		return fmt.Errorf("拒绝创建营养别名候选: %w", err)
	}
	normalized := normalizeFoodName(raw)
	var count int64
	if err := r.db.WithContext(ctx).Table((&domain.FoodNutritionAlias{}).TableName()).
		Where("normalized_alias = ?", normalized).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	if err := r.db.WithContext(ctx).Table("food_nutrition_alias_candidates").
		Where("normalized_alias = ? AND proposed_food_id = ? AND status = 'pending'", normalized, foodID).
		Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	snapshot, err := json.Marshal(map[string]any{
		"canonical_name": food.CanonicalName,
		"kcal_per_100g":  food.KcalPer100g, "protein_per_100g": food.ProteinPer100g,
		"carbs_per_100g": food.CarbsPer100g, "fat_per_100g": food.FatPer100g,
		"source": food.Source,
	})
	if err != nil {
		return err
	}
	emptyList := datatypes.JSON([]byte("[]"))
	return r.db.WithContext(ctx).Table("food_nutrition_alias_candidates").
		Clauses(clause.OnConflict{DoNothing: true}).Create(map[string]any{
		"id": uuid.NewString(), "alias_name": raw, "normalized_alias": normalized,
		"proposed_food_id": foodID, "source": "ai_semantic", "model": strings.TrimSpace(model),
		"model_decision": "approve", "model_confidence": confidence, "model_reason": strings.TrimSpace(reason),
		"suggested_aliases": emptyList, "rule_flags": emptyList, "candidate_snapshot": datatypes.JSON(snapshot),
		"status": "pending",
	}).Error
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
