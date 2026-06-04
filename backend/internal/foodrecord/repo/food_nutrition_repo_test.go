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

func TestFoodNutritionRepo_ResolveFoodSkipsUnsafeProcessedAlias(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "cooked-corn",
		CanonicalName:  "玉米(熟)",
		NormalizedName: normalizeFoodName("玉米(熟)"),
		KcalPer100g:    96,
		ProteinPer100g: 3.4,
		CarbsPer100g:   21,
		FatPer100g:     1.5,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "corn-sausage",
		CanonicalName:  "玉米肠",
		NormalizedName: normalizeFoodName("玉米肠"),
		KcalPer100g:    207.7,
		ProteinPer100g: 10.3,
		CarbsPer100g:   19.7,
		FatPer100g:     9.74,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutritionAlias{
		ID:              "good-cooked-corn-alias",
		FoodID:          "cooked-corn",
		AliasName:       "水煮玉米",
		NormalizedAlias: normalizeFoodName("水煮玉米"),
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutritionAlias{
		ID:              "bad-corn-sausage-alias",
		FoodID:          "corn-sausage",
		AliasName:       "煮玉米",
		NormalizedAlias: normalizeFoodName("煮玉米"),
	}).Error)

	result, err := repo.ResolveFood(ctx, "煮玉米")
	require.NoError(t, err)
	require.NotNil(t, result.Food)
	assert.Equal(t, "cooked-corn", result.Food.ID)
	assert.NotEqual(t, "corn-sausage", result.Food.ID)
	assert.Less(t, result.Food.FatPer100g, 2.0)

	candidates, err := repo.SearchCandidates(ctx, "煮玉米", 5)
	require.NoError(t, err)
	require.NotEmpty(t, candidates)
	assert.Equal(t, "cooked-corn", candidates[0].Food.ID)
	for _, candidate := range candidates {
		assert.NotEqual(t, "corn-sausage", candidate.Food.ID)
	}
}

func TestFoodNutritionRepo_ResolveFoodUsesNormalizedQueryVariants(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "egg",
		CanonicalName:  "鸡蛋",
		NormalizedName: normalizeFoodName("鸡蛋"),
		KcalPer100g:    139,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "rice",
		CanonicalName:  "白米饭",
		NormalizedName: normalizeFoodName("白米饭"),
		KcalPer100g:    116,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutritionAlias{
		ID:              "rice-alias",
		FoodID:          "rice",
		AliasName:       "米饭",
		NormalizedAlias: normalizeFoodName("米饭"),
	}).Error)

	egg, err := repo.ResolveFood(ctx, "鸡蛋1个")
	require.NoError(t, err)
	require.NotNil(t, egg.Food)
	assert.Equal(t, "egg", egg.Food.ID)
	assert.Equal(t, "exact_canonical", egg.Status)
	assert.Equal(t, "canonical_normalized", egg.MatchSource)

	rice, err := repo.ResolveFood(ctx, "一碗米饭")
	require.NoError(t, err)
	require.NotNil(t, rice.Food)
	assert.Equal(t, "rice", rice.Food.ID)
	assert.Equal(t, "exact_alias", rice.Status)
	assert.Equal(t, "alias_normalized", rice.MatchSource)
}

func TestFoodNutritionRepo_ResolveFoodSkipsEnglishAliasForChineseQuery(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "milk-cn",
		CanonicalName:  "牛奶(全脂)",
		NormalizedName: normalizeFoodName("牛奶(全脂)"),
		KcalPer100g:    61,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutrition{
		ID:             "milk-usda",
		CanonicalName:  "Milk, whole, 3.25% milkfat, with added vitamin D",
		NormalizedName: normalizeFoodName("Milk, whole, 3.25% milkfat, with added vitamin D"),
		KcalPer100g:    61,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&domain.FoodNutritionAlias{
		ID:              "bad-english-alias",
		FoodID:          "milk-usda",
		AliasName:       "全脂牛奶",
		NormalizedAlias: normalizeFoodName("全脂牛奶"),
	}).Error)

	result, err := repo.ResolveFood(ctx, "全脂牛奶")
	require.NoError(t, err)
	require.NotNil(t, result.Food)
	assert.Equal(t, "milk-cn", result.Food.ID)
	assert.NotEqual(t, "milk-usda", result.Food.ID)
}

func TestIsUnsafeNutritionAliasMatch(t *testing.T) {
	assert.True(t, isUnsafeNutritionAliasMatch("煮玉米", "煮玉米", "玉米肠"))
	assert.True(t, isUnsafeNutritionAliasMatch("蒸玉米", "蒸玉米", "鸡肉玉米肠"))
	assert.True(t, isUnsafeNutritionAliasMatch("全脂牛奶", "全脂牛奶", "Milk, whole, 3.25% milkfat, with added vitamin D"))
	assert.False(t, isUnsafeNutritionAliasMatch("玉米肠", "玉米肠", "玉米肠"))
	assert.False(t, isUnsafeNutritionAliasMatch("即食玉米肠", "即食玉米肠", "玉米肠"))
	assert.False(t, isUnsafeNutritionAliasMatch("水煮玉米", "水煮玉米", "玉米(熟)"))
}

func TestNutritionQueryVariants(t *testing.T) {
	variants := nutritionQueryVariants("水煮鸡胸肉100g")
	normalized := []string{}
	for _, variant := range variants {
		normalized = append(normalized, variant.Normalized)
	}
	assert.Contains(t, normalized, normalizeFoodName("禽肉（去皮鸡胸肉）"))
	assert.Contains(t, normalized, normalizeFoodName("水煮鸡胸肉"))
	assert.Contains(t, normalized, normalizeFoodName("鸡胸肉"))

	variants = nutritionQueryVariants("一碗米饭")
	normalized = []string{}
	for _, variant := range variants {
		normalized = append(normalized, variant.Normalized)
	}
	assert.Contains(t, normalized, normalizeFoodName("白米饭"))
	assert.Contains(t, normalized, normalizeFoodName("米饭"))

	variants = nutritionQueryVariants("煮玉米")
	normalized = []string{}
	for _, variant := range variants {
		normalized = append(normalized, variant.Normalized)
	}
	assert.Contains(t, normalized, normalizeFoodName("玉米(熟)"))
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
		ProductKey:     buildPackagedProductKey("BrandA", "BrandA Protein Bar", "", "60g", 60),
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

func TestPackagedProductNormalizerParsesCiciNetContent(t *testing.T) {
	fields := PackagedProductNormalizer{}.Normalize(PackagedProductNormalizeInput{
		Brand:       "喜之郎",
		ProductName: "Cici果粒爽",
		FlavorText:  "橙汁味",
		SpecText:    "净含量:258克",
		OCRRawText:  "喜之郎 Cici 果粒爽 橙汁饮料 净含量:258克",
	})

	assert.Equal(t, 258.0, fields.NetContentValue)
	assert.Equal(t, "g", fields.NetContentUnit)
	assert.Equal(t, 258.0, fields.NetWeightG)
	assert.Contains(t, fields.DisplayName, "喜之郎")
	assert.Contains(t, fields.DisplayName, "Cici果粒爽")
	assert.Contains(t, fields.DisplayName, "橙汁味")
	assert.Contains(t, fields.DisplayName, "258g")
	assert.Contains(t, fields.ProductKey, normalizeFoodName("喜之郎Cici果粒爽橙汁味258g"))
}

func TestPackagedProductNormalizerParsesMultiUnitSpec(t *testing.T) {
	fields := PackagedProductNormalizer{}.Normalize(PackagedProductNormalizeInput{
		Brand:       "士力架",
		ProductName: "花生夹心巧克力",
		FlavorText:  "经典花生",
		SpecText:    "2条装 35g*2",
	})

	assert.Equal(t, 70.0, fields.NetContentValue)
	assert.Equal(t, "g", fields.NetContentUnit)
	assert.Equal(t, 35.0, fields.UnitContentValue)
	assert.Equal(t, 2.0, fields.UnitCount)
	assert.Equal(t, 70.0, fields.NetWeightG)
	assert.Contains(t, fields.DisplayName, "2条装")
	assert.Contains(t, fields.DisplayName, "70g")
	assert.Contains(t, fields.ProductKey, normalizeFoodName("2条装"))
	assert.Contains(t, fields.ProductKey, normalizeFoodName("70g"))
}

func TestPackagedProductNormalizerKeepsDifferentSpecsSeparate(t *testing.T) {
	normalizer := PackagedProductNormalizer{}
	spec35 := normalizer.Normalize(PackagedProductNormalizeInput{Brand: "士力架", ProductName: "花生夹心巧克力", SpecText: "35g", NetWeightG: 35})
	spec51 := normalizer.Normalize(PackagedProductNormalizeInput{Brand: "士力架", ProductName: "花生夹心巧克力", SpecText: "51g", NetWeightG: 51})
	spec70 := normalizer.Normalize(PackagedProductNormalizeInput{Brand: "士力架", ProductName: "花生夹心巧克力", SpecText: "2条装 35g*2"})

	assert.NotEqual(t, spec35.ProductKey, spec51.ProductKey)
	assert.NotEqual(t, spec35.ProductKey, spec70.ProductKey)
	assert.NotEqual(t, spec51.ProductKey, spec70.ProductKey)
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

func TestFoodNutritionRepo_UpsertPackagedFoodCreatesDifferentSpecsWithSameName(t *testing.T) {
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
	assert.Equal(t, "created", action)
	assert.NotEqual(t, first.ID, second.ID)
	assert.Equal(t, 70.0, second.NetWeightG)
	assert.Equal(t, 520.0, second.KcalPer100g)
}

func TestFoodNutritionRepo_UpsertPackagedFoodCreatesDifferentFlavorsWithSameNameAndSpec(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	first, action, err := repo.UpsertPackagedFoodWithAction(ctx, PackagedFoodInput{
		Brand:              "粟三代",
		ProductName:        "玉米薄脆",
		FlavorText:         "奥尔良烤翅味",
		SpecText:           "30g",
		ConversionStatus:   "converted",
		NetWeightG:         30,
		KcalPer100g:        650,
		CarbsPer100g:       61.5,
		FatPer100g:         41,
		NutritionBasisUnit: "100g",
	})
	require.NoError(t, err)
	assert.Equal(t, "created", action)

	second, action, err := repo.UpsertPackagedFoodWithAction(ctx, PackagedFoodInput{
		Brand:              "粟三代",
		ProductName:        "玉米薄脆",
		FlavorText:         "麻辣味",
		SpecText:           "30g",
		ConversionStatus:   "converted",
		NetWeightG:         30,
		KcalPer100g:        595,
		CarbsPer100g:       65,
		FatPer100g:         35,
		NutritionBasisUnit: "100g",
	})
	require.NoError(t, err)
	assert.Equal(t, "created", action)
	assert.NotEqual(t, first.ID, second.ID)
	assert.NotEqual(t, first.ProductKey, second.ProductKey)
	assert.Equal(t, "玉米薄脆", first.ProductName)
	assert.Equal(t, "玉米薄脆", second.ProductName)
}

func TestFoodNutritionRepo_UpsertPackagedFoodUpdatesSameBarcode(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	first, _, err := repo.UpsertPackagedFoodWithAction(ctx, PackagedFoodInput{
		Brand:              "粟三代",
		ProductName:        "玉米薄脆",
		FlavorText:         "奥尔良烤翅味",
		SpecText:           "30g",
		Barcode:            "6973029304302",
		ConversionStatus:   "converted",
		NetWeightG:         30,
		KcalPer100g:        650,
		CarbsPer100g:       61.5,
		FatPer100g:         41,
		NutritionBasisUnit: "100g",
	})
	require.NoError(t, err)

	second, action, err := repo.UpsertPackagedFoodWithAction(ctx, PackagedFoodInput{
		Brand:              "粟三代",
		ProductName:        "玉米薄脆",
		FlavorText:         "奥尔良味",
		SpecText:           "30g",
		Barcode:            "6973029304302",
		ConversionStatus:   "converted",
		NetWeightG:         30,
		KcalPer100g:        648,
		CarbsPer100g:       61.5,
		FatPer100g:         41,
		NutritionBasisUnit: "100g",
	})
	require.NoError(t, err)
	assert.Equal(t, "updated", action)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, 648.0, second.KcalPer100g)
}

func TestFoodNutritionRepo_UpsertPackagedFoodCreatesWhenSameProductKeyHasDifferentBarcode(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()

	first, _, err := repo.UpsertPackagedFoodWithAction(ctx, PackagedFoodInput{
		Brand:              "粟三代",
		ProductName:        "玉米薄脆",
		SpecText:           "30g",
		Barcode:            "6973029304302",
		ConversionStatus:   "converted",
		NetWeightG:         30,
		KcalPer100g:        650,
		CarbsPer100g:       61.5,
		FatPer100g:         41,
		NutritionBasisUnit: "100g",
	})
	require.NoError(t, err)

	second, action, err := repo.UpsertPackagedFoodWithAction(ctx, PackagedFoodInput{
		Brand:              "粟三代",
		ProductName:        "玉米薄脆",
		SpecText:           "30g",
		Barcode:            "6973029304265",
		ConversionStatus:   "converted",
		NetWeightG:         30,
		KcalPer100g:        595,
		CarbsPer100g:       65,
		FatPer100g:         35,
		NutritionBasisUnit: "100g",
	})
	require.NoError(t, err)
	assert.Equal(t, "created", action)
	assert.NotEqual(t, first.ID, second.ID)
	assert.Equal(t, first.ProductKey, second.ProductKey)
}

func TestBuildPackagedProductKeyIncludesFlavor(t *testing.T) {
	base := buildPackagedProductKey("粟三代", "玉米薄脆", "", "30g", 30)
	orleans := buildPackagedProductKey("粟三代", "玉米薄脆", "奥尔良烤翅味", "30g", 30)
	spicy := buildPackagedProductKey("粟三代", "玉米薄脆", "麻辣味", "30g", 30)

	assert.NotEqual(t, base, orleans)
	assert.NotEqual(t, orleans, spicy)
	assert.Contains(t, orleans, normalizeFoodName("奥尔良烤翅味"))
	assert.Contains(t, spicy, normalizeFoodName("麻辣味"))
}

func TestBuildPackagedProductKeyDoesNotDuplicateFlavorAlreadyInName(t *testing.T) {
	withFlavorField := buildPackagedProductKey("粟三代", "玉米薄脆奥尔良烤翅味", "奥尔良烤翅味", "30g", 30)
	withoutFlavorField := buildPackagedProductKey("粟三代", "玉米薄脆奥尔良烤翅味", "", "30g", 30)

	assert.Equal(t, withoutFlavorField, withFlavorField)
}

func TestPackagedFoodSearchTermsExtractBrandProductAndFlavor(t *testing.T) {
	terms := packagedFoodSearchTerms("喜之郎Cici果冻爽（橙味）")

	assert.Contains(t, terms, "喜之郎")
	assert.Contains(t, terms, "cici")
	assert.Contains(t, terms, "果冻爽")
	assert.Contains(t, terms, "橙味")
}

func TestPackagedFoodSearchTermsExtractTaoliBreadTokens(t *testing.T) {
	terms := packagedFoodSearchTerms("桃李豆沙小饼面包")

	assert.Contains(t, terms, "桃李")
	assert.Contains(t, terms, "豆沙小饼")
	assert.Contains(t, terms, "豆沙")
	assert.Contains(t, terms, "小饼")
	assert.Contains(t, terms, "面包")
}

func TestPackagedFoodSearchTermsExtractNescafeCoffeeTokens(t *testing.T) {
	terms := packagedFoodSearchTerms("雀巢奶香速溶咖啡固体饮料")

	assert.Contains(t, terms, "雀巢")
	assert.Contains(t, terms, "咖啡")
	assert.Contains(t, terms, "固体饮料")
}

func TestPackagedFoodSearchTermsExtractSuntorySugarfreeDrinkTokens(t *testing.T) {
	terms := packagedFoodSearchTerms("SUNTORY三得利纤漾饮荷叶茉莉花味风味饮料（无糖）")

	assert.Contains(t, terms, "suntory")
	assert.Contains(t, terms, "三得利")
	assert.Contains(t, terms, "纤漾饮")
	assert.Contains(t, terms, "饮料")
	assert.Contains(t, terms, "无糖")
}

func TestPackagedFoodSearchTermsExtractCiciFruitDrinkTokens(t *testing.T) {
	terms := packagedFoodSearchTerms("Cici果粒爽橙味")

	assert.Contains(t, terms, "cici")
	assert.Contains(t, terms, "果粒爽")
	assert.Contains(t, terms, "橙味")
}

func TestPackagedFoodFuzzyQueryKeepsInputEvidence(t *testing.T) {
	query := packagedFoodFuzzyQuery("Cici果粒爽橙味", "喜之郎", "", "橙味", "")

	assert.Contains(t, query, "Cici果粒爽橙味")
	assert.Contains(t, query, "喜之郎")
	assert.Contains(t, query, "橙味")
}

func TestIsGenericPackagedResolveQuery(t *testing.T) {
	assert.True(t, isGenericPackagedResolveQuery("面包"))
	assert.True(t, isGenericPackagedResolveQuery("酸奶"))
	assert.False(t, isGenericPackagedResolveQuery("桃李豆沙小饼面包"))
	assert.False(t, isGenericPackagedResolveQuery("三得利无糖荷叶茉莉饮料500ml"))
}

func TestPackagedFoodSearchScoreMatchesCiciOrangeJellyDrink(t *testing.T) {
	flavor := "橙味"
	spec := "258g"
	category := "果冻饮料"
	food := domain.PackagedFood{
		ID:              "pkg-cici-orange",
		Brand:           "喜之郎",
		ProductName:     "喜之郎 CiCi 果冻爽 橙汁饮料",
		NormalizedName:  normalizeFoodName("喜之郎 CiCi 果冻爽 橙汁饮料"),
		FlavorText:      &flavor,
		SpecText:        &spec,
		PackageCategory: &category,
		NetWeightG:      258,
	}
	unrelated := domain.PackagedFood{
		ID:             "pkg-other",
		Brand:          "伊利",
		ProductName:    "伊利巧乐兹低糖抹茶可可味雪糕",
		NormalizedName: normalizeFoodName("伊利巧乐兹低糖抹茶可可味雪糕"),
		NetWeightG:     50,
	}

	assert.Greater(t, packagedFoodSearchScore("喜之郎Cici果冻爽（橙味）", food), 0.65)
	assert.Greater(t, packagedFoodSearchScore("喜之郎Cici果冻爽（橙味）", food), packagedFoodSearchScore("喜之郎Cici果冻爽（橙味）", unrelated))
}

func TestPackagedFoodSearchScoreMatchesSuntorySugarfreeDrink(t *testing.T) {
	category := "风味饮料"
	spec := "500ml"
	food := domain.PackagedFood{
		ID:              "pkg-suntory-sugarfree",
		Brand:           "SUNTORY三得利",
		ProductName:     "汲赏 纤漾饮 荷叶茉莉花味风味饮料（无糖）",
		DisplayName:     "SUNTORY三得利 汲赏 纤漾饮 荷叶茉莉花味风味饮料（无糖） 500ml",
		NormalizedName:  normalizeFoodName("SUNTORY三得利 汲赏 纤漾饮 荷叶茉莉花味风味饮料（无糖）"),
		SpecText:        &spec,
		PackageCategory: &category,
		NetContentValue: 500,
	}
	unrelated := domain.PackagedFood{
		ID:             "pkg-rice",
		Brand:          "桃李",
		ProductName:    "豆沙小饼面包",
		NormalizedName: normalizeFoodName("桃李豆沙小饼面包"),
		NetWeightG:     55,
	}

	query := "SUNTORY三得利纤漾饮荷叶茉莉花味风味饮料（无糖）"
	assert.Greater(t, packagedFoodSearchScore(query, food), 0.65)
	assert.Greater(t, packagedFoodSearchScore(query, food), packagedFoodSearchScore(query, unrelated))
}

func TestPackagedFoodSearchScorePrefersMatchingFlavor(t *testing.T) {
	orangeFlavor := "橙汁"
	grapeFlavor := "红葡萄"
	spec := "净含量:258克"
	orange := domain.PackagedFood{
		ID:          "pkg-cici-orange",
		Brand:       "喜之郎",
		ProductName: "cici果粒爽 橙汁饮料",
		FlavorText:  &orangeFlavor,
		SpecText:    &spec,
		NetWeightG:  258,
	}
	grape := domain.PackagedFood{
		ID:          "pkg-cici-grape",
		Brand:       "喜之郎",
		ProductName: "cici果粒可吸红葡萄汁饮料",
		FlavorText:  &grapeFlavor,
		SpecText:    &spec,
		NetWeightG:  258,
	}

	query := "喜之郎Cici果冻爽（橙味）"
	assert.Greater(t, packagedFoodSearchScore(query, orange), packagedFoodSearchScore(query, grape))
}
