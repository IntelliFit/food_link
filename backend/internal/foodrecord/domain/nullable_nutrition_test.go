package domain

import (
	"encoding/json"
	"food_link/backend/pkg/testdb"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestNullableNutritionDatabaseAndJSONRoundTrip(t *testing.T) {
	db := testdb.New(t)
	require.NoError(t, db.AutoMigrate(&FoodNutrition{}))
	f := FoodNutrition{ID: "11111111-1111-4111-8111-111111111111", CanonicalName: "零与未知回归样本", NormalizedName: "nullabletest", KcalPer100g: 22, SugarPer100g: 0, ImagePaths: []string{}}
	f.MarkNutritionUnknown("vitamin_d_mcg_per_100g")
	require.NoError(t, db.Create(&f).Error)
	var raw struct {
		Sugar    *float64
		VitaminD *float64
	}
	require.NoError(t, db.Raw("SELECT sugar_per_100g AS sugar,vitamin_d_mcg_per_100g AS vitamin_d FROM food_nutrition_library WHERE id=?", f.ID).Scan(&raw).Error)
	require.NotNil(t, raw.Sugar)
	require.Equal(t, 0.0, *raw.Sugar)
	require.Nil(t, raw.VitaminD)
	for _, mode := range []string{"find", "raw"} {
		var got FoodNutrition
		if mode == "find" {
			require.NoError(t, db.Where("id=?", f.ID).First(&got).Error)
		} else {
			require.NoError(t, db.Raw("SELECT * FROM food_nutrition_library WHERE id=?", f.ID).Scan(&got).Error)
		}
		require.True(t, got.NutritionUnknown("vitamin_d_mcg_per_100g"))
		require.False(t, got.NutritionUnknown("sugar_per_100g"))
		b, err := json.Marshal(got)
		require.NoError(t, err)
		var obj map[string]any
		require.NoError(t, json.Unmarshal(b, &obj))
		require.Nil(t, obj["vitamin_d_mcg_per_100g"])
		require.Equal(t, 0.0, obj["sugar_per_100g"])
		require.Nil(t, got.UnitNutritionPer100g()["vitaminDMcg"])
		require.NoError(t, db.Save(&got).Error)
	}
	require.NoError(t, db.Model(&FoodNutrition{}).Where("id=?", f.ID).Updates(map[string]any{"vitamin_d_mcg_per_100g": 0.0, "sugar_per_100g": nil}).Error)
	var got FoodNutrition
	require.NoError(t, db.Where("id=?", f.ID).First(&got).Error)
	require.True(t, got.NutritionUnknown("sugar_per_100g"))
	require.False(t, got.NutritionUnknown("vitamin_d_mcg_per_100g"))
}
