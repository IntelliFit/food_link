package service

import "strings"

func validPackagedLabelUnits(result *PackagedProductExtractResult) bool {
	if result == nil || validateLabelEnergy(result.RawNutritionPerBasis.Energy, result.EnergyUnitRaw) != nil {
		return false
	}
	_, err := convertedLabelMassValues(result.RawNutritionPerBasis)
	return err == nil
}

// Converted maps contain default zeroes. Only the source label can distinguish
// an explicitly printed zero from a nutrient that the recognizer did not read.
// Optional micronutrients are deliberately outside this automatic-publication gate.
func missingPackagedCoreLabelFields(result *PackagedProductExtractResult) []string {
	if result == nil {
		return []string{"calories", "protein", "carbs", "fat"}
	}
	if stringFromAny(result.RawLabelPayload["combined_nutrition_source"]) == "multi_serving_weighted_average" {
		variants := extractPackagedServingNutritionVariants(result.RawLabelPayload)
		if len(variants) >= 2 {
			complete := true
			for _, variant := range variants {
				raw := mapFromAny(result.RawLabelPayload[variant.Label])
				seen := map[string]bool{}
				for key, value := range raw {
					field := packagedServingNutritionKey(key)
					text := strings.TrimSpace(stringFromAny(value))
					if nested := mapFromAny(value); len(nested) > 0 {
						_, seen[field] = nested["value"]
					} else if packagedNutritionNumberRE.MatchString(text) {
						seen[field] = true
					}
				}
				for _, field := range []string{"calories", "protein", "carbs", "fat"} {
					complete = complete && seen[field]
				}
			}
			if complete {
				return nil
			}
		}
	}
	fields := []struct {
		name string
		raw  PackagedLabelNutritionValue
	}{{"calories", result.RawNutritionPerBasis.Energy}, {"protein", result.RawNutritionPerBasis.Protein}, {"carbs", result.RawNutritionPerBasis.Carbs}, {"fat", result.RawNutritionPerBasis.Fat}}
	missing := []string{}
	for _, field := range fields {
		if strings.TrimSpace(field.raw.Unit) == "" && field.raw.Value == 0 {
			missing = append(missing, field.name)
		}
	}
	return missing
}
