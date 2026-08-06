package repo

import (
	"context"
	"encoding/json"
	"testing"

	fooddomain "food_link/backend/internal/foodrecord/domain"
	publicdomain "food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/utility/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"food_link/backend/pkg/testdb"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(
		&fooddomain.FoodNutrition{},
		&fooddomain.FoodNutritionAlias{},
		&fooddomain.PackagedFood{},
		&publicdomain.PublicFoodItem{},
		&publicdomain.PublicFoodCollection{},
		&domain.UserCustomFood{},
	))
	require.NoError(t, db.Exec(`
		CREATE TABLE user_food_records (
			id TEXT PRIMARY KEY,
			user_id TEXT,
			items JSONB,
			record_time TIMESTAMPTZ
		)
	`).Error)
	require.NoError(t, db.Exec(`
		ALTER TABLE public_food_library ALTER COLUMN items TYPE jsonb USING items::jsonb
	`).Error)
	require.NoError(t, db.Exec(`
		ALTER TABLE packaged_food_library ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()
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
		QualityTier:    fooddomain.NutritionQualityLegacyCurated,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&fooddomain.FoodNutritionAlias{ID: "a1", FoodID: "n1", AliasName: "蛋", MatchStatus: fooddomain.NutritionAliasApprovedExact}).Error)
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
		QualityTier:    fooddomain.NutritionQualityLegacyCurated,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&fooddomain.FoodNutritionAlias{
		ID:              "a1",
		FoodID:          "n1",
		AliasName:       "花椰菜",
		NormalizedAlias: "花椰菜",
		MatchStatus:     fooddomain.NutritionAliasApprovedExact,
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
	assert.Equal(t, "西兰花", items[0].Title)
	assert.Equal(t, "西兰花鸡胸饭", items[1].Title)

	aliasItems, err := r.Search(ctx, "u1", "花椰菜", 10)
	require.NoError(t, err)
	require.Len(t, aliasItems, 1)
	assert.Equal(t, "西兰花", aliasItems[0].Title)
	assert.Equal(t, "nutrition_library", aliasItems[0].Source)
}

func TestManualFoodRepoSearchDedupesAliasesAfterNutritionMapping(t *testing.T) {
	db := setupTestDB(t)
	r := NewManualFoodRepo(db)
	ctx := context.Background()

	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "taiwan-sausage",
		CanonicalName:  "台式烤香肠",
		NormalizedName: "台式烤香肠",
		KcalPer100g:    350,
		ProteinPer100g: 17,
		CarbsPer100g:   6,
		FatPer100g:     28,
		QualityTier:    fooddomain.NutritionQualityLegacyCurated,
		IsActive:       true,
	}).Error)
	for _, alias := range []struct {
		id   string
		name string
	}{
		{id: "taiwan-sausage-alias-1", name: "烤香肠"},
		{id: "taiwan-sausage-alias-2", name: "台式烤香肠"},
	} {
		require.NoError(t, db.Create(&fooddomain.FoodNutritionAlias{
			ID:              alias.id,
			FoodID:          "taiwan-sausage",
			AliasName:       alias.name,
			NormalizedAlias: alias.name,
			MatchStatus:     fooddomain.NutritionAliasApprovedExact,
		}).Error)
	}
	require.NoError(t, db.Exec(`
		INSERT INTO user_food_records (id, user_id, items, record_time) VALUES
		('r1', 'u1', '[{"name":"烤香肠","intake":51,"nutrients":{"calories":178.5,"protein":8.67,"carbs":3.06,"fat":14.28}}]', CURRENT_TIMESTAMP),
		('r2', 'u2', '[{"name":"烤香肠","intake":51,"nutrients":{"calories":178.5,"protein":8.67,"carbs":3.06,"fat":14.28}}]', CURRENT_TIMESTAMP),
		('r3', 'u1', '[{"name":"台式烤香肠","intake":51,"nutrients":{"calories":178.5,"protein":8.67,"carbs":3.06,"fat":14.28}}]', CURRENT_TIMESTAMP),
		('r4', 'u2', '[{"name":"台式烤香肠","intake":51,"nutrients":{"calories":178.5,"protein":8.67,"carbs":3.06,"fat":14.28}}]', CURRENT_TIMESTAMP)
	`).Error)

	items, err := r.Search(ctx, "u1", "烤香肠", 20)
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, "taiwan-sausage", items[0].ID)
	assert.Equal(t, "烤香肠", items[0].Title)
	assert.Equal(t, "nutrition_library", items[0].Source)
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

func TestManualFoodServingProfileUsesWholeEggPortionForTeaEgg(t *testing.T) {
	teaEgg := manualFoodResultFromFrequentRecord(
		"茶叶蛋",
		56,
		87.16964285714286,
		142.68892857142856,
		12.040921717171717,
		1.5992406204906204,
		9.752362914862914,
		json.RawMessage(`{
			"name":"茶叶蛋",
			"weight":87.16964285714286,
			"nutrients":{
				"calories":142.68892857142856,
				"protein":12.040921717171717,
				"carbs":1.5992406204906204,
				"fat":9.752362914862914
			}
		}`),
	)

	assert.Equal(t, "piece", teaEgg.DisplayUnit)
	assert.Equal(t, "个", teaEgg.DisplayUnitLabel)
	assert.Equal(t, 55.0, teaEgg.DefaultWeightGrams)
	assert.Equal(t, "1个", teaEgg.PortionLabel)
	assert.InDelta(t, 90.03, teaEgg.TotalCalories, 0.01)
	require.Len(t, teaEgg.ServingPresets, 3)
}

func TestFrequentFoodKeepsAggregatedMacrosWhenRepresentativeRecordDiffers(t *testing.T) {
	item := manualFoodResultFromFrequentRecord(
		"茶叶蛋",
		56,
		87.16964285714286,
		142.68892857142856,
		12.040921717171717,
		1.5992406204906204,
		9.752362914862914,
		json.RawMessage(`{
			"name":"茶叶蛋",
			"weight":50,
			"nutrients":{
				"calories":100,
				"protein":10,
				"carbs":2,
				"fat":6,
				"sodiumMg":100
			}
		}`),
	)

	assert.InDelta(t, 163.69, item.NutrientsPer100g.Calories, 0.01)
	assert.InDelta(t, 13.81, item.NutrientsPer100g.Protein, 0.01)
	assert.InDelta(t, 90.03, item.TotalCalories, 0.01)
	assert.InDelta(t, 110, item.ExtraNutrients.SodiumMg, 0.01)
}

func TestIsEggLikeFoodRejectsEggComponentsAndCompoundFoods(t *testing.T) {
	assert.False(t, isEggLikeFood("茶叶蛋蛋白"))
	assert.False(t, isEggLikeFood("鸡蛋面"))
	assert.False(t, isEggLikeFood("番茄炒鸡蛋"))
	assert.False(t, isEggLikeFood("鹌鹑蛋"))
	assert.False(t, isEggLikeFood("eggplant"))
	assert.False(t, isEggLikeFood("egg white"))
	assert.True(t, isEggLikeFood("茶叶蛋/煮鸡蛋"))
}

func TestManualFoodServingProfileUsesSpecificEggComponentWeights(t *testing.T) {
	tests := []struct {
		name   string
		weight float64
	}{
		{name: "茶叶蛋蛋白", weight: 33},
		{name: "鸡蛋蛋黄", weight: 17},
		{name: "卤鹌鹑蛋", weight: 10},
		{name: "咸鸭蛋", weight: 65},
		{name: "鹅蛋", weight: 180},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			item := manualFoodResultFromFrequentRecord(tt.name, 6, 65.8333333333, 33.6333333333, 7.345, 0.568, 0.12, nil)
			assert.Equal(t, "piece", item.DisplayUnit)
			assert.Equal(t, tt.weight, item.DefaultWeightGrams)
			require.Len(t, item.ServingPresets, 3)
			assert.Equal(t, tt.weight, item.ServingPresets[1].Grams)
		})
	}

	proteinPowder := manualFoodResultFromFrequentRecord("乳清蛋白粉", 6, 31.25, 120, 24, 3, 2, nil)
	assert.Equal(t, "g", proteinPowder.DisplayUnit)
	assert.Equal(t, 31.0, proteinPowder.DefaultWeightGrams)
}

func TestFrequentFoodRoundsHistoricalAverageWeightWithoutChangingDensity(t *testing.T) {
	item := manualFoodResultFromFrequentRecord("鸡胸肉", 10, 65.8333333333, 100, 20, 0, 2, nil)
	assert.Equal(t, 66.0, item.DefaultWeightGrams)
	assert.Equal(t, "66g", item.PortionLabel)
	assert.InDelta(t, 151.8987, item.NutrientsPer100g.Calories, 0.001)
	assert.InDelta(t, 100.2532, item.TotalCalories, 0.001)
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
	spec := "营养成分表每份25克"
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:              "pkg-pocky",
		Brand:           "格力高",
		ProductName:     "百奇巧克力味",
		SpecText:        &spec,
		NetWeightG:      50,
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

func TestManualFoodResultFromPackagedRejectsPockyServingWithoutEvidence(t *testing.T) {
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:             "pkg-pocky-legacy",
		Brand:          "格力高",
		ProductName:    "百奇巧克力味 50g",
		NetWeightG:     50,
		ServingWeightG: 25,
		KcalPer100g:    504,
	}, 0.9)

	assert.Equal(t, 50.0, item.DefaultWeightGrams)
	assert.Equal(t, "50g", item.PortionLabel)
	assert.Equal(t, 252.0, item.TotalCalories)
}

func TestManualFoodResultFromPackagedRejectsServingWeightAboveNetWeight(t *testing.T) {
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:             "pkg-sausage",
		ProductName:    "火腿肠",
		NetWeightG:     45,
		ServingWeightG: 100,
		KcalPer100g:    185,
		ProteinPer100g: 12.5,
		CarbsPer100g:   7,
		FatPer100g:     12,
	}, 0.9)

	assert.Equal(t, 45.0, item.DefaultWeightGrams)
	assert.Equal(t, "45g", item.PortionLabel)
	assert.InDelta(t, 83.25, item.TotalCalories, 0.01)
}

func TestIsPhysicallyImplausibleFrequentFood(t *testing.T) {
	assert.True(t, isPhysicallyImplausibleFrequentFood(22.93, 239.6, 8, 12, 17.8))
	assert.True(t, isPhysicallyImplausibleFrequentFood(10, 164.2, 8, 10, 10.27))
	assert.False(t, isPhysicallyImplausibleFrequentFood(55, 85, 6.8, 0.8, 6))
	assert.False(t, isPhysicallyImplausibleFrequentFood(25, 126, 2.4, 16.1, 5.7))
}

func TestManualFoodResultFromPackagedScalesNutrientsToDefaultWeight(t *testing.T) {
	unit := "g"
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:              "pkg-scaled",
		Brand:           "测试品牌",
		ProductName:     "测试饼干",
		NetContentValue: 200,
		NetContentUnit:  &unit,
		KcalPer100g:     300,
		ProteinPer100g:  10,
		CarbsPer100g:    50,
		FatPer100g:      12,
		FiberPer100g:    5,
		SodiumMgPer100g: 200,
	}, 0.9)

	assert.Equal(t, 200.0, item.DefaultWeightGrams)
	// Total* 应该按 defaultWeight/100 缩放到 200g 份量
	assert.InDelta(t, 600.0, item.TotalCalories, 0.001)
	assert.InDelta(t, 20.0, item.TotalProtein, 0.001)
	assert.InDelta(t, 100.0, item.TotalCarbs, 0.001)
	assert.InDelta(t, 24.0, item.TotalFat, 0.001)
	// NutrientsPer100g 保持每100克口径不变
	require.NotNil(t, item.NutrientsPer100g)
	assert.InDelta(t, 300.0, item.NutrientsPer100g.Calories, 0.001)
	assert.InDelta(t, 10.0, item.NutrientsPer100g.Protein, 0.001)
	// ExtraNutrients 也应缩放到 200g 份量，供前端按份缩放时使用
	require.NotNil(t, item.ExtraNutrients)
	assert.InDelta(t, 600.0, item.ExtraNutrients.Calories, 0.001)
	assert.InDelta(t, 10.0, item.ExtraNutrients.Fiber, 0.001)
	assert.InDelta(t, 400.0, item.ExtraNutrients.SodiumMg, 0.001)
}

func TestManualFoodResultFromPackagedScalesNutritionByDefaultPortion(t *testing.T) {
	basis := "100g"
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:                 "pkg-cookie",
		ProductName:        "cookie",
		NutritionBasisUnit: &basis,
		NetWeightG:         50,
		KcalPer100g:        480,
		ProteinPer100g:     6,
		CarbsPer100g:       68,
		FatPer100g:         20,
	}, 0.9)

	assert.Equal(t, 50.0, item.DefaultWeightGrams)
	assert.Equal(t, "50g", item.PortionLabel)
	assert.InDelta(t, 240, item.TotalCalories, 0.01)
	assert.InDelta(t, 3, item.TotalProtein, 0.01)
	assert.InDelta(t, 34, item.TotalCarbs, 0.01)
	assert.InDelta(t, 10, item.TotalFat, 0.01)
}

func TestManualFoodResultFromPackagedBeverageCapsAbnormalNetContent(t *testing.T) {
	basis := "100ml"
	unit := "ml"
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:                 "pkg-lemon-tea",
		ProductName:        "lemon tea",
		NutritionBasisUnit: &basis,
		NetContentValue:    2500,
		NetContentUnit:     &unit,
		KcalPer100g:        36,
		ProteinPer100g:     0,
		CarbsPer100g:       9,
		FatPer100g:         0,
	}, 0.9)

	assert.Equal(t, "beverage", item.Category)
	assert.Equal(t, "ml", item.DisplayUnit)
	assert.Equal(t, 500.0, item.DefaultWeightGrams)
	assert.Equal(t, "500ml", item.PortionLabel)
	assert.InDelta(t, 180, item.TotalCalories, 0.01)
	assert.InDelta(t, 45, item.TotalCarbs, 0.01)
}

func TestManualFoodResultFromPackagedBeverageCapsAbnormalServingWeight(t *testing.T) {
	basis := "100ml"
	item := manualFoodResultFromPackaged(fooddomain.PackagedFood{
		ID:                 "pkg-oat-drink",
		ProductName:        "oat drink",
		NutritionBasisUnit: &basis,
		ServingWeightG:     1000,
		KcalPer100g:        91.5,
		ProteinPer100g:     0.8,
		CarbsPer100g:       10,
		FatPer100g:         5.4,
	}, 0.9)

	assert.Equal(t, "beverage", item.Category)
	assert.Equal(t, "ml", item.DisplayUnit)
	assert.Equal(t, 500.0, item.DefaultWeightGrams)
	assert.Equal(t, "500ml", item.PortionLabel)
	assert.InDelta(t, 457.5, item.TotalCalories, 0.01)
}

func TestManualFoodServingProfileTreatsPowderAsSolid(t *testing.T) {
	item := manualFoodResultFromNutrition(fooddomain.FoodNutrition{
		ID:             "instant-coffee-powder",
		CanonicalName:  "雀巢奶香速溶咖啡固体饮料",
		KcalPer100g:    420,
		ProteinPer100g: 6,
		CarbsPer100g:   70,
		FatPer100g:     15,
	}, 0)

	assert.Equal(t, "g", item.DisplayUnit)
	assert.Equal(t, 100.0, item.DefaultWeightGrams)
	assert.Equal(t, 420.0, item.TotalCalories)
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
		QualityTier:    fooddomain.NutritionQualityLegacyCurated,
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

func TestEnrichManualFoodPrefersExactCanonicalNameOverAliasTarget(t *testing.T) {
	db := setupTestDB(t)
	exactImage := "standard-food/tea-egg.jpg"
	aliasImage := "standard-food/egg.jpg"
	r := NewManualFoodRepo(db)
	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "tea-egg",
		CanonicalName:  "茶叶蛋",
		NormalizedName: "茶叶蛋",
		ImagePath:      &exactImage,
		ImagePaths:     []string{exactImage},
		KcalPer100g:    155,
		QualityTier:    fooddomain.NutritionQualityLegacyCurated,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "whole-egg",
		CanonicalName:  "鸡蛋(全蛋)",
		NormalizedName: "鸡蛋全蛋",
		ImagePath:      &aliasImage,
		ImagePaths:     []string{aliasImage},
		KcalPer100g:    144,
		QualityTier:    fooddomain.NutritionQualityLegacyCurated,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&fooddomain.FoodNutritionAlias{
		ID:              "tea-egg-alias",
		FoodID:          "whole-egg",
		AliasName:       "茶叶蛋",
		NormalizedAlias: "茶叶蛋",
		MatchStatus:     fooddomain.NutritionAliasApprovedExact,
	}).Error)

	items := r.enrichManualFoodResultsWithNutritionLibrary(context.Background(), []domain.ManualFoodResult{{
		ID:                 "catalog:茶叶蛋",
		Source:             "nutrition_library",
		Title:              "茶叶蛋",
		DefaultWeightGrams: 55,
	}})

	require.Len(t, items, 1)
	assert.Equal(t, "tea-egg", items[0].ID)
	assert.Equal(t, 155.0, items[0].NutrientsPer100g.Calories)
}

func TestEnrichManualFoodKeepsExactCanonicalNameWithoutImage(t *testing.T) {
	db := setupTestDB(t)
	aliasImage := "standard-food/egg.jpg"
	r := NewManualFoodRepo(db)
	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "tea-egg-no-image",
		CanonicalName:  "茶叶蛋",
		NormalizedName: "茶叶蛋",
		KcalPer100g:    155,
		QualityTier:    fooddomain.NutritionQualityLegacyCurated,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&fooddomain.FoodNutrition{
		ID:             "whole-egg-with-image",
		CanonicalName:  "鸡蛋(全蛋)",
		NormalizedName: "鸡蛋全蛋",
		ImagePath:      &aliasImage,
		ImagePaths:     []string{aliasImage},
		KcalPer100g:    144,
		QualityTier:    fooddomain.NutritionQualityLegacyCurated,
		IsActive:       true,
	}).Error)
	require.NoError(t, db.Create(&fooddomain.FoodNutritionAlias{
		ID:              "tea-egg-alias-with-image",
		FoodID:          "whole-egg-with-image",
		AliasName:       "茶叶蛋",
		NormalizedAlias: "茶叶蛋",
		MatchStatus:     fooddomain.NutritionAliasApprovedExact,
	}).Error)

	items := r.enrichManualFoodResultsWithNutritionLibrary(context.Background(), []domain.ManualFoodResult{{
		ID:                 "catalog:茶叶蛋",
		Source:             "nutrition_library",
		Title:              "茶叶蛋",
		DefaultWeightGrams: 55,
	}})

	require.Len(t, items, 1)
	assert.Equal(t, "tea-egg-no-image", items[0].ID)
	assert.Equal(t, 155.0, items[0].NutrientsPer100g.Calories)
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
