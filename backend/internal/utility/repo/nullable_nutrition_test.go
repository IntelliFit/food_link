package repo

import (
	"context"
	"encoding/json"
	fooddomain "food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"testing"
)

func TestOrdinaryFoodSearchPreservesUnknownAndVerifiedZero(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&fooddomain.FoodNutrition{}, &fooddomain.FoodNutritionAlias{}))
	f := fooddomain.FoodNutrition{ID: "11111111-1111-4111-8111-111111111119", CanonicalName: "零与未知来源测试菜", NormalizedName: "零与未知来源测试菜", KcalPer100g: 22, ProteinPer100g: 2, CarbsPer100g: 3, FatPer100g: .4, SugarPer100g: 0, Source: "tfda_food_nutrition", QualityTier: "authoritative", IsActive: true, ImagePaths: []string{}}
	f.MarkNutritionUnknown("vitamin_d_mcg_per_100g")
	f.MarkNutritionUnknown("fiber_per_100g")
	require.NoError(t, db.Create(&f).Error)
	// The manual search SQL scans an embedded FoodNutrition, not the bare model.
	var embedded struct {
		fooddomain.FoodNutrition
		MatchSource string
	}
	require.NoError(t, db.Raw("SELECT *, 'canonical' AS match_source FROM food_nutrition_library WHERE id=?", f.ID).Scan(&embedded).Error)
	require.True(t, embedded.NutritionUnknown("fiber_per_100g"))
	result := manualFoodResultFromNutrition(embedded.FoodNutrition, 1)
	body, e := json.Marshal(result)
	require.NoError(t, e)
	var got map[string]any
	require.NoError(t, json.Unmarshal(body, &got))
	nutrients := got["nutrients_per_100g"].(map[string]any)
	require.Nil(t, nutrients["fiber"])
	require.Nil(t, nutrients["vitaminDMcg"])
	require.Equal(t, float64(0), nutrients["sugar"])
	require.NoError(t, db.WithContext(context.Background()).Transaction(func(tx *gorm.DB) error { return tx.Where("id=?", f.ID).Delete(&fooddomain.FoodNutrition{}).Error }))
}
