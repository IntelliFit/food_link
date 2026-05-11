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
