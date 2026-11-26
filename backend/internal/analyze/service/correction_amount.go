package service

import "food_link/backend/internal/foodmeasure"

// 食物库里的饮品、按个或按份的食物带有声明的计量信息（measurement），数量按毫升、个或份计，
// 没有换算关系时克数为 0。纠错各步骤读写“这道菜有多少”时统一走下面两个函数，
// 不能把这类数量当作克数，也不能因为克数为 0 判定条目无效。

// CorrectionItemAmount reports how much of a correction row there is, in the
// unit the user sees: the declared amount for rows measured in millilitres,
// pieces or servings, grams for every other row.
func CorrectionItemAmount(item map[string]any) (float64, foodmeasure.Unit) {
	if measurement, ok := foodmeasure.FromAny(item["measurement"]); ok && measurement.Unit != foodmeasure.Gram {
		return measurement.Amount, measurement.Unit
	}
	return correctionItemWeight(item), foodmeasure.Gram
}

// SetCorrectionItemAmount writes a new amount, in the unit CorrectionItemAmount
// reports, onto item (which must be a private copy). The declared measurement
// and the gram fields stay consistent: grams hold real mass only, so a volume
// or count without a conversion leaves them at 0.
func SetCorrectionItemAmount(item map[string]any, amount float64) {
	measurement, ok := foodmeasure.FromAny(item["measurement"])
	if !ok {
		item["weight"], item["estimatedWeightGrams"] = amount, amount
		return
	}
	measurement.Amount = amount
	grams, _ := measurement.Grams()
	item["measurement"] = measurement.Map()
	item["weight"], item["estimatedWeightGrams"] = grams, grams
}

// measuredWithoutMass is true for a row whose declared measurement cannot be
// expressed in grams, so mass-based nutrition bounds do not apply to it.
func measuredWithoutMass(item map[string]any) bool {
	measurement, ok := foodmeasure.FromAny(item["measurement"])
	if !ok {
		return false
	}
	_, known := measurement.Grams()
	return !known
}
