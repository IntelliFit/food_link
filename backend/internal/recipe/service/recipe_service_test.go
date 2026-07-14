package service

import (
	"context"
	"testing"
	"time"

	healthdomain "food_link/backend/internal/health/domain"
	"food_link/backend/internal/recipe/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockWaterLogRecorder struct {
	logs []healthdomain.BodyWaterLog
	err  error
}

type mockFavoriteRecipeVisibilityChecker struct {
	visible bool
	err     error
}

func (m mockFavoriteRecipeVisibilityChecker) FavoriteRecipesVisible(_ context.Context, _ string) (bool, error) {
	return m.visible, m.err
}

func TestRecipeService_ListForViewer_HidesPrivateFavorites(t *testing.T) {
	svc := NewRecipeService(nil)
	svc.ConfigureFavoriteRecipeVisibilityChecker(mockFavoriteRecipeVisibilityChecker{visible: false})
	favorite := true

	_, err := svc.ListForViewer(context.Background(), "viewer", "owner", "", &favorite)

	require.Error(t, err)
}

func (m *mockWaterLogRecorder) CreateWaterLog(ctx context.Context, log *healthdomain.BodyWaterLog) error {
	if m.err != nil {
		return m.err
	}
	m.logs = append(m.logs, *log)
	return nil
}

func TestNormalizeRecipeItemsForFoodRecordFillsSingleItemTotals(t *testing.T) {
	recipe := &domain.Recipe{
		TotalCalories: 241.8,
		TotalProtein:  0.2,
		TotalCarbs:    18.4,
		TotalFat:      12.6,
	}
	items := []map[string]any{{
		"name":   "蜜雪冰城新鲜冰淇淋",
		"weight": 130,
		"ratio":  100,
		"intake": 130,
	}}

	got := normalizeRecipeItemsForFoodRecord(items, recipe)

	require.Len(t, got, 1)
	nutrients, ok := got[0]["nutrients"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, 241.8, nutrients["calories"])
	assert.Equal(t, 0.2, nutrients["protein"])
	assert.Equal(t, 18.4, nutrients["carbs"])
	assert.Equal(t, 12.6, nutrients["fat"])
	assert.Equal(t, 130.0, got[0]["weight"])
	assert.Equal(t, 100.0, got[0]["ratio"])
	assert.Equal(t, 130.0, got[0]["intake"])
}

func TestRecipeServiceUseAddsFoodWaterToBodyWater(t *testing.T) {
	waterRecorder := &mockWaterLogRecorder{}
	svc := NewRecipeService(nil)
	svc.ConfigureWaterLogRecorder(waterRecorder)
	ctx := context.Background()

	recipe := &domain.Recipe{
		RecipeName:       "蜜雪冰城新鲜冰淇淋",
		Items:            []map[string]any{{"name": "蜜雪冰城新鲜冰淇淋", "weight": 130.0, "ratio": 100.0, "waterMl": 72.0}},
		TotalCalories:    241.8,
		TotalProtein:     4.6,
		TotalCarbs:       32.5,
		TotalFat:         10.4,
		TotalWeightGrams: 130,
	}
	recordTime := time.Now().In(chinaTZ)
	record := &domain.FoodRecord{
		ID:         "record-1",
		UserID:     "u1",
		MealType:   "afternoon_snack",
		Items:      normalizeRecipeItemsForFoodRecord(recipe.Items, recipe),
		RecordTime: &recordTime,
	}

	err := svc.recordFoodWaterIntake(ctx, "u1", record)
	require.NoError(t, err)
	require.Len(t, waterRecorder.logs, 1)
	assert.Equal(t, "u1", waterRecorder.logs[0].UserID)
	assert.Equal(t, 72, waterRecorder.logs[0].AmountMl)
	assert.Equal(t, "ai_food_record:record-1", waterRecorder.logs[0].SourceType)
	require.NotNil(t, waterRecorder.logs[0].RecordedOn)
	assert.Equal(t, time.Now().In(chinaTZ).Format("2006-01-02"), waterRecorder.logs[0].RecordedOn.In(chinaTZ).Format("2006-01-02"))
}

func TestTotalRecipeFoodWaterIntakeMl(t *testing.T) {
	assert.Equal(t, 0, totalRecipeFoodWaterIntakeMl(nil))
	assert.Equal(t, 72, totalRecipeFoodWaterIntakeMl([]map[string]any{{"waterMl": 72.0, "ratio": 100.0}}))
	assert.Equal(t, 36, totalRecipeFoodWaterIntakeMl([]map[string]any{{"water_ml": 72.0, "ratio": 50.0}}))
	assert.Equal(t, 72, totalRecipeFoodWaterIntakeMl([]map[string]any{{"water_ml": 72.0, "suggested_ratio": 50.0}}))
	assert.Equal(t, 80, totalRecipeFoodWaterIntakeMl([]map[string]any{{"water_ml": 200.0, "weight": 500.0, "intake": 200.0}}))
	assert.Equal(t, 64, totalRecipeFoodWaterIntakeMl([]map[string]any{{"nutrients": map[string]any{"waterMl": 63.6}}}))
}

func TestNormalizeRecipeItemsForFoodRecordKeepsItemNutrients(t *testing.T) {
	recipe := &domain.Recipe{
		TotalCalories: 500,
		TotalProtein:  20,
		TotalCarbs:    60,
		TotalFat:      10,
	}
	items := []map[string]any{{
		"name":      "冰淇淋",
		"weight":    130.0,
		"waterMl":   65.0,
		"nutrients": map[string]any{"calorie": 241.8, "protein": 0.2, "carbohydrates": 18.4, "fat": 12.6},
	}}

	got := normalizeRecipeItemsForFoodRecord(items, recipe)

	require.Len(t, got, 1)
	nutrients := got[0]["nutrients"].(map[string]any)
	assert.Equal(t, 241.8, nutrients["calories"])
	assert.Equal(t, 0.2, nutrients["protein"])
	assert.Equal(t, 18.4, nutrients["carbs"])
	assert.Equal(t, 12.6, nutrients["fat"])
	assert.Equal(t, 65.0, got[0]["water_ml"])
}

func TestNormalizeRecipeItemsForFoodRecordDoesNotApplySuggestedRatio(t *testing.T) {
	items := []map[string]any{{
		"name":                   "士力架花生夹心巧克力",
		"weight":                 70.0,
		"suggested_ratio":        50.0,
		"suggested_ratio_source": "ai",
		"nutrition_source":       "packaged_food_library",
		"packaged_food_id":       "packaged:snickers-70g",
		"package_weight_source":  "packaged_food_library",
		"package_weight_applied": true,
		"packaged_candidates": []map[string]any{{
			"id":           "packaged:snickers-70g",
			"net_weight_g": 70.0,
		}},
		"nutrients": map[string]any{"calories": 340.97, "protein": 5.6, "carbs": 42.0, "fat": 16.0},
	}}

	got := normalizeRecipeItemsForFoodRecord(items, nil)

	require.Len(t, got, 1)
	assert.Equal(t, 100.0, got[0]["ratio"])
	assert.Equal(t, 70.0, got[0]["intake"])
	assert.Equal(t, 50.0, got[0]["suggested_ratio"])
	assert.Equal(t, "ai", got[0]["suggested_ratio_source"])
	assert.Equal(t, "packaged:snickers-70g", got[0]["packaged_food_id"])
	assert.Equal(t, "packaged_food_library", got[0]["package_weight_source"])
	assert.Equal(t, true, got[0]["package_weight_applied"])
	candidates, ok := got[0]["packaged_candidates"].([]map[string]any)
	require.True(t, ok)
	require.Len(t, candidates, 1)
	assert.Equal(t, "packaged:snickers-70g", candidates[0]["id"])
	assert.Equal(t, 70.0, candidates[0]["net_weight_g"])
}
