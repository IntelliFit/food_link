package worker

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"food_link/backend/internal/foodmeasure"
)

// 纠错清单里的食物有两种计量方式：只有克数的识别结果，和带声明计量信息（measurement）的
// 食物库条目。后者按毫升、个或份计量时可能没有克数（克数为 0），营养由计量信息换算得到，
// 结果页和记录入口都以计量信息为准。本文件让纠错的重估与合并两步遵守同一口径。

// scopedCorrectionRow is one validated row of the correction list.
type scopedCorrectionRow struct {
	name              string
	originalIndex     int // -1 when the row is not part of the original meal
	renamed           bool
	explicitNutrition bool
	// weight is the edible mass in grams. It is 0 only for a row that keeps a
	// declared measurement with no known mass (millilitres, pieces, servings).
	weight float64
	// measurement is the declared quantity and nutrition label the final item
	// keeps: nil for gram-only rows and for rows renamed into another food.
	measurement *foodmeasure.Measurement
}

const scopedCorrectionMaxAmount = 100000

func readScopedCorrectionRow(correction map[string]any, previous []map[string]any) (scopedCorrectionRow, error) {
	row := scopedCorrectionRow{name: strings.TrimSpace(firstNonEmptyString(correction, "name"))}
	if row.name == "" {
		return row, fmt.Errorf("纠错清单里有食物没有名称，请填写后重新提交")
	}
	invalidAmount := fmt.Errorf("「%s」的份量无效，请填写大于 0 的数量后重新提交", row.name)
	row.originalIndex = scopedPreviousIndex(correction, previous)
	row.renamed = row.originalIndex < 0 || normalizeScopedName(row.name) != normalizeScopedName(firstNonEmptyString(previous[row.originalIndex], "name"))
	row.explicitNutrition, _ = explicitCorrectionNutritionEdited(correction)

	measurement, measured := foodmeasure.FromAny(correction["measurement"])
	switch {
	case !measured:
		weight, valid := firstPositiveFloat(correction, "weight", "estimatedWeightGrams")
		if !valid {
			return row, invalidAmount
		}
		row.weight = weight
	case row.renamed && !row.explicitNutrition:
		// 换成了另一种食物：原食物的营养标示不再适用，按克数重新估算营养。
		grams, known := measurement.Grams()
		switch {
		case known:
			row.weight = grams
		case measurement.Unit == foodmeasure.Milliliter:
			// 饮品改名后按 1 毫升约 1 克估算；只用于重新估算，不写回任何营养标示。
			row.weight = measurement.Amount
		default:
			return row, fmt.Errorf("「%s」原来按%s计量，换成别的食物后需要克数，请删除这一项后重新添加", row.name, measurement.Unit.Label())
		}
	default:
		if row.explicitNutrition {
			measurement = measurementFollowingEditedNutrients(correction, measurement)
		}
		row.weight, _ = measurement.Grams()
		row.measurement = measurement
		if measurement.Amount > scopedCorrectionMaxAmount {
			return row, invalidAmount
		}
	}
	if math.IsNaN(row.weight) || math.IsInf(row.weight, 0) || row.weight > scopedCorrectionMaxAmount || (row.measurement == nil && row.weight <= 0) {
		return row, invalidAmount
	}
	return row, nil
}

// applyScopedMeasurement makes the declared measurement the single source of
// the item's amount and nutrition, as the result page and the recording
// boundary do. Mass fields hold real grams only.
func applyScopedMeasurement(next map[string]any, measurement *foodmeasure.Measurement) error {
	totals, err := measurement.Totals()
	if err != nil {
		return fmt.Errorf("「%s」的数量或营养单位无效，请删除这一项后重新添加", firstNonEmptyString(next, "name"))
	}
	previous := mapFromAny(next["nutrients"])
	nutrients := make(map[string]any, len(totals)+4)
	for key, value := range totals {
		nutrients[key] = round2(value)
	}
	// 两种写法保持同步；标示里没有水分时沿用条目原值。
	for _, pair := range [][2]string{{"sodium_mg", "sodiumMg"}, {"water_ml", "waterMl"}} {
		snake, hasSnake := nutrients[pair[0]]
		camel, hasCamel := nutrients[pair[1]]
		switch {
		case hasSnake && !hasCamel:
			nutrients[pair[1]] = snake
		case hasCamel && !hasSnake:
			nutrients[pair[0]] = camel
		case !hasSnake && !hasCamel && pair[0] == "water_ml":
			for _, key := range pair {
				if value, ok := previous[key]; ok {
					nutrients[key] = value
				}
			}
		}
	}
	// 标示里没有的三大营养素按 0 计，与结果页和记录入口一致，条目上的同名字段不留旧值。
	for _, key := range []string{"calories", "protein", "carbs", "fat"} {
		if _, ok := nutrients[key]; !ok {
			nutrients[key] = 0.0
		}
	}
	grams, _ := measurement.Grams()
	grams = round2(grams)
	next["nutrients"] = nutrients
	next["measurement"] = measurement.Map()
	next["estimatedWeightGrams"], next["originalWeightGrams"], next["grossWeightGrams"] = grams, grams, grams
	next["ediblePortionRatio"] = 100
	for _, key := range []string{"final_weight_g", "weight"} {
		if _, exists := next[key]; exists {
			next[key] = grams
		}
	}
	next["calorie"], next["protein"], next["carbs"], next["fat"] = nutrients["calories"], nutrients["protein"], nutrients["carbs"], nutrients["fat"]
	if _, labelled := totals["water_ml"]; labelled {
		next["waterMl"], next["water_ml"] = nutrients["water_ml"], nutrients["water_ml"]
	} else if _, labelled := totals["waterMl"]; labelled {
		next["waterMl"], next["water_ml"] = nutrients["waterMl"], nutrients["waterMl"]
	}
	return nil
}

// identicalScopedMeasurement is true when the original item declares the very
// same amount and nutrition label, i.e. the user did not touch this food.
func identicalScopedMeasurement(original map[string]any, measurement *foodmeasure.Measurement) bool {
	old, ok := foodmeasure.FromAny(original["measurement"])
	if !ok || old.Unit != measurement.Unit || old.BasisUnit != measurement.BasisUnit ||
		!sameAmount(old.Amount, measurement.Amount) || !sameAmount(old.BasisAmount, measurement.BasisAmount) {
		return false
	}
	return sameAmounts(old.NutrientsPerBasis, measurement.NutrientsPerBasis) && sameAmounts(old.UnitConversions, measurement.UnitConversions)
}

func sameAmount(a, b float64) bool { return math.Abs(a-b) < 0.0001 }

func sameAmounts[K comparable](a, b map[K]float64) bool {
	if len(a) != len(b) {
		return false
	}
	for key, value := range a {
		if other, ok := b[key]; !ok || !sameAmount(value, other) {
			return false
		}
	}
	return true
}

// measurementFollowingEditedNutrients keeps the label in step with nutrition
// the user typed. The mini program rewrites the label itself when nutrition is
// edited; if a client did not (submitted macros differ from what the label
// yields), the typed values win, otherwise the result page and the recording
// boundary would compute the old values back from the label.
func measurementFollowingEditedNutrients(correction map[string]any, measurement *foodmeasure.Measurement) *foodmeasure.Measurement {
	totals, err := measurement.Totals()
	if err != nil {
		return measurement
	}
	edited := correctionNutrientOverrideValues(correction)
	var changed []string
	for _, key := range []string{"calories", "protein", "carbs", "fat"} {
		value, ok := edited[key]
		if ok && value >= 0 && math.Abs(value-totals[key]) > math.Max(0.011, math.Abs(totals[key])*0.001) {
			changed = append(changed, key)
		}
	}
	if len(changed) == 0 {
		return measurement
	}
	nutrients := make(map[string]any, len(edited))
	for key, value := range edited {
		nutrients[key] = value
	}
	holder := map[string]any{"measurement": measurement.Map()}
	rewriteCorrectionMeasurementNutrients(holder, nutrients, changed...)
	if rewritten, ok := foodmeasure.FromAny(holder["measurement"]); ok {
		return rewritten
	}
	return measurement
}

func scopedMeasurementChanged(old, current map[string]any) bool {
	before, hadBefore := foodmeasure.FromAny(old["measurement"])
	after, hasAfter := foodmeasure.FromAny(current["measurement"])
	if hadBefore != hasAfter {
		return true
	}
	return hasAfter && (before.Unit != after.Unit || math.Abs(before.Amount-after.Amount) > 0.0001)
}

// nativeCorrectionMeasurement returns the row's declared measurement when it
// counts millilitres, pieces or servings rather than grams.
func nativeCorrectionMeasurement(item map[string]any) (*foodmeasure.Measurement, bool) {
	measurement, ok := foodmeasure.FromAny(item["measurement"])
	if !ok || measurement.Unit == foodmeasure.Gram {
		return nil, false
	}
	return measurement, true
}

// correctionAmountLabel names a row's current amount for the re-estimate prompt.
func correctionAmountLabel(item map[string]any) string {
	if measurement, ok := nativeCorrectionMeasurement(item); ok {
		return strconv.FormatFloat(round2(measurement.Amount), 'f', -1, 64) + measurement.Unit.Label()
	}
	weight, _ := firstPositiveFloat(item, "weight", "estimatedWeightGrams")
	return fmt.Sprintf("%.0fg", weight)
}

// correctionAmountChange returns the new and old amount of the same food in
// one unit, for scaling values that are carried over from the original item.
func correctionAmountChange(item, original map[string]any) (float64, float64, bool) {
	if next, ok := nativeCorrectionMeasurement(item); ok {
		if old, ok := nativeCorrectionMeasurement(original); ok && old.Unit == next.Unit {
			return next.Amount, old.Amount, true
		}
	}
	weight, _ := firstPositiveFloat(item, "weight", "estimatedWeightGrams")
	oldWeight, _ := firstPositiveFloat(original, "estimatedWeightGrams", "weight")
	return weight, oldWeight, weight > 0 && oldWeight > 0
}

// rewriteCorrectionMeasurementNutrients moves re-estimated totals back onto the
// item's nutrition label. Without it the result page and the recording
// boundary would recompute the old values from the measurement. With keys it
// rewrites only those nutrients; otherwise the label becomes exactly nutrients.
func rewriteCorrectionMeasurementNutrients(item map[string]any, nutrients map[string]any, keys ...string) {
	measurement, ok := foodmeasure.FromAny(item["measurement"])
	if !ok {
		return
	}
	quantity, ok := measurement.Convert(measurement.Amount, measurement.Unit, measurement.BasisUnit)
	if !ok || quantity <= 0 {
		return
	}
	perBasis := map[string]float64{}
	if len(keys) > 0 {
		for key, value := range measurement.NutrientsPerBasis {
			perBasis[key] = value
		}
	} else {
		for key := range nutrients {
			keys = append(keys, key)
		}
	}
	for _, key := range keys {
		if value, ok := floatFromAny(nutrients[key]); ok && value >= 0 && !math.IsNaN(value) && !math.IsInf(value, 0) {
			perBasis[key] = value * measurement.BasisAmount / quantity
		}
	}
	if len(perBasis) == 0 {
		return
	}
	measurement.NutrientsPerBasis = perBasis
	item["measurement"] = measurement.Map()
}
