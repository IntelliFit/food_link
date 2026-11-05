package service

import (
	"context"
	"math"
	"strings"
)

const (
	// A dish is only recomputed from the library when the matched ingredients
	// cover most of its weight; the rest is filled from the model's estimate.
	smartDishMinCoverage = 0.8
	// The component weights must roughly add up to the dish weight, otherwise
	// the split does not describe the same portion.
	smartDishWeightTolerance = 0.3
	// A library sum far from the model's whole-dish estimate means a wrong
	// split or a wrong ingredient match; keep the estimate instead.
	smartDishMaxKcalRatio = 2.0
)

var smartCookingFatFallbacks = []string{"花生油", "玉米油", "橄榄油"}

type smartComponent struct {
	name  string
	grams float64
	state string
}

func smartDishComponents(item map[string]any) []smartComponent {
	var raw []any
	switch value := firstNonNil(item["components"], item["ingredientsBreakdown"]).(type) {
	case []any:
		raw = value
	case []map[string]any:
		for _, entry := range value {
			raw = append(raw, entry)
		}
	}
	out := make([]smartComponent, 0, len(raw))
	for _, entry := range raw {
		component := mapFromAny(entry)
		name := strings.TrimSpace(stringFromAny(component["name"]))
		grams := numberFromAny(firstNonNil(component["grams"], component["weightGrams"], component["estimatedWeightGrams"]))
		if name == "" || grams <= 0 || math.IsInf(grams, 0) || math.IsNaN(grams) {
			continue
		}
		out = append(out, smartComponent{name: name, grams: grams, state: strings.TrimSpace(stringFromAny(firstNonNil(component["foodState"], component["food_state"])))})
	}
	return out
}

func smartIsCookingFat(name string) bool {
	name = strings.TrimSpace(name)
	return containsAnyAnalyzeText(name, smartCookingFatTokens) || name == "油" || strings.HasSuffix(name, "食用油")
}

// resolveSmartDish recomputes a mixed dish from its ingredients. The model
// still decides the split and the oil; per-gram nutrition comes from the
// library for every ingredient it can match.
func (r *smartRun) resolveDish(ctx context.Context, item map[string]any) (map[string]any, string) {
	components := smartDishComponents(item)
	if len(components) < 2 {
		return nil, "dish_without_components"
	}
	weight := nutritionWeightFromItem(item)
	total := 0.0
	for _, component := range components {
		total += component.grams
	}
	if weight <= 0 || total <= 0 || math.Abs(total-weight)/weight > smartDishWeightTolerance {
		return nil, "dish_components_weight_mismatch"
	}
	scaled := make([]smartComponent, len(components))
	for i, component := range components {
		scaled[i] = component
		scaled[i].grams = component.grams * weight / total
	}
	scaled, template := smartApplyDishTemplate(item, scaled, weight)
	reference := smartReferenceDish(scaled)
	sum := map[string]float64{}
	oilKcal := 0.0
	breakdown := make([]map[string]any, 0, len(scaled))
	matchedGrams, seasoningGrams := 0.0, 0.0
	for _, component := range scaled {
		grams := component.grams
		entry := map[string]any{"name": component.name, "grams": round2(grams)}
		if smartIsSeasoning(component.name) {
			// Sauces and salt are a few grams; they keep the model's share
			// and do not count against coverage.
			seasoningGrams += grams
			entry["status"] = "seasoning_model_share"
			breakdown = append(breakdown, entry)
			continue
		}
		var unit map[string]any
		var label, reason string
		if reference && smartIsWater(component.name) {
			unit, label = map[string]any{"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}, "水"
		} else if tableUnit, tableLabel, ok := smartReferenceIngredientState(component.name, component.state); ok {
			// Common ingredients use the standard table for their state; the
			// library aliases raw vegetables to stir-fried rows.
			unit, label = tableUnit, tableLabel
		} else {
			unit, label, reason = r.resolveComponent(ctx, component)
		}
		if unit != nil && (label == "植物油" || smartIsCookingFat(component.name)) {
			oilKcal += numberFromAny(unit["calories"]) * grams / 100
		}
		if unit == nil {
			entry["status"] = reason
			breakdown = append(breakdown, entry)
			continue
		}
		for key, value := range unit {
			sum[key] += numberFromAny(value) * grams / 100
		}
		matchedGrams += grams
		entry["status"] = "matched"
		entry["matched_food_name"] = label
		breakdown = append(breakdown, entry)
	}
	if weight-seasoningGrams <= 0 || matchedGrams/(weight-seasoningGrams) < smartDishMinCoverage {
		return nil, "dish_low_coverage"
	}
	modelNutrients := mapFromAny(item["nutrients"])
	unmatchedShare := (weight - matchedGrams) / weight
	for key, value := range modelNutrients {
		sum[key] += numberFromAny(value) * unmatchedShare
	}
	modelKcal := numberFromAny(modelNutrients["calories"])
	if modelKcal > 0 && smartDishSumDisagrees(sum["calories"], oilKcal, modelKcal) {
		return nil, "dish_sum_disagrees_with_model"
	}
	unit := map[string]any{}
	for key, value := range sum {
		unit[key] = value * 100 / weight
	}
	next := applySmartLibraryNutrition(item, unit, weight)
	next["component_nutrition"] = breakdown
	next["component_coverage"] = round2(matchedGrams / (weight - seasoningGrams))
	next["resolve_status"] = "component_library"
	next["is_unresolved"] = false
	next["nutrition_source"] = "component_library"
	next["smart_match_method"] = "dish_components"
	if template != nil {
		next["dish_template"] = template
	}
	if reference {
		next["smart_match_method"] = "dish_components_reference"
		return next, "matched_dish_reference"
	}
	return next, "matched_dish_components"
}

// smartDishSumDisagrees keeps the estimate when the recomputed sum is far from
// the model's own figure. Excess explained by the oil in the split is allowed:
// for stir-fried vegetables the model's calories leave out most of the oil it
// listed itself (122 g cabbage + 8 g oil reported as 48 kcal), which is the
// error the recompute fixes.
func smartDishSumDisagrees(sumKcal, oilKcal, modelKcal float64) bool {
	if sumKcal < modelKcal/smartDishMaxKcalRatio {
		return true
	}
	return sumKcal > modelKcal*smartDishMaxKcalRatio && sumKcal-oilKcal > modelKcal*smartDishMaxKcalRatio
}

func (r *smartRun) resolveComponent(ctx context.Context, component smartComponent) (map[string]any, string, string) {
	if smartIsWater(component.name) {
		return map[string]any{"calories": 0.0, "protein": 0.0, "carbs": 0.0, "fat": 0.0}, "水", ""
	}
	if smartIsCookingFat(component.name) {
		for _, query := range append([]string{component.name}, smartCookingFatFallbacks...) {
			result, err := r.resolveFood(ctx, query)
			if err == nil && result != nil && result.Food != nil && result.Food.KcalPer100g >= 600 {
				return nutritionUnit(result.Food), result.Food.CanonicalName, ""
			}
		}
		return nil, "", "cooking_fat_not_found"
	}
	match, reason := r.matchSingleFood(ctx, smartComponentItem(component), component.name)
	if match == nil {
		return nil, "", reason
	}
	return nutritionUnit(match.food), match.food.CanonicalName, ""
}

func smartComponentItem(component smartComponent) map[string]any {
	state := component.state
	if state == "" {
		state = "cooked"
	}
	return map[string]any{"name": component.name, "foodState": state, "weightBasis": "as_served", "isComposite": false, "addedIngredients": []any{}}
}

// Aromatics are matched by exact name only: "葱" is a seasoning, "洋葱" is not.
var (
	smartSauceTokens    = []string{"酱油", "生抽", "老抽", "蚝油", "醋", "料酒", "调味", "调料", "味精", "鸡精", "豆瓣酱", "辣椒面", "淀粉", "芡", "食盐"}
	smartAromaticsExact = map[string]bool{"盐": true, "葱": true, "葱花": true, "小葱": true, "香葱": true, "姜": true, "姜片": true, "姜丝": true, "姜末": true, "蒜": true, "蒜末": true, "蒜蓉": true, "蒜片": true, "香菜": true, "花椒": true, "八角": true, "胡椒": true, "胡椒粉": true, "孜然": true, "干辣椒": true}
)

func smartIsSeasoning(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" || smartIsCookingFat(name) {
		return false
	}
	return smartAromaticsExact[name] || (runeCount(name) <= 4 && containsAnyAnalyzeText(name, smartSauceTokens))
}

func smartIsWater(name string) bool {
	switch strings.TrimSpace(name) {
	case "水", "清水", "饮用水", "开水", "汤水", "冰块":
		return true
	}
	return false
}
