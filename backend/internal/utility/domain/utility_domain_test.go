package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestManualFood_Struct(t *testing.T) {
	food := ManualFood{
		ID:       "food-1",
		Name:     "Apple",
		Category: "fruit",
		Calories: 52,
		Protein:  0.3,
		Carbs:    14,
		Fat:      0.2,
	}
	assert.Equal(t, "food-1", food.ID)
	assert.Equal(t, "Apple", food.Name)
	assert.Equal(t, "manual_food_library", food.TableName())
}
