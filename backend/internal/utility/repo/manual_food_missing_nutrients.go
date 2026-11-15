package repo

import "strings"

// manualMissingNutrients forwards explicit source gaps, rather than treating a
// stored zero as either proof of absence or proof of missing data.
func manualMissingNutrients(evidence map[string]any) []string {
	keys := []string{"calories", "protein", "carbs", "fat", "fiber", "sugar", "saturatedFat", "cholesterolMg", "sodium_mg", "potassiumMg", "calciumMg", "ironMg", "magnesiumMg", "zincMg", "vitaminARaeMcg", "vitaminCMg", "vitaminDMcg", "vitaminEMg", "vitaminKMcg", "thiaminMg", "riboflavinMg", "niacinMg", "vitaminB6Mg", "folateMcg", "vitaminB12Mcg"}
	normalize := func(raw string) string {
		return strings.ToLower(strings.NewReplacer("_", "", "-", "", " ", "").Replace(strings.TrimSpace(raw)))
	}
	aliases := map[string]string{}
	for _, key := range keys {
		aliases[normalize(key)] = key
	}
	for raw, key := range map[string]string{
		"energy": "calories", "kcal": "calories", "energy_kj": "calories", "kcal_per_100g": "calories",
		"saturated_fat": "saturatedFat", "saturated_fat_per_100g": "saturatedFat",
		"sodium_mg_per_100g": "sodium_mg", "vitamin_a_rae_mcg_per_100g": "vitaminARaeMcg",
		"vitamin_b12_mcg_per_100g": "vitaminB12Mcg", "vitamin_b6_mg_per_100g": "vitaminB6Mg",
	} {
		aliases[normalize(raw)] = key
	}
	for _, key := range keys {
		aliases[normalize(key+"_per_100g")] = key
	}
	seen := map[string]bool{}
	add := func(raw string) {
		if normalize(raw) == "vitamins" {
			for _, key := range keys[14:] {
				seen[key] = true
			}
			return
		}
		if key := aliases[normalize(raw)]; key != "" {
			seen[key] = true
		}
	}
	var visit func(map[string]any, int)
	visit = func(values map[string]any, depth int) {
		if values == nil || depth > 3 {
			return
		}
		for _, name := range []string{"missing_nutrients", "missing_fields", "unknown_fields", "unknown_nutrients", "source_missing_nutrients"} {
			switch list := values[name].(type) {
			case []string:
				for _, raw := range list {
					add(raw)
				}
			case []any:
				for _, value := range list {
					if raw, ok := value.(string); ok {
						add(raw)
					}
				}
			}
		}
		if nutrients, ok := values["raw_nutrition_per_basis"].(map[string]any); ok {
			for key, value := range nutrients {
				if cell, ok := value.(map[string]any); ok && len(cell) == 0 {
					add(key)
				}
			}
		}
		for _, name := range []string{"data_cleanup", "metadata", "raw_label_payload"} {
			if nested, ok := values[name].(map[string]any); ok {
				visit(nested, depth+1)
			}
		}
	}
	visit(evidence, 0)
	var out []string
	for _, key := range keys {
		if seen[key] {
			out = append(out, key)
		}
	}
	return out
}
