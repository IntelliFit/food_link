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
	assert.Equal(t, "Macro Only", items[0].CanonicalName)
	assert.Equal(t, "Has Vitamin", items[1].CanonicalName)

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
	assert.Equal(t, "deepseek_auto", food.Source)
}
