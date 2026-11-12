package handler

import (
	"food_link/backend/internal/foodmeasure"
	"food_link/backend/internal/utility/domain"
	"github.com/gin-gonic/gin"
)

// Old volume-aware pages use default_weight_grams as their quantity field.
// Project ONLY the HTTP response for these clients; native results and saved
// records keep real grams (unknown mass stays zero).
func manualFoodResponseItem(c *gin.Context, item domain.ManualFoodResult) domain.ManualFoodResult {
	m := item.Measurement
	if c.Query("measurement_version") == "1" || m == nil || m.Unit != foodmeasure.Milliliter || m.Validate() != nil {
		return item
	}
	item.DefaultWeightGrams = m.Amount
	item.ServingPresets = nil
	return item
}

func manualFoodResponseItems(c *gin.Context, items []domain.ManualFoodResult) []domain.ManualFoodResult {
	if items == nil {
		return nil
	}
	result := make([]domain.ManualFoodResult, len(items))
	for i, item := range items {
		result[i] = manualFoodResponseItem(c, item)
	}
	return result
}
