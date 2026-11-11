package repo

import (
	"encoding/json"
	"fmt"
	"strings"

	"food_link/backend/internal/foodmeasure"
	fooddomain "food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/utility/domain"
)

func nutrientValues(n *domain.ManualFoodNutrients) map[string]float64 {
	values := map[string]float64{}
	if n == nil {
		return values
	}
	encoded, _ := json.Marshal(n)
	_ = json.Unmarshal(encoded, &values)
	return values
}

func nutrientAny(values map[string]float64) map[string]any {
	result := make(map[string]any, len(values))
	for name, value := range values {
		result[name] = value
	}
	return result
}

func measurementUnitLabel(unit foodmeasure.Unit) string {
	switch unit {
	case foodmeasure.Piece:
		return "个"
	case foodmeasure.Serving:
		return "份"
	default:
		return string(unit)
	}
}

func applyMeasuredFoodResult(result *domain.ManualFoodResult) bool {
	if result.Measurement == nil || result.Measurement.Validate() != nil {
		return false
	}
	m := result.Measurement
	totals, err := m.Totals()
	if err != nil {
		return false
	}
	result.TotalCalories, result.TotalProtein = totals["calories"], totals["protein"]
	result.TotalCarbs, result.TotalFat = totals["carbs"], totals["fat"]
	extra := manualFoodNutrientsFromMap(nutrientAny(totals))
	result.ExtraNutrients = &extra
	result.DefaultWeightGrams = 0
	result.NutrientsPer100g = nil
	if _, known := m.Grams(); !known {
		result.ServingPresets = nil
	}
	if grams, known := m.Grams(); known {
		result.DefaultWeightGrams = grams
		if per100, scaleErr := m.Scale(100, foodmeasure.Gram); scaleErr == nil {
			n := manualFoodNutrientsFromMap(nutrientAny(per100))
			result.NutrientsPer100g = &n
		}
	}
	result.DisplayUnit, result.DisplayUnitLabel = string(m.Unit), measurementUnitLabel(m.Unit)
	result.PortionLabel = formatManualCompactNumber(m.Amount) + result.DisplayUnitLabel
	if result.Source == "custom" {
		result.Subtitle = fmt.Sprintf("%.0f kcal / %s", result.TotalCalories, result.PortionLabel)
	}
	return true
}

// Nutrition-library rows are genuinely per100g. A name suggesting a beverage
// never establishes density; only the existing explicit piece weight presets
// can create a count conversion.
func attachNutritionMeasurement(result *domain.ManualFoodResult) {
	if result.Measurement != nil || result.NutrientsPer100g == nil {
		return
	}
	m := &foodmeasure.Measurement{Amount: result.DefaultWeightGrams, Unit: foodmeasure.Gram,
		BasisAmount: 100, BasisUnit: foodmeasure.Gram, NutrientsPerBasis: nutrientValues(result.NutrientsPer100g)}
	if result.DisplayUnit == "piece" && result.DefaultWeightGrams > 0 {
		m.Amount, m.Unit = 1, foodmeasure.Piece
		m.UnitConversions = map[foodmeasure.Unit]float64{foodmeasure.Piece: result.DefaultWeightGrams}
	} else if result.DisplayUnit == "ml" || m.Amount <= 0 {
		m.Amount = 100
		result.ServingPresets = nil
	}
	result.Measurement = m
	applyMeasuredFoodResult(result)
}

func packagedMeasurement(item fooddomain.PackagedFood, nutrients *domain.ManualFoodNutrients) *foodmeasure.Measurement {
	basis := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(stringPtrValue(item.NutritionBasisUnit)), " ", ""))
	var unit foodmeasure.Unit
	switch basis {
	case "100g":
		unit = foodmeasure.Gram
	case "100ml":
		unit = foodmeasure.Milliliter
	default:
		return nil
	}
	amount := 100.0
	contentUnit := strings.ToLower(strings.TrimSpace(stringPtrValue(item.NetContentUnit)))
	if unit == foodmeasure.Milliliter && ((contentUnit == "ml" && item.NetContentValue > 750) || item.ServingWeightG > 750) {
		amount = 500
	}
	// Net content only establishes a quantity in the same unit as the label.
	if contentUnit == string(unit) && item.NetContentValue > 0 && item.NetContentValue <= 750 {
		amount = item.NetContentValue
	} else if unit == foodmeasure.Gram && item.NetWeightG > 0 && item.NetWeightG <= 500 {
		amount = item.NetWeightG
	}
	if unit == foodmeasure.Gram {
		if serving := validPackagedServingWeight(item); serving > 0 {
			amount = serving
		}
	}
	m := &foodmeasure.Measurement{Amount: amount, Unit: unit, BasisAmount: 100, BasisUnit: unit, NutrientsPerBasis: nutrientValues(nutrients)}
	// An explicit single-unit content gives one piece's amount without inventing mass.
	if item.UnitContentValue > 0 && strings.EqualFold(strings.TrimSpace(stringPtrValue(item.UnitContentUnit)), string(unit)) {
		m.UnitConversions = map[foodmeasure.Unit]float64{foodmeasure.Piece: item.UnitContentValue}
	}
	return m
}

func publicFoodKnownGrams(items []map[string]any) (float64, bool) {
	if len(items) == 0 {
		return 0, false
	}
	total := 0.0
	for _, item := range items {
		if item == nil {
			return 0, false
		}
		if raw := item["measurement"]; raw != nil {
			encoded, _ := json.Marshal(raw)
			var m foodmeasure.Measurement
			if json.Unmarshal(encoded, &m) != nil || m.Validate() != nil {
				return 0, false
			}
			grams, known := m.Grams()
			if !known {
				return 0, false
			}
			total += grams * publicMeasuredItemRatio(item)
			continue
		}
		for _, key := range []string{"manual_portion_label", "portion_description", "unit"} {
			text := strings.ToLower(fmt.Sprint(item[key]))
			if strings.Contains(text, "ml") || strings.Contains(text, "毫升") {
				return 0, false
			}
		}
		grams := publicFoodItemWeightGrams(item)
		if grams <= 0 {
			return 0, false
		}
		total += grams
	}
	return total, total > 0
}

func publicMeasuredItemRatio(item map[string]any) float64 {
	if item["measurement"] == nil {
		return 1
	}
	if raw, exists := item["ratio"]; exists {
		ratio := numberFromAny(raw)
		if ratio >= 0 && ratio <= 100 {
			return ratio / 100
		}
	}
	return 1
}

func attachPublicMeasurement(result *domain.ManualFoodResult) {
	values := nutrientValues(result.ExtraNutrients)
	values["calories"], values["protein"] = result.TotalCalories, result.TotalProtein
	values["carbs"], values["fat"] = result.TotalCarbs, result.TotalFat
	m := &foodmeasure.Measurement{Amount: 1, Unit: foodmeasure.Serving, BasisAmount: 1, BasisUnit: foodmeasure.Serving, NutrientsPerBasis: values}
	if grams, known := publicFoodKnownGrams(result.Items); known {
		m.UnitConversions = map[foodmeasure.Unit]float64{foodmeasure.Gram: 1 / grams}
	}
	result.Measurement = m
	applyMeasuredFoodResult(result)
}
