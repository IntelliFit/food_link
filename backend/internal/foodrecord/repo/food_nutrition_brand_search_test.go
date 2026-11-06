package repo

import (
	"context"
	"testing"

	"food_link/backend/internal/foodrecord/domain"
	"github.com/stretchr/testify/require"
)

func TestFoodNutritionRepo_SearchPackagedFoodByBrandKeepsOnlyActiveRowsOfTheBrand(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()
	rows := []domain.PackagedFood{
		{ID: "wds-milk", Brand: "完达山", ProductName: "完达山 纯牛奶", DisplayName: "完达山 纯牛奶", KcalPer100g: 65, ReviewStatus: "active", IsActive: true},
		{ID: "wds-yogurt", Brand: "", ProductName: "完达山 酸牛奶", DisplayName: "完达山 酸牛奶", KcalPer100g: 91, ReviewStatus: "active", IsActive: true},
		{ID: "wds-held", Brand: "完达山", ProductName: "完达山 奶粉", DisplayName: "完达山 奶粉", KcalPer100g: 480, ReviewStatus: "held_dry_form", IsActive: true},
		{ID: "wds-off", Brand: "完达山", ProductName: "完达山 豆奶", DisplayName: "完达山 豆奶", KcalPer100g: 50, ReviewStatus: "active", IsActive: false},
		{ID: "other", Brand: "伊利", ProductName: "伊利 纯牛奶", DisplayName: "伊利 纯牛奶", KcalPer100g: 65, ReviewStatus: "active", IsActive: true},
	}
	for i := range rows {
		require.NoError(t, db.Create(&rows[i]).Error)
	}
	// gorm skips false on create; mark the inactive row explicitly.
	require.NoError(t, db.Model(&domain.PackagedFood{}).Where("id = ?", "wds-off").Update("is_active", false).Error)

	found, err := repo.SearchPackagedFoodByBrand(ctx, "完达山", 50)
	require.NoError(t, err)
	ids := []string{}
	for _, food := range found {
		ids = append(ids, food.ID)
	}
	require.Equal(t, []string{"wds-milk", "wds-yogurt"}, ids, "exact brand first, then a row naming the brand; held and inactive rows never")

	empty, err := repo.SearchPackagedFoodByBrand(ctx, "完", 50)
	require.NoError(t, err)
	require.Empty(t, empty, "a one-character brand would match half the catalogue")
}

func TestFoodNutritionRepo_CapturePackagedFoodIfAbsentNeverTouchesAKnownProduct(t *testing.T) {
	db := setupFoodNutritionFullTestDB(t)
	repo := NewFoodNutritionRepo(db)
	ctx := context.Background()
	input := PackagedFoodInput{Brand: "某品牌", ProductName: "柠檬茶", Source: "photo_label_auto", ReviewStatus: "active",
		NetContentValue: 500, NetContentUnit: "ml", UnitCount: 1, NetWeightG: 500, KcalPer100g: 43, CarbsPer100g: 10.6}

	created, err := repo.CapturePackagedFoodIfAbsent(ctx, input)
	require.NoError(t, err)
	require.True(t, created)

	// The same product in another size, with other values, is left alone.
	other := input
	other.NetContentValue, other.NetWeightG, other.KcalPer100g = 250, 250, 99
	created, err = repo.CapturePackagedFoodIfAbsent(ctx, other)
	require.NoError(t, err)
	require.False(t, created)

	var rows []domain.PackagedFood
	require.NoError(t, db.Where("brand = ?", "某品牌").Find(&rows).Error)
	require.Len(t, rows, 1)
	require.InDelta(t, 43, rows[0].KcalPer100g, 0.01)

	created, err = repo.CapturePackagedFoodIfAbsent(ctx, PackagedFoodInput{ProductName: "柠檬茶", KcalPer100g: 43})
	require.NoError(t, err)
	require.False(t, created, "no brand, no row")
}
