package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/foodrecord/domain"

	"github.com/stretchr/testify/require"
)

func TestFoodNutritionRepo_ResolveFoodsMatchesResolveFood(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()
	food := func(id, name string, kcal, carbs float64, active bool) domain.FoodNutrition {
		return domain.FoodNutrition{ID: id, CanonicalName: name, NormalizedName: normalizeFoodName(name), KcalPer100g: kcal, CarbsPer100g: carbs, ProteinPer100g: 3, FatPer100g: 1, IsActive: active}
	}
	for _, row := range []domain.FoodNutrition{
		food("rice", "白米饭", 116, 25.9, true),
		food("egg", "鸡蛋(全蛋)", 144, 2.8, true),
		food("corn", "玉米(熟)", 96, 21, true),
		food("corn-sausage", "玉米肠", 208, 19.7, true),
		food("old-milk", "牛奶", 54, 4.8, false),
		food("sauce-beef", "酱牛肉", 246, 3.2, true),
	} {
		require.NoError(t, db.Create(&row).Error)
	}
	for _, alias := range []domain.FoodNutritionAlias{
		{ID: "a1", FoodID: "rice", AliasName: "米饭", NormalizedAlias: normalizeFoodName("米饭"), MatchStatus: domain.NutritionAliasApprovedExact},
		{ID: "a2", FoodID: "corn", AliasName: "水煮玉米", NormalizedAlias: normalizeFoodName("水煮玉米"), MatchStatus: domain.NutritionAliasApprovedExact},
		{ID: "a3", FoodID: "corn-sausage", AliasName: "煮玉米", NormalizedAlias: normalizeFoodName("煮玉米"), MatchStatus: domain.NutritionAliasApprovedExact},
		{ID: "a4", FoodID: "egg", AliasName: "蛋", NormalizedAlias: normalizeFoodName("蛋")},
	} {
		require.NoError(t, db.Create(&alias).Error)
	}
	names := []string{"白米饭", "一碗米饭", "米饭", "水煮玉米", "煮玉米", "牛奶", "蛋", "鸡蛋(全蛋)", "酱牛肉", "不存在的食物", "", "白米饭"}
	batch, err := repo.ResolveFoods(ctx, names)
	require.NoError(t, err)
	for _, name := range names {
		if name == "" {
			continue
		}
		single, err := repo.ResolveFood(ctx, name)
		require.NoError(t, err)
		got := batch[name]
		require.NotNil(t, got, name)
		require.Equal(t, single.Status, got.Status, name)
		require.Equal(t, single.MatchSource, got.MatchSource, name)
		if single.Food == nil {
			require.Nil(t, got.Food, name)
			continue
		}
		require.NotNil(t, got.Food, name)
		require.Equal(t, single.Food.ID, got.Food.ID, name)
	}
	require.Equal(t, "corn", batch["水煮玉米"].Food.ID)
	require.Nil(t, batch["煮玉米"].Food, "the unsafe processed alias stays rejected")
}

func TestFoodNutritionRepo_ListPackagedBrands(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	for _, row := range []domain.PackagedFood{
		{ID: "p1", Brand: "乐事（Lay's）", ProductName: "薯片", IsActive: true, ReviewStatus: "active"},
		{ID: "p2", Brand: "乐事（Lay's）", ProductName: "黄瓜味薯片", IsActive: true},
		{ID: "p3", Brand: "德芙", ProductName: "巧克力", IsActive: true, ReviewStatus: "pending"},
		{ID: "p4", Brand: "", ProductName: "无品牌", IsActive: true},
		{ID: "p5", Brand: "停用", ProductName: "x", IsActive: false},
	} {
		require.NoError(t, db.Create(&row).Error)
	}
	brands, err := repo.ListPackagedBrands(context.Background())
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"乐事（Lay's）"}, brands)
}
