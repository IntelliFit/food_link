package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDeepSeekNutritionEstimator_EstimateParsesMicronutrients(t *testing.T) {
	estimator := NewDeepSeekNutritionEstimator("test-key", "", "")
	estimator.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"items\":[{\"index\":0,\"unitNutritionPer100g\":{\"calories\":100,\"protein\":3,\"carbs\":20,\"fat\":1,\"fiber\":2,\"sugar\":4,\"sodiumMg\":15,\"calciumMg\":20,\"vitaminCMg\":8,\"vitaminB12Mcg\":0.3}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	rows, err := estimator.Estimate(context.Background(), []UnresolvedNutritionCandidate{{
		Index:                0,
		Name:                 "测试食物",
		EstimatedWeightGrams: 100,
	}}, "")
	require.NoError(t, err)
	require.Contains(t, rows, 0)
	assert.Equal(t, 100.0, rows[0]["calories"])
	assert.Equal(t, 15.0, rows[0]["sodiumMg"])
	assert.Equal(t, 20.0, rows[0]["calciumMg"])
	assert.Equal(t, 8.0, rows[0]["vitaminCMg"])
	assert.Equal(t, 0.3, rows[0]["vitaminB12Mcg"])
}

func TestDeepSeekNutritionEstimator_EstimateParsesSnakeCaseMicronutrients(t *testing.T) {
	estimator := NewDeepSeekNutritionEstimator("test-key", "", "")
	estimator.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"items\":[{\"index\":0,\"unitNutritionPer100g\":{\"calories\":90,\"protein\":2,\"carbs\":12,\"fat\":1,\"sodium_mg\":11,\"calcium_mg\":22,\"vitamin_c_mg\":6,\"vitamin_b12_mcg\":0.2}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	rows, err := estimator.Estimate(context.Background(), []UnresolvedNutritionCandidate{{
		Index:                0,
		Name:                 "测试食物",
		EstimatedWeightGrams: 100,
	}}, "")
	require.NoError(t, err)
	require.Contains(t, rows, 0)
	assert.Equal(t, 90.0, rows[0]["calories"])
	assert.Equal(t, 11.0, rows[0]["sodiumMg"])
	assert.Equal(t, 22.0, rows[0]["calciumMg"])
	assert.Equal(t, 6.0, rows[0]["vitaminCMg"])
	assert.Equal(t, 0.2, rows[0]["vitaminB12Mcg"])
}

func TestDeepSeekNutritionEstimator_EstimateParsesArrayContent(t *testing.T) {
	estimator := NewDeepSeekNutritionEstimator("test-key", "", "")
	estimator.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"[{\"index\":0,\"unitNutritionPer100g\":{\"calories\":90,\"protein\":2,\"carbs\":12,\"fat\":1,\"calciumMg\":22,\"vitaminCMg\":6}}]"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	rows, err := estimator.Estimate(context.Background(), []UnresolvedNutritionCandidate{{
		Index:                0,
		Name:                 "测试食物",
		EstimatedWeightGrams: 100,
	}}, "")
	require.NoError(t, err)
	require.Contains(t, rows, 0)
	assert.Equal(t, 22.0, rows[0]["calciumMg"])
	assert.Equal(t, 6.0, rows[0]["vitaminCMg"])
}

func TestDeepSeekNutritionEstimator_DefaultsToV4Flash(t *testing.T) {
	estimator := NewDeepSeekNutritionEstimator("test-key", "", "")

	assert.Equal(t, "deepseek-v4-flash", estimator.Model)
}

func TestDeepSeekNutritionEstimator_NormalizesFallbackEnergyConsistency(t *testing.T) {
	estimator := NewDeepSeekNutritionEstimator("test-key", "", "")
	estimator.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"items\":[{\"index\":0,\"unitNutritionPer100g\":{\"calories\":0,\"protein\":0.1,\"carbs\":2,\"fat\":0,\"fiber\":0,\"sugar\":5,\"saturatedFat\":3}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	rows, err := estimator.Estimate(context.Background(), []UnresolvedNutritionCandidate{{
		Index:                0,
		Name:                 "测试咖啡",
		EstimatedWeightGrams: 900,
	}}, "")
	require.NoError(t, err)
	require.Contains(t, rows, 0)
	assert.Equal(t, 8.4, rows[0]["calories"])
	assert.Equal(t, 2.0, rows[0]["sugar"])
	assert.Equal(t, 0.0, rows[0]["saturatedFat"])
}

func TestDeepSeekNutritionEstimator_EstimateParsesCarbohydrateAlias(t *testing.T) {
	estimator := NewDeepSeekNutritionEstimator("test-key", "", "")
	estimator.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"items\":[{\"index\":0,\"unitNutritionPer100g\":{\"calories\":250,\"protein\":8,\"carbohydrate\":35,\"fat\":10,\"fiber\":3,\"sugar\":5}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	rows, err := estimator.Estimate(context.Background(), []UnresolvedNutritionCandidate{{
		Index:                0,
		Name:                 "测试牛肉面",
		EstimatedWeightGrams: 100,
	}}, "")
	require.NoError(t, err)
	require.Contains(t, rows, 0)
	assert.Equal(t, 35.0, rows[0]["carbs"])
	assert.Equal(t, 250.0, rows[0]["calories"])
	assert.Equal(t, 8.0, rows[0]["protein"])
}

func TestDeepSeekNutritionEstimator_EstimateParsesCarbohydratesPluralAlias(t *testing.T) {
	estimator := NewDeepSeekNutritionEstimator("test-key", "", "")
	estimator.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"items\":[{\"index\":0,\"unitNutritionPer100g\":{\"calories\":180,\"protein\":5,\"carbohydrates\":22,\"fat\":7}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	rows, err := estimator.Estimate(context.Background(), []UnresolvedNutritionCandidate{{
		Index:                0,
		Name:                 "测试酱牛肉",
		EstimatedWeightGrams: 100,
	}}, "")
	require.NoError(t, err)
	require.Contains(t, rows, 0)
	assert.Equal(t, 22.0, rows[0]["carbs"])
}

func TestDeepSeekNutritionEstimator_EstimateParsesAllMacroAliases(t *testing.T) {
	estimator := NewDeepSeekNutritionEstimator("test-key", "", "")
	estimator.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"{\"items\":[{\"index\":0,\"unitNutritionPer100g\":{\"kcal\":350,\"total_protein\":12,\"carbohydrate\":45,\"total_fat\":15,\"dietary_fiber\":8,\"total_sugar\":6}}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	rows, err := estimator.Estimate(context.Background(), []UnresolvedNutritionCandidate{{
		Index:                0,
		Name:                 "测试全麦面包",
		EstimatedWeightGrams: 100,
	}}, "")
	require.NoError(t, err)
	require.Contains(t, rows, 0)
	assert.Equal(t, 350.0, rows[0]["calories"])
	assert.Equal(t, 12.0, rows[0]["protein"])
	assert.Equal(t, 45.0, rows[0]["carbs"])
	assert.Equal(t, 15.0, rows[0]["fat"])
	assert.Equal(t, 8.0, rows[0]["fiber"])
	assert.Equal(t, 6.0, rows[0]["sugar"])
}
