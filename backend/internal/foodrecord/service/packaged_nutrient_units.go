package service

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Keep invalid raw values invalid until validation, rather than silently turning them into 0.
func strictRawLabelNumber(value any) float64 {
	if value == nil {
		return 0
	}
	switch v := value.(type) {
	case float64:
		if !math.IsNaN(v) && !math.IsInf(v, 0) {
			return v
		}
	case int:
		return float64(v)
	case json.Number:
		if n, err := v.Float64(); err == nil && !math.IsNaN(n) && !math.IsInf(n, 0) {
			return n
		}
	case string:
		if n, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil && !math.IsNaN(n) && !math.IsInf(n, 0) {
			return n
		}
	}
	return -1 // Finite sentinel preserves JSON serialization while forcing review.
}

func validateLabelEnergy(value PackagedLabelNutritionValue, fallback string) error {
	if value.Value < 0 || math.IsNaN(value.Value) || math.IsInf(value.Value, 0) {
		return fmt.Errorf("能量数值无效")
	}
	unit := strings.ToLower(strings.TrimSpace(firstNonEmpty(value.Unit, fallback)))
	if value.Value == 0 && unit == "" {
		return nil
	}
	switch unit {
	case "kj", "千焦", "kcal", "千卡", "大卡":
		return nil
	}
	return fmt.Errorf("能量单位不明确")
}

func convertLabelMass(value PackagedLabelNutritionValue, target string) (float64, error) {
	if math.IsNaN(value.Value) || math.IsInf(value.Value, 0) || value.Value < 0 {
		return 0, fmt.Errorf("营养值必须有限且非负")
	}
	unit := strings.ToLower(strings.TrimSpace(value.Unit))
	unit = strings.NewReplacer("微克", "ug", "毫克", "mg", "克", "g", "μ", "u", "µ", "u", "α-te", "", "α－te", "", " ", "").Replace(unit)
	if unit == "" && value.Value == 0 {
		return 0, nil // Unlisted fields retain their missing raw-label evidence.
	}
	factors := map[string]float64{"g": 1, "mg": .001, "ug": .000001}
	factor, ok := factors[unit]
	if !ok {
		return 0, fmt.Errorf("营养素单位%s不支持直接换算，百分比必须有明确分母", value.Unit)
	}
	return value.Value * factor / factors[target], nil
}

func convertedLabelMassValues(raw PackagedLabelRawNutrition) (map[string]float64, error) {
	fields := []struct {
		key, unit string
		value     PackagedLabelNutritionValue
	}{
		{"protein", "g", raw.Protein}, {"carbs", "g", raw.Carbs}, {"fat", "g", raw.Fat},
		{"fiber", "g", raw.Fiber}, {"sugar", "g", raw.Sugar}, {"saturatedFat", "g", raw.SaturatedFat},
		{"cholesterolMg", "mg", raw.CholesterolMg}, {"sodiumMg", "mg", raw.SodiumMg}, {"potassiumMg", "mg", raw.PotassiumMg},
		{"calciumMg", "mg", raw.CalciumMg}, {"ironMg", "mg", raw.IronMg}, {"magnesiumMg", "mg", raw.MagnesiumMg}, {"zincMg", "mg", raw.ZincMg},
		{"vitaminARaeMcg", "ug", raw.VitaminARaeMcg}, {"vitaminCMg", "mg", raw.VitaminCMg}, {"vitaminDMcg", "ug", raw.VitaminDMcg},
		{"vitaminEMg", "mg", raw.VitaminEMg}, {"vitaminKMcg", "ug", raw.VitaminKMcg}, {"thiaminMg", "mg", raw.ThiaminMg},
		{"riboflavinMg", "mg", raw.RiboflavinMg}, {"niacinMg", "mg", raw.NiacinMg}, {"vitaminB6Mg", "mg", raw.VitaminB6Mg},
		{"folateMcg", "ug", raw.FolateMcg}, {"vitaminB12Mcg", "ug", raw.VitaminB12Mcg},
	}
	out := make(map[string]float64, len(fields))
	for _, field := range fields {
		value, err := convertLabelMass(field.value, field.unit)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", field.key, err)
		}
		out[field.key] = value
	}
	return out, nil
}
