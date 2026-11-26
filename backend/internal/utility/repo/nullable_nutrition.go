package repo

import fooddomain "food_link/backend/internal/foodrecord/domain"

func manualUnknownFields(food fooddomain.FoodNutrition) []string {
	result := []string{}
	for _, column := range food.UnknownNutritionFields {
		if key, ok := fooddomain.NutritionFields[column]; ok {
			if key == "sodiumMg" {
				key = "sodium_mg"
			}
			result = append(result, key)
		}
	}
	return result
}

func measuredUnknownFields(values map[string]float64) []string {
	result := []string{}
	for _, key := range fooddomain.NutritionFields {
		if key == "sodiumMg" {
			key = "sodium_mg"
		}
		if _, ok := values[key]; !ok {
			result = append(result, key)
		}
	}
	return result
}
