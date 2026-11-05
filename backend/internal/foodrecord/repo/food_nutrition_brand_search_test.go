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
