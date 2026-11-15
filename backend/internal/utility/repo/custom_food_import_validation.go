package repo

import (
	"fmt"
	"food_link/backend/internal/foodmeasure"
	fooddomain "food_link/backend/internal/foodrecord/domain"
)

func validateCustomFoodImport(input CustomFoodInput) error {
	if input.Measurement != nil {
		m := input.Measurement.Clone()
		if err := m.Validate(); err != nil {
			return err
		}
		if err := fooddomain.ValidateNutrientComponents(m.NutrientsPerBasis); err != nil {
			return err
		}
		if _, known := m.Grams(); known {
			values, err := m.Scale(100, foodmeasure.Gram)
			if err != nil {
				return err
			}
			return fooddomain.ValidateLibraryNutrition("100g", values)
		}
		return nil // Volume/count without a measured mass has no g-based ceiling.
	}
	values := map[string]float64{}
	if len(input.NutrientsPer100g) > 0 {
		for key, raw := range input.NutrientsPer100g {
			value, ok := raw.(float64)
			if !ok {
				switch v := raw.(type) {
				case int:
					value = float64(v)
				case float32:
					value = float64(v)
				default:
					return fmt.Errorf("营养字段%s须填写数值，单位另选", key)
				}
			}
			values[key] = value
		}
	} else {
		grams := input.DefaultWeightGrams
		if grams <= 0 {
			grams = 100
		}
		values = map[string]float64{"calories": input.TotalCalories * 100 / grams, "protein": input.TotalProtein * 100 / grams, "carbs": input.TotalCarbs * 100 / grams, "fat": input.TotalFat * 100 / grams}
	}
	return fooddomain.ValidateLibraryNutrition("100g", values)
}
