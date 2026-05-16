package domain

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFoodRecord_Struct(t *testing.T) {
	now := time.Now()
	record := FoodRecord{
		ID:            "record-1",
		UserID:        "user-1",
		MealType:      "lunch",
		TotalCalories: 500,
		TotalProtein:  20,
		TotalCarbs:    60,
		TotalFat:      15,
		RecordTime:    &now,
		CreatedAt:     &now,
	}
	assert.Equal(t, "record-1", record.ID)
	assert.Equal(t, "user_food_records", record.TableName())
}

func TestFoodItem_Struct(t *testing.T) {
	item := FoodItem{
		Name:   "Apple",
		Weight: 100,
		Ratio:  1.0,
		Intake: 100,
		Nutrients: FoodItemNutrients{
			Calories: 52,
			Protein:  0.3,
			Carbs:    14,
			Fat:      0.2,
		},
	}
	assert.Equal(t, "Apple", item.Name)
}

func TestFoodItem_UnmarshalJSONWaterMlAliases(t *testing.T) {
	var camel FoodItem
	require.NoError(t, json.Unmarshal([]byte(`{"name":"粥","waterMl":120,"nutrients":{"calories":10}}`), &camel))
	assert.Equal(t, 120.0, camel.WaterMl)

	var snake FoodItem
	require.NoError(t, json.Unmarshal([]byte(`{"name":"粥","water_ml":85,"nutrients":{"calories":10}}`), &snake))
	assert.Equal(t, 85.0, snake.WaterMl)

	var nested FoodItem
	require.NoError(t, json.Unmarshal([]byte(`{"name":"汤","nutrients":{"calories":10,"water_ml":200}}`), &nested))
	assert.Equal(t, 200.0, nested.WaterMl)
}

func TestFoodItem_UnmarshalJSONDefaultsMissingRatio(t *testing.T) {
	var fromIntake FoodItem
	require.NoError(t, json.Unmarshal([]byte(`{"name":"米饭","weight":200,"intake":50,"nutrients":{"calories":100}}`), &fromIntake))
	assert.Equal(t, 25.0, fromIntake.Ratio)
	assert.Equal(t, 50.0, fromIntake.Intake)

	var wholeItem FoodItem
	require.NoError(t, json.Unmarshal([]byte(`{"name":"苹果","weight":120,"nutrients":{"calories":60}}`), &wholeItem))
	assert.Equal(t, 100.0, wholeItem.Ratio)
	assert.Equal(t, 120.0, wholeItem.Intake)

	var explicitZero FoodItem
	require.NoError(t, json.Unmarshal([]byte(`{"name":"苹果","weight":120,"ratio":0,"nutrients":{"calories":60}}`), &explicitZero))
	assert.Equal(t, 0.0, explicitZero.Ratio)
	assert.Equal(t, 0.0, explicitZero.Intake)
}

func TestFoodItemNutrients_UnmarshalMicronutrients(t *testing.T) {
	var nutrients FoodItemNutrients
	require.NoError(t, json.Unmarshal([]byte(`{
		"calories": 100,
		"protein": 1.5,
		"carbs": 25,
		"fat": 0.5,
		"saturatedFat": 0.1,
		"cholesterol_mg": 2,
		"sodiumMg": 3,
		"potassium_mg": 120,
		"calciumMg": 10,
		"iron_mg": 0.4,
		"magnesiumMg": 6,
		"zinc_mg": 0.2,
		"vitaminARaeMcg": 15,
		"vitamin_c_mg": 4,
		"vitaminDMcg": 0.1,
		"vitamin_e_mg": 0.2,
		"vitaminKMcg": 3,
		"thiamin_mg": 0.03,
		"riboflavinMg": 0.04,
		"niacin_mg": 0.5,
		"vitaminB6Mg": 0.06,
		"folate_mcg": 8,
		"vitaminB12Mcg": 0.01
	}`), &nutrients))

	assert.Equal(t, 100.0, nutrients.Calories)
	assert.Equal(t, 0.1, nutrients.SaturatedFat)
	assert.Equal(t, 2.0, nutrients.CholesterolMg)
	assert.Equal(t, 3.0, nutrients.SodiumMg)
	assert.Equal(t, 120.0, nutrients.PotassiumMg)
	assert.Equal(t, 10.0, nutrients.CalciumMg)
	assert.Equal(t, 0.4, nutrients.IronMg)
	assert.Equal(t, 6.0, nutrients.MagnesiumMg)
	assert.Equal(t, 0.2, nutrients.ZincMg)
	assert.Equal(t, 15.0, nutrients.VitaminARaeMcg)
	assert.Equal(t, 4.0, nutrients.VitaminCMg)
	assert.Equal(t, 0.1, nutrients.VitaminDMcg)
	assert.Equal(t, 0.2, nutrients.VitaminEMg)
	assert.Equal(t, 3.0, nutrients.VitaminKMcg)
	assert.Equal(t, 0.03, nutrients.ThiaminMg)
	assert.Equal(t, 0.04, nutrients.RiboflavinMg)
	assert.Equal(t, 0.5, nutrients.NiacinMg)
	assert.Equal(t, 0.06, nutrients.VitaminB6Mg)
	assert.Equal(t, 8.0, nutrients.FolateMcg)
	assert.Equal(t, 0.01, nutrients.VitaminB12Mcg)
}

func TestFoodNutrition_Struct(t *testing.T) {
	food := FoodNutrition{
		ID:            "food-1",
		CanonicalName: "Apple",
		KcalPer100g:   52,
		IsActive:      true,
	}
	assert.Equal(t, "food-1", food.ID)
	assert.Equal(t, "food_nutrition_library", food.TableName())
}

func TestFoodNutritionAlias_Struct(t *testing.T) {
	alias := FoodNutritionAlias{
		ID:        "alias-1",
		FoodID:    "food-1",
		AliasName: "Red Apple",
	}
	assert.Equal(t, "alias-1", alias.ID)
	assert.Equal(t, "food_nutrition_aliases", alias.TableName())
}

func TestFoodUnresolvedLog_Struct(t *testing.T) {
	log := FoodUnresolvedLog{
		ID:             "log-1",
		RawName:        "Unknown Food",
		NormalizedName: "unknownfood",
		HitCount:       1,
	}
	assert.Equal(t, "log-1", log.ID)
	assert.Equal(t, "food_unresolved_logs", log.TableName())
}

func TestCriticalSample_Struct(t *testing.T) {
	sample := CriticalSample{
		ID:               "sample-1",
		UserID:           "user-1",
		FoodName:         "Apple",
		AIWeight:         100,
		UserWeight:       120,
		DeviationPercent: 20,
	}
	assert.Equal(t, "sample-1", sample.ID)
	assert.Equal(t, "critical_samples_weapp", sample.TableName())
}
