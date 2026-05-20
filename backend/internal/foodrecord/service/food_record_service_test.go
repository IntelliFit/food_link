package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/foodrecord/domain"
	"github.com/stretchr/testify/assert"
)

func TestNormalizeMealType(t *testing.T) {
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.Now().In(chinaTZ)

	tests := []struct {
		name       string
		mealType   string
		recordTime *time.Time
		want       string
	}{
		{"breakfast passes through", "breakfast", nil, "breakfast"},
		{"lunch passes through", "lunch", nil, "lunch"},
		{"dinner passes through", "dinner", nil, "dinner"},
		{"morning_snack passes through", "morning_snack", nil, "morning_snack"},
		{"afternoon_snack passes through", "afternoon_snack", nil, "afternoon_snack"},
		{"evening_snack passes through", "evening_snack", nil, "evening_snack"},
		{"snack morning", "snack", ptr(time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, chinaTZ)), "morning_snack"},
		{"snack afternoon", "snack", ptr(time.Date(now.Year(), now.Month(), now.Day(), 13, 0, 0, 0, chinaTZ)), "afternoon_snack"},
		{"snack evening", "snack", ptr(time.Date(now.Year(), now.Month(), now.Day(), 20, 0, 0, 0, chinaTZ)), "evening_snack"},
		{"unknown defaults", "unknown", nil, "afternoon_snack"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := normalizeMealType(tt.mealType, tt.recordTime)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestValidMealType(t *testing.T) {
	assert.True(t, validMealType("breakfast"))
	assert.True(t, validMealType("lunch"))
	assert.True(t, validMealType("dinner"))
	assert.True(t, validMealType("snack"))
	assert.True(t, validMealType("morning_snack"))
	assert.False(t, validMealType("invalid"))
}

func TestBuildRecordTime(t *testing.T) {
	chinaTZ := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.Now().In(chinaTZ)

	dateStr := time.Now().In(chinaTZ).Format("2006-01-02")
	svc := &FoodRecordService{}
	tm, err := svc.buildRecordTime(context.Background(), &dateStr, nil)
	assert.NoError(t, err)
	assert.NotNil(t, tm)
	assert.Equal(t, now.Year(), tm.In(chinaTZ).Year())
	assert.Equal(t, now.Month(), tm.In(chinaTZ).Month())
	assert.Equal(t, now.Day(), tm.In(chinaTZ).Day())
	assert.Equal(t, now.Hour(), tm.In(chinaTZ).Hour())
}

func TestFillMissingNutrientsAcceptsStringNumbers(t *testing.T) {
	target := &domain.FoodItemNutrients{}
	fillMissingNutrients(target, map[string]any{
		"calories": "18",
		"protein":  "0.9",
		"carbs":    "2.7",
		"fat":      "0.5",
	})

	assert.Equal(t, 18.0, target.Calories)
	assert.Equal(t, 0.9, target.Protein)
	assert.Equal(t, 2.7, target.Carbs)
	assert.Equal(t, 0.5, target.Fat)
}

func TestHydrateManualRecordNutrientsForExistingZeroItems(t *testing.T) {
	source := "nutrition_library"
	sourceIDRice := "catalog:白米饭"
	sourceTitleRice := "白米饭"
	sourceIDEgg := "catalog:水煮蛋"
	sourceTitleEgg := "水煮蛋"
	record := &domain.FoodRecord{
		TotalCalories: 347.7,
		TotalProtein:  15.6,
		TotalCarbs:    59.5,
		TotalFat:      6.1,
		Items: []domain.FoodItem{
			{
				Name:              "白米饭",
				Weight:            177,
				Ratio:             100,
				Intake:            177,
				ManualSource:      &source,
				ManualSourceID:    &sourceIDRice,
				ManualSourceTitle: &sourceTitleRice,
			},
			{
				Name:              "水煮蛋",
				Weight:            85,
				Ratio:             100,
				Intake:            85,
				ManualSource:      &source,
				ManualSourceID:    &sourceIDEgg,
				ManualSourceTitle: &sourceTitleEgg,
			},
		},
	}

	hydrateManualRecordNutrients(record)

	assert.InDelta(t, 267.3, record.Items[0].Nutrients.Calories, 0.1)
	assert.InDelta(t, 80.8, record.Items[1].Nutrients.Calories, 0.1)
	assert.Greater(t, record.Items[0].Nutrients.Carbs, 0.0)
	assert.Greater(t, record.Items[1].Nutrients.Protein, 0.0)
	assert.Greater(t, record.Items[1].Nutrients.Fat, 0.0)
}

func ptr(t time.Time) *time.Time {
	return &t
}
