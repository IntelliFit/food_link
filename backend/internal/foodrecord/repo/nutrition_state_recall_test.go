package repo

import (
	"context"
	"fmt"
	"testing"

	"food_link/backend/internal/foodrecord/domain"
	"github.com/stretchr/testify/require"
)

func TestNutritionStateRecallFiltersBeforeLimitAndUsesStatefulAliases(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	for i := 0; i < 25; i++ {
		require.NoError(t, db.Create(&domain.FoodNutrition{ID: fmt.Sprintf("10000000-0000-4000-8000-%012d", i), CanonicalName: fmt.Sprintf("测试白米旧条目%d", i), NormalizedName: fmt.Sprintf("测试白米旧条目%d", i), IsActive: true, QualityTier: domain.NutritionQualityAuthoritative}).Error)
		require.NoError(t, db.Create(&domain.FoodNutrition{ID: fmt.Sprintf("11000000-0000-4000-8000-%012d", i), CanonicalName: fmt.Sprintf("测试白米错口径%d", i), NormalizedName: fmt.Sprintf("测试白米错口径%d", i), FoodState: "cooked", WeightBasis: "dry", IsActive: true, QualityTier: domain.NutritionQualityAuthoritative}).Error)
	}
	good := domain.FoodNutrition{ID: "20000000-0000-4000-8000-000000000001", CanonicalName: "Rice, white, cooked", NormalizedName: "ricewhitecooked", FoodState: "cooked", WeightBasis: "cooked_edible", PreparationMethod: "boiled", KcalPer100g: 130, CarbsPer100g: 28, IsActive: true, QualityTier: domain.NutritionQualityAuthoritative}
	raw := domain.FoodNutrition{ID: "20000000-0000-4000-8000-000000000002", CanonicalName: "Rice, white, raw", NormalizedName: "ricewhiteraw", FoodState: "raw", WeightBasis: "dry_raw", KcalPer100g: 365, CarbsPer100g: 80, IsActive: true, QualityTier: domain.NutritionQualityAuthoritative}
	require.NoError(t, db.Create(&[]domain.FoodNutrition{good, raw}).Error)
	for i, food := range []domain.FoodNutrition{good, raw} {
		require.NoError(t, db.Create(&domain.FoodNutritionAlias{ID: fmt.Sprintf("30000000-0000-4000-8000-%012d", i), FoodID: food.ID, AliasName: fmt.Sprintf("测试白米%d", i), NormalizedAlias: fmt.Sprintf("测试白米%d", i), MatchStatus: domain.NutritionAliasCandidateOnly}).Error)
	}
	r := NewFoodNutritionRepo(db)
	rows, err := r.SearchCandidatesForState(context.Background(), "测试白米", domain.NutritionStateQuery{FoodState: "cooked", WeightBasis: "as_served"}, 1)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, good.ID, rows[0].Food.ID)
	rows, err = r.SearchCandidatesForState(context.Background(), "测试白米", domain.NutritionStateQuery{FoodState: "dry", WeightBasis: "dry"}, 1)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, raw.ID, rows[0].Food.ID)
}

func TestNutritionStateRecallFiltersSkinAndBoneBeforeLimit(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	for i, skin := range []string{"with_skin", "skinless"} {
		require.NoError(t, db.Create(&domain.FoodNutrition{ID: fmt.Sprintf("50000000-0000-4000-8000-%012d", i), CanonicalName: fmt.Sprintf("状态鸡胸肉%d", i), NormalizedName: fmt.Sprintf("状态鸡胸肉%d", i), FoodState: "cooked", WeightBasis: "cooked_edible", PreparationMethod: "boiled", StateTags: []string{skin, "boneless"}, KcalPer100g: 160, ProteinPer100g: 25, IsActive: true, QualityTier: domain.NutritionQualityAuthoritative}).Error)
	}
	rows, err := NewFoodNutritionRepo(db).SearchCandidatesForState(context.Background(), "状态鸡胸肉", domain.NutritionStateQuery{FoodState: "cooked", WeightBasis: "as_served", SkinState: "skinless", BoneState: "boneless", Preparation: "boiled"}, 1)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "50000000-0000-4000-8000-000000000001", rows[0].Food.ID)
}
