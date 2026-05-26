package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/foodrecord/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupFoodNutritionTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	db.Exec(`CREATE TABLE food_nutrition_library (
		id TEXT PRIMARY KEY,
		canonical_name TEXT,
		normalized_name TEXT,
		kcal_per_100g REAL,
		protein_per_100g REAL,
		carbs_per_100g REAL,
		fat_per_100g REAL,
		fiber_per_100g REAL,
		sugar_per_100g REAL,
		sodium_mg_per_100g REAL,
		is_active BOOLEAN
	)`)
	db.Exec(`CREATE TABLE food_nutrition_aliases (
		id TEXT PRIMARY KEY,
		food_id TEXT,
		alias_name TEXT,
		normalized_alias TEXT
	)`)
	db.Exec(`CREATE TABLE food_unresolved_logs (
		id TEXT PRIMARY KEY,
		raw_name TEXT,
		normalized_name TEXT,
		hit_count INTEGER
	)`)
	return db
}

func setupFoodNutritionFullTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&domain.FoodNutrition{}, &domain.FoodNutritionAlias{}, &domain.FoodUnresolvedLog{}))
	require.NoError(t, db.AutoMigrate(&domain.PackagedFood{}, &domain.PackagedFoodAlias{}))
	return db
}

func TestFoodNutritionRepo_Search(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	// Insert test data
	db.Exec(`INSERT INTO food_nutrition_library (id, canonical_name, kcal_per_100g, is_active) VALUES (?, ?, ?, ?)`,
		"food-1", "Apple", 52, true)

	results, err := repo.Search(ctx, "apple", 5)
	require.NoError(t, err)
	assert.NotNil(t, results)
}

func TestFoodNutritionRepo_Search_DefaultLimit(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	results, err := repo.Search(ctx, "test", 0)
	require.NoError(t, err)
	assert.NotNil(t, results)
}

func TestFoodNutritionRepo_SearchCandidatesRanksAliasAndCanonical(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "food-1",
		CanonicalName:  "蜜雪冰城原味冰淇淋蛋筒",
		NormalizedName: normalizeFoodName("蜜雪冰城原味冰淇淋蛋筒"),
		KcalPer100g:    210,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutritionAlias{
		ID:              "alias-1",
		FoodID:          "food-1",
		AliasName:       "蜜雪冰城原味冰淇淋",
		NormalizedAlias: normalizeFoodName("蜜雪冰城原味冰淇淋"),
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "food-2",
		CanonicalName:  "蜜雪冰城蜜瓜冰淇淋",
		NormalizedName: normalizeFoodName("蜜雪冰城蜜瓜冰淇淋"),
		KcalPer100g:    205,
		IsActive:       true,
	}).Error)

	results, err := repo.SearchCandidates(ctx, "蜜雪冰城原味冰淇淋", 5)
	require.NoError(t, err)
	require.Len(t, results, 2)
	assert.Equal(t, "food-1", results[0].Food.ID)
	assert.Equal(t, "alias", results[0].MatchSource)
	assert.Greater(t, results[0].Score, results[1].Score)
}

func TestFoodNutritionRepo_ResolveFoodPrefersExactCanonicalOverAlias(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "lean-beef",
		CanonicalName:  "瘦牛肉(熟)",
		NormalizedName: normalizeFoodName("瘦牛肉(熟)"),
		KcalPer100g:    176,
		ProteinPer100g: 26,
		CarbsPer100g:   0,
		FatPer100g:     7,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "sauce-beef",
		CanonicalName:  "酱牛肉",
		NormalizedName: normalizeFoodName("酱牛肉"),
		KcalPer100g:    246,
		ProteinPer100g: 31.4,
		CarbsPer100g:   3.2,
		FatPer100g:     11.9,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutritionAlias{
		ID:              "stale-alias",
		FoodID:          "lean-beef",
		AliasName:       "酱牛肉",
		NormalizedAlias: normalizeFoodName("酱牛肉"),
	}).Error)

	result, err := repo.ResolveFood(ctx, "酱牛肉")
	require.NoError(t, err)
	require.NotNil(t, result.Food)
	assert.Equal(t, "sauce-beef", result.Food.ID)
	assert.Equal(t, "exact_canonical", result.Status)
	assert.Equal(t, 3.2, result.Food.CarbsPer100g)
}

func TestFoodNutritionRepo_GetUnresolvedTop(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	// Insert test data
	db.Exec(`INSERT INTO food_unresolved_logs (id, raw_name, normalized_name, hit_count) VALUES (?, ?, ?, ?)`,
		"log-1", "Unknown Food", "unknownfood", 10)

	results, err := repo.GetUnresolvedTop(ctx, 10)
	require.NoError(t, err)
	assert.NotNil(t, results)
}

func TestFoodNutritionRepo_GetUnresolvedTop_DefaultLimit(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	results, err := repo.GetUnresolvedTop(ctx, 0)
	require.NoError(t, err)
	assert.NotNil(t, results)
}

func TestFoodNutritionRepo_LogUnresolved_New(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	err := repo.LogUnresolved(ctx, "New Food Item")
	require.NoError(t, err)

	var count int64
	db.Model(&domain.FoodUnresolvedLog{}).Count(&count)
	assert.Equal(t, int64(1), count)
}

func TestFoodNutritionRepo_LogUnresolved_Existing(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	// Insert existing
	db.Exec(`INSERT INTO food_unresolved_logs (id, raw_name, normalized_name, hit_count) VALUES (?, ?, ?, ?)`,
		"log-1", "New Food Item", "newfooditem", 5)

	err := repo.LogUnresolved(ctx, "New Food Item")
	require.NoError(t, err)

	var hitCount int
	db.Raw("SELECT hit_count FROM food_unresolved_logs WHERE id = ?", "log-1").Scan(&hitCount)
	assert.Equal(t, 6, hitCount)
}

func TestFoodNutritionRepo_LogUnresolved_Empty(t *testing.T) {
	db := setupFoodNutritionTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	err := repo.LogUnresolved(ctx, "")
	require.NoError(t, err)
}

func TestNormalizeUnresolvedName(t *testing.T) {
	assert.Equal(t, "apple", normalizeUnresolvedName("Apple"))
	assert.Equal(t, "applepie", normalizeUnresolvedName("  Apple Pie  "))
	assert.Equal(t, "", normalizeUnresolvedName(""))
	assert.Equal(t, "food123", normalizeUnresolvedName("Food 123"))
}

func TestFoodNutritionRepo_ListFoodsNeedingVitaminBackfill(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "f1",
		CanonicalName:  "Macro Only",
		NormalizedName: "macroonly",
		KcalPer100g:    100,
		ProteinPer100g: 5,
		CarbsPer100g:   10,
		FatPer100g:     3,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:                "f2",
		CanonicalName:     "Has Vitamin",
		NormalizedName:    "hasvitamin",
		KcalPer100g:       80,
		ProteinPer100g:    4,
		CarbsPer100g:      8,
		FatPer100g:        2,
		VitaminCMgPer100g: 12,
		IsActive:          true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "f3",
		CanonicalName:  "No Macro",
		NormalizedName: "nomacro",
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:                    "f4",
		CanonicalName:         "Full",
		NormalizedName:        "full",
		KcalPer100g:           80,
		ProteinPer100g:        4,
		CarbsPer100g:          8,
		FatPer100g:            2,
		FiberPer100g:          1,
		SugarPer100g:          1,
		SaturatedFatPer100g:   1,
		CholesterolMgPer100g:  1,
		SodiumMgPer100g:       1,
		PotassiumMgPer100g:    1,
		CalciumMgPer100g:      1,
		IronMgPer100g:         1,
		MagnesiumMgPer100g:    1,
		ZincMgPer100g:         1,
		VitaminARaeMcgPer100g: 1,
		VitaminCMgPer100g:     1,
		VitaminDMcgPer100g:    1,
		VitaminEMgPer100g:     1,
		VitaminKMcgPer100g:    1,
		ThiaminMgPer100g:      1,
		RiboflavinMgPer100g:   1,
		NiacinMgPer100g:       1,
		VitaminB6MgPer100g:    1,
		FolateMcgPer100g:      1,
		VitaminB12McgPer100g:  1,
		IsActive:              true,
	}).Error)

	items, err := repo.ListFoodsNeedingVitaminBackfill(ctx, 10)
	require.NoError(t, err)
	require.Len(t, items, 2)
	assert.ElementsMatch(t, []string{"Macro Only", "Has Vitamin"}, []string{items[0].CanonicalName, items[1].CanonicalName})

	count, err := repo.CountFoodsNeedingVitaminBackfill(ctx)
	require.NoError(t, err)
	assert.Equal(t, int64(2), count)
}

func TestFoodNutritionRepo_FillMissingDeepSeekNutrients(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:              "f1",
		CanonicalName:   "Macro Only",
		NormalizedName:  "macroonly",
		KcalPer100g:     100,
		ProteinPer100g:  5,
		CarbsPer100g:    10,
		FatPer100g:      3,
		SodiumMgPer100g: 50,
		IsActive:        true,
	}).Error)

	filled, err := repo.FillMissingDeepSeekNutrients(ctx, "f1", map[string]any{
		"calories":      999,
		"protein":       99,
		"carbs":         88,
		"fat":           77,
		"sodiumMg":      120,
		"calciumMg":     33,
		"vitaminCMg":    12,
		"vitaminB12Mcg": 1.5,
	})
	require.NoError(t, err)
	assert.Contains(t, filled, "calcium_mg_per_100g")
	assert.Contains(t, filled, "vitamin_c_mg_per_100g")
	assert.Contains(t, filled, "vitamin_b12_mcg_per_100g")
	assert.NotContains(t, filled, "sodium_mg_per_100g")

	var food domain.FoodNutrition
	require.NoError(t, db.Where("id = ?", "f1").First(&food).Error)
	assert.Equal(t, 100.0, food.KcalPer100g)
	assert.Equal(t, 5.0, food.ProteinPer100g)
	assert.Equal(t, 10.0, food.CarbsPer100g)
	assert.Equal(t, 3.0, food.FatPer100g)
	assert.Equal(t, 50.0, food.SodiumMgPer100g)
	assert.Equal(t, 33.0, food.CalciumMgPer100g)
	assert.Equal(t, 12.0, food.VitaminCMgPer100g)
	assert.Equal(t, 1.5, food.VitaminB12McgPer100g)
}

func TestFoodNutritionRepo_UpsertDeepSeekNutritionInsertsFullProfile(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	_, err := repo.UpsertDeepSeekNutrition(ctx, "新食物", map[string]any{
		"calories":       120,
		"protein":        6,
		"carbs":          18,
		"fat":            2,
		"fiber":          3,
		"sodiumMg":       30,
		"calciumMg":      40,
		"vitaminARaeMcg": 20,
		"vitaminCMg":     10,
		"vitaminB12Mcg":  0.4,
	})
	require.NoError(t, err)

	var food domain.FoodNutrition
	require.NoError(t, db.Where("normalized_name = ?", normalizeFoodName("新食物")).First(&food).Error)
	assert.Equal(t, 120.0, food.KcalPer100g)
	assert.Equal(t, 6.0, food.ProteinPer100g)
	assert.Equal(t, 40.0, food.CalciumMgPer100g)
	assert.Equal(t, 20.0, food.VitaminARaeMcgPer100g)
	assert.Equal(t, 10.0, food.VitaminCMgPer100g)
	assert.Equal(t, 0.4, food.VitaminB12McgPer100g)
	assert.Equal(t, "deepseek_v4_pro_auto", food.Source)
}

func TestFoodNutritionRepo_ResolvePackagedFood(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.PackagedFood{
		ID:             "p1",
		Brand:          "BrandA",
		ProductName:    "BrandA Protein Bar",
		NormalizedName: normalizeFoodName("BrandA Protein Bar"),
		ProductKey:     buildPackagedProductKey("BrandA", "BrandA Protein Bar", "60g", 60),
		NetWeightG:     60,
		KcalPer100g:    400,
		ProteinPer100g: 30,
		CarbsPer100g:   40,
		FatPer100g:     12,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.PackagedFoodAlias{
		ID:              "pa1",
		FoodID:          "p1",
		AliasName:       "protein bar",
		NormalizedAlias: normalizeFoodName("protein bar"),
	}).Error)

	result, err := repo.ResolvePackagedFood(ctx, PackagedFoodResolveInput{Name: "protein bar"})
	require.NoError(t, err)
	require.NotNil(t, result.Food)
	assert.Equal(t, "p1", result.Food.ID)
	assert.Equal(t, "exact_alias", result.Status)
}

func TestFoodNutritionRepo_UpsertPackagedFoodPersistsJSONFields(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	item, err := repo.UpsertPackagedFood(ctx, PackagedFoodInput{
		Brand:              "卫龙",
		ProductName:        "风吃海带",
		SpecText:           "18g",
		SourceImageURLs:    []string{"front.jpg", "nutrition.jpg"},
		RawLabelPayload:    map[string]any{"energy_unit_raw": "kj"},
		FieldConfidence:    map[string]any{"product_name": 0.91, "nutrition": 0.9},
		ConversionStatus:   "converted",
		ExtractConfidence:  0.9,
		NetWeightG:         18,
		ServingWeightG:     18,
		KcalPer100g:        230,
		ProteinPer100g:     4,
		CarbsPer100g:       20,
		FatPer100g:         8,
		Source:             "user_capture_ocr",
		IngestMethod:       "user_capture_ocr",
		NutritionBasisUnit: "100g",
		EnergyUnitRaw:      "kj",
	})
	require.NoError(t, err)
	require.NotNil(t, item)

	var stored domain.PackagedFood
	require.NoError(t, db.Where("id = ?", item.ID).First(&stored).Error)
	assert.Equal(t, []string{"front.jpg", "nutrition.jpg"}, stored.SourceImageURLs)
	assert.Equal(t, "kj", stored.RawLabelPayload["energy_unit_raw"])
	assert.Equal(t, 0.91, stored.FieldConfidence["product_name"])
	assert.Equal(t, "converted", *stored.ConversionStatus)
}

func TestFoodNutritionRepo_UpsertPackagedFoodUpdatesSameNormalizedName(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	first, _, err := repo.UpsertPackagedFoodWithAction(ctx, PackagedFoodInput{
		Brand:              "乐事",
		ProductName:        "原切马铃薯片",
		SpecText:           "40克",
		ConversionStatus:   "converted",
		NetWeightG:         40,
		KcalPer100g:        540,
		CarbsPer100g:       52,
		FatPer100g:         34,
		NutritionBasisUnit: "100g",
	})
	require.NoError(t, err)

	second, action, err := repo.UpsertPackagedFoodWithAction(ctx, PackagedFoodInput{
		Brand:              "乐事",
		ProductName:        "原切马铃薯片",
		SpecText:           "70克",
		ConversionStatus:   "converted",
		NetWeightG:         70,
		KcalPer100g:        520,
		CarbsPer100g:       50,
		FatPer100g:         32,
		NutritionBasisUnit: "100g",
	})
	require.NoError(t, err)
	assert.Equal(t, "updated", action)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, 70.0, second.NetWeightG)
	assert.Equal(t, 520.0, second.KcalPer100g)
}
