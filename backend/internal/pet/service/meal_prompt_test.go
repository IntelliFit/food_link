package service

import (
	"context"
	"testing"
	"time"

	"food_link/backend/internal/pet/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildMealPromptUsesDefaultLunchWindow(t *testing.T) {
	fake := newFakePetRepo()
	svc := NewService(fake)
	svc.now = func() time.Time {
		return time.Date(2026, 8, 22, 11, 40, 0, 0, chinaTZ())
	}

	prompt, err := svc.buildMealPrompt(context.Background(), "u1", "2026-08-22")
	require.NoError(t, err)
	require.NotNil(t, prompt)
	assert.Equal(t, "lunch", prompt.MealType)
	assert.Equal(t, "12:00", prompt.ScheduledTime)
	assert.Equal(t, "default", prompt.ScheduleSource)
	assert.Equal(t, "今天午餐吃什么？", prompt.StarterQuestion)
}

func TestBuildMealPromptLearnsMedianFromFiveDistinctDays(t *testing.T) {
	fake := newFakePetRepo()
	mealMinutes := []int{12*60 + 36, 12*60 + 42, 12*60 + 40, 12*60 + 55, 12*60 + 38}
	for index, minute := range mealMinutes {
		day := time.Date(2026, 8, 17-index, minute/60, minute%60, 0, 0, chinaTZ())
		date := day.Format("2006-01-02")
		fake.foodByDate[date] = []repo.FoodRecord{{MealType: "lunch", RecordTime: &day}}
	}
	svc := NewService(fake)
	svc.now = func() time.Time {
		return time.Date(2026, 8, 22, 12, 15, 0, 0, chinaTZ())
	}

	prompt, err := svc.buildMealPrompt(context.Background(), "u1", "2026-08-22")
	require.NoError(t, err)
	require.NotNil(t, prompt)
	assert.Equal(t, "12:40", prompt.ScheduledTime)
	assert.Equal(t, "learned", prompt.ScheduleSource)
}

func TestBuildMealPromptSuppressesRecordedMeal(t *testing.T) {
	fake := newFakePetRepo()
	recordedAt := time.Date(2026, 8, 22, 11, 20, 0, 0, chinaTZ())
	fake.foodByDate["2026-08-22"] = []repo.FoodRecord{{MealType: "lunch", RecordTime: &recordedAt}}
	svc := NewService(fake)
	svc.now = func() time.Time {
		return time.Date(2026, 8, 22, 11, 45, 0, 0, chinaTZ())
	}

	prompt, err := svc.buildMealPrompt(context.Background(), "u1", "2026-08-22")
	require.NoError(t, err)
	assert.Nil(t, prompt)
}
