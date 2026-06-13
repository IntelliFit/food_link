//go:build real_llm

package service

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func loadOfoxConfigForRealTest(t *testing.T) (apiKey, baseURL string) {
	t.Helper()
	apiKey = os.Getenv("OFOXAI_API_KEY")
	baseURL = os.Getenv("OFOXAI_BASE_URL")
	if apiKey != "" {
		return apiKey, baseURL
	}
	// Fall back to backend/config.yaml so local dev does not need an env var.
	_, file, _, ok := runtime.Caller(0)
	require.True(t, ok, "failed to get current file path")
	backendDir := filepath.Join(filepath.Dir(file), "..", "..", "..")
	configPath := filepath.Join(backendDir, "config.yaml")
	if _, err := os.Stat(configPath); err != nil {
		t.Skipf("OFOXAI_API_KEY not set and %s not found; skipping real LLM test", configPath)
	}
	v := viper.New()
	v.SetConfigFile(configPath)
	if err := v.ReadInConfig(); err != nil {
		t.Skipf("failed to read %s: %v; skipping real LLM test", configPath, err)
	}
	apiKey = v.GetString("external.ofoxai_api_key")
	baseURL = v.GetString("external.ofoxai_base_url")
	if apiKey == "" {
		t.Skip("OFOXAI_API_KEY not set and external.ofoxai_api_key missing from config.yaml; skipping real LLM test")
	}
	return apiKey, baseURL
}

// TestIngredientLabelRealImage validates that a real packaged-food ingredient-label
// image is recognized in standard (normal) mode and that the per-100g nutrition
// values reported by the visual model match the printed label.
//
// Image source: http://cdn-food-images.coachlink.fit/3638910d-422b-4772-a9b7-30086007ad1a.jpg
// Label values per 100g:
//   - energy: 1566 kJ (~374 kcal)
//   - protein: 11.5 g
//   - fat: 15.5 g
//   - carbs: 46.9 g
//   - sodium: 153 mg
//
// Run with: go test -tags=real_llm ./internal/analyze/service/... -run TestIngredientLabelRealImage -v
func TestIngredientLabelRealImage(t *testing.T) {
	apiKey, baseURL := loadOfoxConfigForRealTest(t)

	imageURL := "http://cdn-food-images.coachlink.fit/3638910d-422b-4772-a9b7-30086007ad1a.jpg"
	mode := defaultExecutionMode

	ofoxClient := NewOfoxAIClient(apiKey, "", baseURL)
	svc := NewAnalyzeService(nil, ofoxClient, nil, nil)

	ctx := context.Background()
	result, err := svc.Analyze(ctx, "", AnalyzeInput{
		ImageURL:            imageURL,
		SuggestRatioEnabled: false,
		ExecutionMode:       &mode,
	})
	require.NoError(t, err)
	require.NotNil(t, result)

	items := toItems(result["items"])
	require.NotEmpty(t, items, "expected at least one food item from the ingredient-label image")

	// The first (and usually only) item should carry the ingredient-label nutrition.
	item := items[0]
	assert.Equal(t, "ingredient_label", item["nutrition_source"], "nutrition should come from the ingredient label")
	assert.Equal(t, "user_image_label", item["nutrition_source_category"], "category should be user-uploaded ingredient label")

	ingredients, ok := item["ingredients"].(map[string]any)
	require.True(t, ok, "item should contain parsed ingredients block")
	assert.NotEmpty(t, ingredients["ingredientsText"], "ingredients text should be present")

	unit, ok := item["unit_nutrition_per_100g"].(map[string]any)
	require.True(t, ok, "unit nutrition per 100g should be present")

	// Energy may be returned as kJ or converted to kcal; tolerate either unit.
	energyKcal := numberFromAny(unit["calories"])
	energyKj := numberFromAny(unit["energyKj"])
	if energyKcal == 0 && energyKj == 0 {
		t.Fatalf("expected calories or energyKj in unit nutrition, got %+v", unit)
	}
	if energyKcal > 0 {
		assert.InDelta(t, 374.0, energyKcal, 20.0, "calories per 100g should match label (~1566 kJ -> ~374 kcal)")
	} else {
		assert.InDelta(t, 1566.0, energyKj, 80.0, "energyKj per 100g should match label")
	}

	assert.InDelta(t, 11.5, numberFromAny(unit["protein"]), 1.5, "protein per 100g should match label")
	assert.InDelta(t, 15.5, numberFromAny(unit["fat"]), 1.5, "fat per 100g should match label")
	assert.InDelta(t, 46.9, numberFromAny(unit["carbs"]), 3.0, "carbs per 100g should match label")
	assert.InDelta(t, 153.0, numberFromAny(unit["sodiumMg"]), 20.0, "sodium per 100g should match label")
}
