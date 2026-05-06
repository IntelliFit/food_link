package domain

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
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
