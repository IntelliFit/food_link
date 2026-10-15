package migration

import (
	"context"
	"testing"

	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
)

func TestNutritionStateBackfillIsIdempotentAndPreservesNutrition(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&migrationdo.FoodNutritionDO{}))
	source := "美国农业部食物数据中心（SR Legacy）"
	food := migrationdo.FoodNutritionDO{ID: "40000000-0000-4000-8000-000000000001", CanonicalName: "Rice, white, cooked", NormalizedName: "ricewhitecooked", Source: &source, IsActive: true, KcalPer100g: 130, ProteinPer100g: 2.69, CarbsPer100g: 28.17, FatPer100g: .28}
	require.NoError(t, db.Create(&food).Error)
	ctx := context.Background()
	plan, err := PlanNutritionStateBackfill(ctx, db)
	require.NoError(t, err)
	require.Len(t, plan.Rows, 1)
	n, err := ApplyNutritionStateBackfill(ctx, db, plan)
	require.NoError(t, err)
	require.Equal(t, 1, n)
	n, err = ApplyNutritionStateBackfill(ctx, db, plan)
	require.NoError(t, err)
	require.Zero(t, n)
	var result migrationdo.FoodNutritionDO
	require.NoError(t, db.First(&result, "id=?", food.ID).Error)
	require.Equal(t, "cooked", result.FoodState)
	require.Equal(t, "cooked_edible", result.WeightBasis)
	require.Equal(t, food.KcalPer100g, result.KcalPer100g)
	require.Equal(t, food.ProteinPer100g, result.ProteinPer100g)
	require.Equal(t, food.CarbsPer100g, result.CarbsPer100g)
	require.Equal(t, food.FatPer100g, result.FatPer100g)
	require.NotEmpty(t, result.QualityEvidence["nutrition_state_backfill"])
	plan, err = PlanNutritionStateBackfill(ctx, db)
	require.NoError(t, err)
	require.Empty(t, plan.Rows)
}
