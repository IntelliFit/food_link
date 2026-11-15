package repo

import (
	"encoding/json"
	"strings"

	"food_link/backend/internal/foodmeasure"
	"food_link/backend/internal/utility/domain"
)

// These expressions are used before aggregation. A food's name alone does
// not make gram, volume and count observations comparable.
const frequentRecordUnitSQL = `CASE
 WHEN item->'measurement'->>'unit' IN ('g','ml','piece','serving') THEN item->'measurement'->>'unit'
 WHEN lower(COALESCE(NULLIF(item->>'manual_portion_label', ''), NULLIF(item->>'portion_description', ''), item->>'unit', '')) ~ '(ml|毫升)' THEN 'ml'
 WHEN lower(COALESCE(NULLIF(item->>'manual_portion_label', ''), NULLIF(item->>'portion_description', ''), item->>'unit', '')) ~ '(piece|serving|个|份|支|根|条|片|枚|袋|包|杯|碗)' THEN 'serving'
 ELSE 'g' END`

const frequentRecordQuantitySQL = `CASE
 WHEN item->'measurement'->>'unit' IN ('g','ml','piece','serving')
  AND item->'measurement'->>'amount' ~ '^[0-9]+([.][0-9]+){0,1}$'
 THEN (item->'measurement'->>'amount')::numeric * CASE
  WHEN item->>'ratio' ~ '^[0-9]+([.][0-9]+){0,1}$' AND (item->>'ratio')::numeric <= 100 THEN (item->>'ratio')::numeric/100 ELSE 1 END
 WHEN lower(COALESCE(NULLIF(item->>'manual_portion_label', ''), NULLIF(item->>'portion_description', ''), item->>'unit', '')) ~ '(piece|serving|个|份|支|根|条|片|枚|袋|包|杯|碗)'
  AND lower(COALESCE(NULLIF(item->>'manual_portion_label', ''), NULLIF(item->>'portion_description', ''), item->>'unit', '')) !~ '(ml|毫升)' THEN 1
 ELSE COALESCE(NULLIF(COALESCE(item->>'intake', item->>'weight'), '')::numeric, 100) END`

func measuredFrequentRecordResult(name, unit string, uses int, quantity, calories, protein, carbs, fat float64, raw json.RawMessage) domain.ManualFoodResult {
	if unit == "" || unit == "g" {
		result := manualFoodResultFromFrequentRecord(name, uses, quantity, calories, protein, carbs, fat, raw)
		attachNutritionMeasurement(&result)
		return result
	}
	// Non-mass averages retain their actual unit and totals. In particular,
	// an ml or piece count never becomes DefaultWeightGrams.
	if quantity <= 0 {
		return domain.ManualFoodResult{}
	}
	result := domain.ManualFoodResult{
		ID: "catalog:" + strings.TrimSpace(name) + ":" + unit, Source: "nutrition_library",
		Title: strings.TrimSpace(name), Subtitle: "常用食物", Category: inferManualFoodCategory(name, "nutrition_library"),
		SourceLabel: "常用食物", RecommendReason: "来自真实记录的高频食物", UsageCount: uses, MatchScore: 0.58,
		Measurement: &foodmeasure.Measurement{Amount: quantity, Unit: foodmeasure.Unit(unit), BasisAmount: quantity, BasisUnit: foodmeasure.Unit(unit),
			NutrientsPerBasis: map[string]float64{"calories": calories, "protein": protein, "carbs": carbs, "fat": fat}},
	}
	if !applyMeasuredFoodResult(&result) {
		return domain.ManualFoodResult{}
	}
	return result
}
