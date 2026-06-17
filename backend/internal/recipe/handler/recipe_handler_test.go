package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/recipe/domain"
	"food_link/backend/internal/recipe/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockRecipeService struct {
	createInput  *service.CreateInput
	updateInput  *service.UpdateInput
	updateRecipe *domain.Recipe
}

func (m *mockRecipeService) Create(ctx context.Context, userID string, input service.CreateInput) (string, error) {
	m.createInput = &input
	return "recipe-1", nil
}

func (m *mockRecipeService) List(ctx context.Context, userID, mealType string, isFavorite *bool) ([]domain.Recipe, error) {
	return nil, nil
}

func (m *mockRecipeService) Count(ctx context.Context, userID string, isFavorite *bool) (int64, error) {
	return 0, nil
}

func (m *mockRecipeService) Get(ctx context.Context, userID, recipeID string) (*domain.Recipe, error) {
	return nil, nil
}

func (m *mockRecipeService) Update(ctx context.Context, userID, recipeID string, input service.UpdateInput) (*domain.Recipe, error) {
	m.updateInput = &input
	if m.updateRecipe != nil {
		return m.updateRecipe, nil
	}
	return &domain.Recipe{ID: recipeID, RecipeName: "更新后的收藏"}, nil
}

func (m *mockRecipeService) Delete(ctx context.Context, userID, recipeID string) error {
	return nil
}

func (m *mockRecipeService) Use(ctx context.Context, userID, recipeID string, mealType *string, entryType *string) (string, error) {
	return "record-1", nil
}

func setupRecipeRouter(h *RecipeHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(authmw.ContextUserIDKey, "test-user-id")
		c.Next()
	})
	r.POST("/api/recipes", h.Create)
	r.PUT("/api/recipes/:recipe_id", h.Update)
	return r
}

func packagedRecipeRequestBody() map[string]any {
	return map[string]any{
		"recipe_name":        "零食混合餐收藏",
		"total_calories":     340.97,
		"total_protein":      5.6,
		"total_carbs":        42.0,
		"total_fat":          16.0,
		"total_weight_grams": 70,
		"items": []map[string]any{{
			"name":                   "士力架花生夹心巧克力",
			"weight":                 70,
			"ratio":                  100,
			"intake":                 70,
			"suggested_ratio":        50,
			"suggested_ratio_source": "ai",
			"nutrition_source":       "packaged_food_library",
			"matched_food_id":        "nutrition:snickers",
			"packaged_food_id":       "packaged:snickers-70g",
			"package_match_status":   "matched",
			"package_weight_source":  "packaged_food_library",
			"package_weight_applied": true,
			"package_weight_reason":  "命中包装库2条装净含量70g",
			"packaged_candidates": []map[string]any{{
				"id":           "packaged:snickers-70g",
				"net_weight_g": 70,
			}},
			"nutrients": map[string]any{
				"calories": 340.97,
				"protein":  5.6,
				"carbs":    42.0,
				"fat":      16.0,
			},
		}},
	}
}

func assertRecipeInputPreservesPackagedMetadata(t *testing.T, items []map[string]any) {
	t.Helper()
	require.Len(t, items, 1)
	item := items[0]
	assert.Equal(t, "ai", item["suggested_ratio_source"])
	assert.Equal(t, float64(50), item["suggested_ratio"])
	assert.Equal(t, float64(100), item["ratio"])
	assert.Equal(t, "packaged_food_library", item["nutrition_source"])
	assert.Equal(t, "nutrition:snickers", item["matched_food_id"])
	assert.Equal(t, "packaged:snickers-70g", item["packaged_food_id"])
	assert.Equal(t, "matched", item["package_match_status"])
	assert.Equal(t, "packaged_food_library", item["package_weight_source"])
	assert.Equal(t, true, item["package_weight_applied"])
	assert.Equal(t, "命中包装库2条装净含量70g", item["package_weight_reason"])
	candidates, ok := item["packaged_candidates"].([]any)
	require.True(t, ok)
	require.Len(t, candidates, 1)
	candidate := candidates[0].(map[string]any)
	assert.Equal(t, "packaged:snickers-70g", candidate["id"])
	assert.Equal(t, float64(70), candidate["net_weight_g"])
}

func TestCreateRecipePreservesPackagedAnalysisMetadata(t *testing.T) {
	mockSvc := &mockRecipeService{}
	r := setupRecipeRouter(NewRecipeHandler(mockSvc))

	body, _ := json.Marshal(packagedRecipeRequestBody())
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/recipes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, mockSvc.createInput)
	assert.Equal(t, "零食混合餐收藏", mockSvc.createInput.RecipeName)
	assertRecipeInputPreservesPackagedMetadata(t, mockSvc.createInput.Items)
}

func TestUpdateRecipePreservesPackagedAnalysisMetadata(t *testing.T) {
	mockSvc := &mockRecipeService{}
	r := setupRecipeRouter(NewRecipeHandler(mockSvc))

	body, _ := json.Marshal(packagedRecipeRequestBody())
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/recipes/recipe-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, mockSvc.updateInput)
	assertRecipeInputPreservesPackagedMetadata(t, mockSvc.updateInput.Items)
}
