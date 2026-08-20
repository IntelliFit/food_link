package migration

import (
	"context"
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestEnsureFoodNutritionContributionBackfillIsIdempotent(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.UserCustomFoodDO{}, &migrationdo.FoodNutritionContributionDO{}))
	legacy := migrationdo.UserCustomFoodDO{
		ID: uuid.NewString(), UserID: uuid.NewString(), Title: "自制鸡肉丸", NormalizedTitle: "自制鸡肉丸",
		DefaultWeightGrams: 50, TotalCalories: 100, TotalProtein: 10, TotalCarbs: 5, TotalFat: 4,
		NutrientsPer100g: map[string]any{}, ExtraNutrients: map[string]any{}, ImagePaths: []string{},
		PublicStatus: "pending", Status: "active",
	}
	require.NoError(t, db.Create(&legacy).Error)
	require.NoError(t, ensureFoodNutritionContributionBackfill(context.Background(), db))
	require.NoError(t, ensureFoodNutritionContributionBackfill(context.Background(), db))

	var items []migrationdo.FoodNutritionContributionDO
	require.NoError(t, db.Find(&items).Error)
	require.Len(t, items, 1)
	require.Equal(t, legacy.ID, *items[0].LegacyCustomFoodID)
	require.Equal(t, 200.0, items[0].KcalPer100g)
}

func TestEnsureFoodNutritionContributionBackfillToleratesMalformedLegacyNutrition(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.UserCustomFoodDO{}, &migrationdo.FoodNutritionContributionDO{}))
	legacy := migrationdo.UserCustomFoodDO{
		ID: uuid.NewString(), UserID: uuid.NewString(), Title: "旧数据", NormalizedTitle: "旧数据",
		DefaultWeightGrams: 50, TotalCalories: 100, TotalProtein: 10, TotalCarbs: 5, TotalFat: 4,
		NutrientsPer100g: map[string]any{"calories": "N/A", "protein": "未知", "carbs": "", "fat": nil},
		ExtraNutrients:   map[string]any{}, ImagePaths: []string{}, PublicStatus: "pending", Status: "active",
	}
	require.NoError(t, db.Create(&legacy).Error)
	require.NoError(t, ensureFoodNutritionContributionBackfill(context.Background(), db))

	var item migrationdo.FoodNutritionContributionDO
	require.NoError(t, db.Where("legacy_custom_food_id = ?", legacy.ID).First(&item).Error)
	require.Equal(t, 200.0, item.KcalPer100g)
	require.Equal(t, 20.0, item.ProteinPer100g)
}
