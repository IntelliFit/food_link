package service

import (
	"testing"
	"time"

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

	dateStr := "2024-06-15"
	svc := &FoodRecordService{}
	tm := svc.buildRecordTime(&dateStr, nil)
	assert.NotNil(t, tm)
	assert.Equal(t, 2024, tm.In(chinaTZ).Year())
	assert.Equal(t, time.June, tm.In(chinaTZ).Month())
	assert.Equal(t, 15, tm.In(chinaTZ).Day())
	assert.Equal(t, now.Hour(), tm.In(chinaTZ).Hour())
}

func ptr(t time.Time) *time.Time {
	return &t
}
