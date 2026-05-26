package repo

import (
	"context"
	"testing"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	publicdomain "food_link/backend/internal/publicfood/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&fooddomain.FoodNutrition{},
		&fooddomain.FoodNutritionAlias{},
		&publicdomain.PublicFoodItem{},
		&publicdomain.PublicFoodCollection{},
	))
	require.NoError(t, db.Exec(`
		CREATE TABLE user_food_records (
			id TEXT PRIMARY KEY,
			user_id TEXT,
			items JSON,
			record_time DATETIME
		)
	`).Error)
	return db
}

func TestManualFoodRepo_Browse(t *testing.T) {
	db := setupTestDB(t)
	r := NewManualFoodRepo(db, storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL: "https://cdn.example.com/food",
	}))
	ctx := context.Background()

	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "n1",
		CanonicalName:  "鸡蛋",
		NormalizedName: "鸡蛋",
		KcalPer100g:    144,
		ProteinPer100g: 13,
		CarbsPer100g:   1.1,
		FatPer100g:     9.4,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&fooddomain.FoodNutritionAlias{ID: "a1", FoodID: "n1", AliasName: "蛋"}).Error)
	require.NoError(t, db.Create(&publicdomain.PublicFoodItem{
		ID:              "p1",
		UserID:          "u2",
		FoodName:        "轻食鸡胸沙拉",
		Description:     "低卡午餐",
		ImagePaths:      []string{"salad.jpg"},
		TotalCalories:   320,
		TotalProtein:    28,
		TotalCarbs:      18,
		TotalFat:        12,
		CollectionCount: 3,
		LikeCount:       2,
		Status:          "published",
	}).Error)
	require.NoError(t, db.Create(&publicdomain.PublicFoodCollection{
		ID:            "c1",
		UserID:        "u1",
		LibraryItemID: "p1",
	}).Error)
	require.NoError(t, db.Exec(`
		INSERT INTO user_food_records (id, user_id, items, record_time) VALUES
		('r1', 'u1', '[{"name":"鸡蛋","manual_source":"nutrition_library","manual_source_id":"n1","manual_source_title":"鸡蛋","manual_portion_label":"100g","intake":100,"nutrients":{"calories":144,"protein":13,"carbs":1.1,"fat":9.4}}]', CURRENT_TIMESTAMP)
	`).Error)

	result, err := r.Browse(ctx, "u1", 10)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.EqualValues(t, 1, result.Stats.NutritionFoodCount)
	assert.EqualValues(t, 1, result.Stats.PublicFoodCount)
	require.Len(t, result.NutritionLibrary, 1)
	assert.Equal(t, "鸡蛋", result.NutritionLibrary[0].Title)
	require.Len(t, result.PublicLibrary, 1)
	assert.Equal(t, "轻食鸡胸沙拉", result.PublicLibrary[0].Title)
	assert.Equal(t, "https://cdn.example.com/food/salad.jpg", *result.PublicLibrary[0].ImagePath)
	require.Len(t, result.RecentItems, 1)
	assert.Equal(t, "nutrition_library", result.RecentItems[0].Source)
	require.Len(t, result.CollectedPublicLibrary, 1)
	assert.True(t, result.CollectedPublicLibrary[0].Collected)
}

func TestManualFoodRepo_Search(t *testing.T) {
	db := setupTestDB(t)
	r := NewManualFoodRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "n1",
		CanonicalName:  "西兰花",
		NormalizedName: "西兰花",
		KcalPer100g:    34,
		ProteinPer100g: 2.8,
		CarbsPer100g:   7,
		FatPer100g:     0.4,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&fooddomain.FoodNutritionAlias{
		ID:              "a1",
		FoodID:          "n1",
		AliasName:       "花椰菜",
		NormalizedAlias: "花椰菜",
	}).Error)
	require.NoError(t, db.Create(&publicdomain.PublicFoodItem{
		ID:            "p1",
		UserID:        "u2",
		FoodName:      "西兰花鸡胸饭",
		MerchantName:  "轻食店",
		Description:   "减脂便当",
		TotalCalories: 380,
		TotalProtein:  30,
		TotalCarbs:    42,
		TotalFat:      8,
		Status:        "published",
	}).Error)

	items, err := r.Search(ctx, "u1", "西兰花", 10)
	require.NoError(t, err)
	require.Len(t, items, 2)
	assert.Equal(t, "西兰花鸡胸饭", items[0].Title)
	assert.Equal(t, "西兰花", items[1].Title)

	aliasItems, err := r.Search(ctx, "u1", "花椰菜", 10)
	require.NoError(t, err)
	require.Len(t, aliasItems, 1)
	assert.Equal(t, "西兰花", aliasItems[0].Title)
	assert.Equal(t, "nutrition_library", aliasItems[0].Source)
}

func TestExpandedSearchTerms_Rice(t *testing.T) {
	terms := expandedSearchTerms("饭")
	assert.Contains(t, terms, "饭")
	assert.Contains(t, terms, "米饭")
	assert.Contains(t, terms, "白米饭")
	assert.Contains(t, terms, "rice")
}

func TestInferManualFoodCategory(t *testing.T) {
	assert.Equal(t, "staple", inferManualFoodCategory("白米饭", "nutrition_library"))
	assert.Equal(t, "protein", inferManualFoodCategory("鸡胸肉", "nutrition_library"))
	assert.Equal(t, "meal", inferManualFoodCategory("轻食鸡胸沙拉套餐", "public_library"))
	assert.Equal(t, "beverage", inferManualFoodCategory("黑咖啡", "nutrition_library"))
	assert.Equal(t, "beverage", inferManualFoodCategory("拿铁咖啡", "nutrition_library"))
	assert.Equal(t, "soup", inferManualFoodCategory("清汤", "nutrition_library"))
	assert.Equal(t, "protein", inferManualFoodCategory("红烧肉", "nutrition_library"))
	assert.Equal(t, "staple", inferManualFoodCategory("全麦吐司", "nutrition_library"))
	assert.Equal(t, "snack", inferManualFoodCategory("坚果饼干", "nutrition_library"))
	assert.Equal(t, "snack", inferManualFoodCategory("抹茶蛋糕", "nutrition_library"))
	assert.Equal(t, "protein", inferManualFoodCategory("茶叶蛋", "nutrition_library"))
	assert.Equal(t, "dairy", inferManualFoodCategory("无糖酸奶", "nutrition_library"))
	assert.NotContains(t, manualFoodCategoryFilterSQL("canonical_name", "snack"), "%糖%")
	assert.Contains(t, manualFoodCategoryFilterSQL("canonical_name", "snack"), "%方糖%")
}

func TestManualFoodServingProfile(t *testing.T) {
	egg := manualFoodResultFromNutrition(fooddomain.FoodNutrition{
		ID:             "egg",
		CanonicalName:  "鸡蛋",
		KcalPer100g:    144,
		ProteinPer100g: 13,
		CarbsPer100g:   1.1,
		FatPer100g:     9.4,
	}, 0)
	assert.Equal(t, "piece", egg.DisplayUnit)
	assert.Equal(t, "个", egg.DisplayUnitLabel)
	assert.Equal(t, 55.0, egg.DefaultWeightGrams)
	assert.Equal(t, "1个", egg.PortionLabel)
	require.Len(t, egg.ServingPresets, 3)
	assert.Equal(t, "1个", egg.ServingPresets[1].Label)

	coffee := manualFoodResultFromNutrition(fooddomain.FoodNutrition{
		ID:            "coffee",
		CanonicalName: "黑咖啡",
		KcalPer100g:   2,
	}, 0)
	assert.Equal(t, "beverage", coffee.Category)
	assert.Equal(t, "ml", coffee.DisplayUnit)
	assert.Equal(t, 350.0, coffee.DefaultWeightGrams)
	require.Len(t, coffee.ServingPresets, 3)
	assert.Equal(t, "450ml", coffee.ServingPresets[1].Label)
}

func TestManualFoodCatalogUserScopedCategoriesAllowAnonymous(t *testing.T) {
	repo := &ManualFoodRepo{}

	recent, hasMore, err := repo.listCatalogItems(context.Background(), "", "recent", 1, 20)
	require.NoError(t, err)
	assert.False(t, hasMore)
	assert.Empty(t, recent)

	favorites, hasMore, err := repo.listCatalogItems(context.Background(), "", "favorites", 1, 20)
	require.NoError(t, err)
	assert.False(t, hasMore)
	assert.Empty(t, favorites)
}

func TestManualFoodCategoryFilterSQL(t *testing.T) {
	for _, category := range []string{"staple", "protein", "vegetable", "fruit", "dairy", "beverage", "soup", "snack", "meal", "other"} {
		sql := manualFoodCategoryFilterSQL("canonical_name", category)
		assert.NotEmpty(t, sql)
		assert.NotContains(t, sql, "CASE")
		assert.NotContains(t, sql, "= ?")
		assert.NotContains(t, sql, "\nAND")
	}
	assert.Contains(t, manualFoodCategoryFilterSQL("canonical_name", "meal"), "%餐%")
	assert.Contains(t, manualFoodCategoryFilterSQL("canonical_name", "other"), "NOT (")
}
