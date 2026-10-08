package nutritionagg

import "math"

// Amount distinguishes a recorded zero from an absent value. Values are in the
// item's recorded serving, not inferred from its name. Partial is a known
// subtotal, never the nutrient content of the complete meal/day.
type Amount struct {
	Value      float64 `json:"value"`
	Unit       string  `json:"unit"`
	Status     string  `json:"status"`
	KnownItems int     `json:"known_items"`
	TotalItems int     `json:"total_items"`
}

type Vector map[string]Amount

type Definition struct {
	Key     string
	Label   string
	Unit    string
	Aliases []string
}

// Explicit unit-bearing aliases prevent mg/mcg and vitamin A RAE conversions
// from being guessed. The registry is shared by candidate and intake pipelines.
var Definitions = []Definition{
	{"fiber", "膳食纤维", "g", []string{"fiber", "fiber_g"}},
	{"sodiumMg", "钠", "mg", []string{"sodiumMg", "sodium_mg"}},
	{"potassiumMg", "钾", "mg", []string{"potassiumMg", "potassium_mg"}},
	{"calciumMg", "钙", "mg", []string{"calciumMg", "calcium_mg"}},
	{"ironMg", "铁", "mg", []string{"ironMg", "iron_mg"}},
	{"magnesiumMg", "镁", "mg", []string{"magnesiumMg", "magnesium_mg"}},
	{"zincMg", "锌", "mg", []string{"zincMg", "zinc_mg"}},
	{"vitaminARaeMcg", "维生素A", "mcg RAE", []string{"vitaminARaeMcg", "vitamin_a_rae_mcg"}},
	{"vitaminCMg", "维生素C", "mg", []string{"vitaminCMg", "vitamin_c_mg"}},
	{"vitaminDMcg", "维生素D", "mcg", []string{"vitaminDMcg", "vitamin_d_mcg"}},
	{"vitaminEMg", "维生素E", "mg alpha-TE", []string{"vitaminEAlphaTeMg", "vitamin_e_alpha_te_mg"}},
	{"vitaminB12Mcg", "维生素B12", "mcg", []string{"vitaminB12Mcg", "vitamin_b12_mcg"}},
	{"folateDfeMcg", "叶酸", "mcg DFE", []string{"folateDfeMcg", "folate_dfe_mcg"}},
	{"saturatedFat", "饱和脂肪", "g", []string{"saturatedFat", "saturated_fat_g"}},
	{"freeSugar", "游离糖", "g", []string{"freeSugar", "free_sugar_g"}},
}

func (a Amount) Complete() bool {
	return a.TotalItems > 0 && a.KnownItems == a.TotalItems &&
		(a.Status == "recorded" || a.Status == "estimated") &&
		!math.IsNaN(a.Value) && !math.IsInf(a.Value, 0) && a.Value >= 0
}

// Observe keeps missing/invalid data out of decision calculations. The old
// SumMetrics remains unchanged for legacy consumers and version comparisons.
func Observe(items []map[string]any, applyIntake bool) Vector {
	out := Vector{}
	for _, def := range Definitions {
		a := Amount{Unit: def.Unit, TotalItems: len(items), Status: "missing"}
		estimated := false
		for _, item := range items {
			factor := 1.0
			if applyIntake {
				if ratio, exists := item["ratio"]; exists && ratio != nil {
					v, ok := numberFromAny(ratio)
					if !ok || v < 0 || v > 100 || math.IsNaN(v) || math.IsInf(v, 0) {
						continue
					}
				}
				factor = intakeFactor(item)
			}
			value, ok := metricValue(item, def.Aliases)
			if metadata, exists := item["nutrient_status"].(map[string]any); exists {
				if status, _ := metadata[def.Key].(string); status == "missing" || status == "invalid" {
					ok = false
				}
			}
			if !ok || value < 0 || math.IsNaN(value) || math.IsInf(value, 0) ||
				factor < 0 || factor > 1 || math.IsNaN(factor) || math.IsInf(factor, 0) {
				continue
			}
			a.Value += value * factor
			a.KnownItems++
			category, _ := item["nutrition_source_category"].(string)
			if category == "library_estimate" || category == "ai_estimate" || category == "estimated" {
				estimated = true
			}
		}
		if a.KnownItems > 0 {
			a.Status = "partial"
			if a.KnownItems == a.TotalItems {
				a.Status = "recorded"
				if estimated {
					a.Status = "estimated"
				}
			}
		}
		out[def.Key] = a
	}
	return out
}

// Combine propagates missing components instead of calling their values zero.
func Combine(vectors ...Vector) Vector {
	out := Vector{}
	for _, def := range Definitions {
		a := Amount{Unit: def.Unit, Status: "missing"}
		estimated := false
		for _, vector := range vectors {
			v, exists := vector[def.Key]
			if !exists || v.TotalItems == 0 {
				a.TotalItems++
				continue
			}
			a.TotalItems += v.TotalItems
			if v.Unit != def.Unit || v.KnownItems < 0 || v.KnownItems > v.TotalItems || v.Value < 0 || math.IsNaN(v.Value) || math.IsInf(v.Value, 0) {
				continue
			}
			a.KnownItems += v.KnownItems
			a.Value += v.Value
			estimated = estimated || v.Status == "estimated"
		}
		if a.KnownItems > 0 {
			a.Status = "partial"
			if a.KnownItems == a.TotalItems {
				a.Status = "recorded"
				if estimated {
					a.Status = "estimated"
				}
			}
		}
		out[def.Key] = a
	}
	return out
}
