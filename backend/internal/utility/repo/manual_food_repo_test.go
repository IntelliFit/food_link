package repo

import (
	"context"
	"testing"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	publicdomain "food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/utility/domain"
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

func TestManualFoodResultFromPackagedUsesOnlyPrimaryImage(t *testing.T) {
	spec := "15g*6袋"
	basis := "100g"
	flavor := "番茄味"
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:                 "pkg1",
		Brand:              "样例品牌",
		ProductName:        "薯片",
		DisplayName:        "样例品牌 薯片 番茄味 90g",
		FlavorText:         &flavor,
		SpecText:           &spec,
		NutritionBasisUnit: &basis,
		SourceImageURLs:    []string{"https://cdn.example.com/front.jpg", "https://cdn.example.com/nutrition.jpg"},
		NetWeightG:         90,
		KcalPer100g:        520,
		ProteinPer100g:     6,
		CarbsPer100g:       60,
		FatPer100g:         28,
	}, 0.9)

	require.NotNil(t, item.ImagePath)
	assert.Equal(t, "https://cdn.example.com/front.jpg", *item.ImagePath)
	assert.Equal(t, []string{"https://cdn.example.com/front.jpg"}, item.ImagePaths)
	assert.Equal(t, "packaged_food", item.Source)
	assert.Equal(t, "样例品牌 薯片 番茄味 90g", item.Title)
	assert.Equal(t, "包装食品", item.SourceLabel)
	assert.Equal(t, "snack", item.Category)
	assert.Equal(t, "g", item.DisplayUnit)
	assert.Equal(t, 90.0, item.DefaultWeightGrams)
	assert.Equal(t, 468.0, item.TotalCalories)
	assert.Equal(t, 54.0, item.TotalCarbs)
	assert.Equal(t, 25.2, item.TotalFat)
	assert.Equal(t, 520.0, item.NutrientsPer100g.Calories)
	assert.Contains(t, item.Title, "番茄味")
}

func TestManualFoodRepoPackagedResultResolvesFoodImageKeys(t *testing.T) {
	r := NewManualFoodRepo(nil, storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL: "https://cdn-food-images.example.com",
	}))
	item := r.manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:              "pkg-key",
		Brand:           "样例品牌",
		ProductName:     "能量棒",
		SourceImageURLs: []string{"packaged/front.jpg", "packaged/nutrition.jpg"},
		KcalPer100g:     410,
		ProteinPer100g:  20,
		CarbsPer100g:    45,
		FatPer100g:      12,
	}, 0.8)

	require.NotNil(t, item.ImagePath)
	assert.Equal(t, "https://cdn-food-images.example.com/packaged/front.jpg", *item.ImagePath)
	assert.Equal(t, []string{"https://cdn-food-images.example.com/packaged/front.jpg"}, item.ImagePaths)
}

func TestManualFoodResultFromPackagedUsesNetContentValue(t *testing.T) {
	unit := "g"
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:              "pkg-net-content",
		Brand:           "士力架",
		ProductName:     "花生夹心巧克力",
		NetContentValue: 70,
		NetContentUnit:  &unit,
		KcalPer100g:     487,
		ProteinPer100g:  8.6,
		CarbsPer100g:    62,
		FatPer100g:      24,
	}, 0.9)

	assert.Equal(t, "士力架 花生夹心巧克力 70g", item.Title)
	assert.Equal(t, 70.0, item.DefaultWeightGrams)
	assert.InDelta(t, 340.9, item.TotalCalories, 0.01)
	assert.InDelta(t, 43.4, item.TotalCarbs, 0.01)
	assert.Equal(t, "70g", item.PortionLabel)
	assert.Contains(t, item.NutritionHighlights, "净含量 70g")
}

func TestManualFoodResultFromPackagedScalesPer100gToServingWeight(t *testing.T) {
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:              "pkg-pocky",
		Brand:           "格力高",
		ProductName:     "百奇巧克力味",
		ServingWeightG:  25,
		KcalPer100g:     504,
		ProteinPer100g:  9.7,
		CarbsPer100g:    64.5,
		FatPer100g:      22.8,
		SodiumMgPer100g: 220,
	}, 0.9)

	assert.Equal(t, 25.0, item.DefaultWeightGrams)
	assert.Equal(t, "25g", item.PortionLabel)
	assert.Equal(t, 126.0, item.TotalCalories)
	assert.InDelta(t, 2.425, item.TotalProtein, 0.001)
	assert.InDelta(t, 16.125, item.TotalCarbs, 0.001)
	assert.InDelta(t, 5.7, item.TotalFat, 0.001)
	assert.Equal(t, 504.0, item.NutrientsPer100g.Calories)
	assert.Equal(t, 64.5, item.NutrientsPer100g.Carbs)
	assert.Equal(t, 55.0, item.ExtraNutrients.SodiumMg)
}

func TestEnrichManualFoodResultsWithNutritionLibrary(t *testing.T) {
	db := setupTestDB(t)
	imgKey := "standard-food/backfill/rice.png"
	r := NewManualFoodRepo(db, storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL: "https://cdn-food-images.example.com",
	}))
	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "rice-uuid",
		CanonicalName:  "白米饭",
		NormalizedName: "白米饭",
		ImagePath:      &imgKey,
		ImagePaths:     []string{imgKey},
		KcalPer100g:    116,
		ProteinPer100g: 2.6,
		CarbsPer100g:   25.9,
		FatPer100g:     0.3,
		IsActive:       true,
	}).Error)

	items := r.enrichManualFoodResultsWithNutritionLibrary(context.Background(), []domain.ManualFoodResult{{
		ID:                 "catalog:白米饭",
		Source:             "nutrition_library",
		Title:              "白米饭",
		Subtitle:           "常用食物",
		DefaultWeightGrams: 178,
	}})

	require.Len(t, items, 1)
	assert.Equal(t, "rice-uuid", items[0].ID)
	require.NotNil(t, items[0].ImagePath)
	assert.Equal(t, "https://cdn-food-images.example.com/standard-food/backfill/rice.png", *items[0].ImagePath)
	require.NotEmpty(t, items[0].ImagePaths)
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

func TestMergeManualFoodNutrients_KeepsExistingMacrosAndBackfillsMicros(t *testing.T) {
	existing := &domain.ManualFoodNutrients{
		Calories: 127.5,
		Protein:  2.8,
		Carbs:    27.5,
		Fat:      0.3,
	}
	library := &domain.ManualFoodNutrients{
		Calories:    116,
		Protein:     2.6,
		Carbs:       25.9,
		Fat:         0.3,
		Fiber:       0.4,
		SodiumMg:    2,
		PotassiumMg: 35,
	}
	merged := mergeManualFoodNutrients(existing, library)
	require.NotNil(t, merged)
	// 宏量营养素应保留原有值（来自真实记录的比例）
	assert.InDelta(t, 127.5, merged.Calories, 0.01)
	assert.InDelta(t, 2.8, merged.Protein, 0.01)
	assert.InDelta(t, 27.5, merged.Carbs, 0.01)
	assert.InDelta(t, 0.3, merged.Fat, 0.01)
	// 微量元素应从营养库补齐
	assert.InDelta(t, 0.4, merged.Fiber, 0.01)
	assert.InDelta(t, 2, merged.SodiumMg, 0.01)
	assert.InDelta(t, 35, merged.PotassiumMg, 0.01)
}

func TestMergeManualFoodNutrients_FallsBackToLibraryWhenExistingMissingMacros(t *testing.T) {
	existing := &domain.ManualFoodNutrients{
		Fiber: 0.4,
	}
	library := &domain.ManualFoodNutrients{
		Calories: 116,
		Protein:  2.6,
		Carbs:    25.9,
		Fat:      0.3,
	}
	merged := mergeManualFoodNutrients(existing, library)
	require.NotNil(t, merged)
	assert.InDelta(t, 116, merged.Calories, 0.01)
	assert.InDelta(t, 2.6, merged.Protein, 0.01)
	assert.InDelta(t, 25.9, merged.Carbs, 0.01)
	assert.InDelta(t, 0.3, merged.Fat, 0.01)
	assert.InDelta(t, 0.4, merged.Fiber, 0.01)
}

func TestMergeManualFoodNutrients_ReturnsLibraryWhenExistingNil(t *testing.T) {
	library := &domain.ManualFoodNutrients{Calories: 116}
	merged := mergeManualFoodNutrients(nil, library)
	require.NotNil(t, merged)
	assert.InDelta(t, 116, merged.Calories, 0.01)
}
