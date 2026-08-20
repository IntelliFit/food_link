package service

import (
	"context"
	"strings"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
)

// finalizeAIDirectNutrition keeps the model's contextual nutrition estimate and
// only applies deterministic shape/sanity checks. It deliberately does not
// query the standard food library.
func finalizeAIDirectNutrition(resp map[string]any, engine string) map[string]any {
	items := toItems(resp["items"])
	out := make([]map[string]any, 0, len(items))
	for index, item := range items {
		next := copyAnyMap(item)
		weight := nutritionWeightFromItem(next)
		if label := ingredientLabelNutritionFromItem(next); len(label) > 0 && weight > 0 {
			next = buildIngredientLabelOutput(lookupItem{index: index, item: next, name: stringFromAny(next["name"]), weight: weight, ingredientLabel: label})
		} else {
			unit := copyAnyMap(mapFromAny(next["unit_nutrition_per_100g"]))
			nutrients := copyAnyMap(mapFromAny(next["nutrients"]))
			if len(unit) == 0 && weight > 0 {
				unit = nutritionUnitFromTotals(nutrients, weight)
			}
			next["unit_nutrition_per_100g"] = unit
			next["nutrition_source"] = engine
			next["resolve_status"] = engine
			next["resolve_score"] = 0
			next["is_unresolved"] = false
			next["matched_food_id"] = nil
			next["matched_food_name"] = nil
		}
		capItemWaterMlToWeight(next)
		next["nutrition_source_category"] = nutritionSourceCategory(stringFromAny(next["nutrition_source"]))
		out = append(out, next)
	}
	out, sanityMeta := applyNutritionCommonSenseChecks(out)
	out = applyFinalWeightPresentation(out)
	resp["items"] = out
	resp["analysis_engine"] = engine
	resp["resolved_count"] = 0
	resp["unresolved_count"] = 0
	resp["nutrition_library_used"] = false
	if sanityMeta["adjusted_count"].(int) > 0 {
		resp["nutrition_sanity"] = sanityMeta
	}
	return resp
}

func nutritionUnitFromTotals(nutrients map[string]any, weight float64) map[string]any {
	if weight <= 0 {
		return map[string]any{}
	}
	unit := map[string]any{}
	for key, value := range nutrients {
		if _, ok := value.(map[string]any); ok {
			continue
		}
		unit[key] = round4(numberFromAny(value) * 100 / weight)
	}
	return unit
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

func (s *AnalyzeService) applyAIThenExactDBNutrition(ctx context.Context, resp map[string]any, input AnalyzeInput) map[string]any {
	resp = finalizeAIDirectNutrition(resp, analysisEngineAIThenDBExact)
	resp = s.applyAuthoritativePackagedNutrition(ctx, resp)
	if s.nutrition == nil {
		resp["nutrition_library_status"] = "skipped_no_repo"
		return resp
	}
	items := toItems(resp["items"])
	resolved := intFromAny(resp["resolved_count"])
	for index, item := range items {
		if source := stringFromAny(item["nutrition_source"]); source == "ingredient_label" || source == "packaged_food_library" {
			continue
		}
		name := stringFromAny(item["name"])
		query := nutritionResolveName(item, name, fullNutritionContext(input))
		match, err := s.nutrition.ResolveFood(ctx, query)
		if err != nil || match == nil || match.Food == nil || !foodStateCompatible(item, match.Food) {
			items[index]["db_calibration_status"] = "no_compatible_exact_match"
			continue
		}
		items[index] = applyNutritionFoodToItem(item, match.Food, match.Status, match.Score)
		items[index]["db_calibration_status"] = "exact_compatible_match"
		resolved++
	}
	resp["items"] = items
	resp["resolved_count"] = resolved
	resp["nutrition_library_used"] = resolved > 0
	resp["nutrition_library_mode"] = "exact_compatible_calibration"
	return resp
}

func (s *AnalyzeService) applyCandidateGuidedNutrition(ctx context.Context, resp map[string]any, input AnalyzeInput) map[string]any {
	resp = finalizeAIDirectNutrition(resp, analysisEngineDBCandidates)
	resp = s.applyAuthoritativePackagedNutrition(ctx, resp)
	if s.nutrition == nil {
		resp["nutrition_candidate_review"] = map[string]any{"status": "skipped_no_repo", "candidate_groups": 0, "accepted": 0}
		return resp
	}
	items := toItems(resp["items"])
	queries := map[int]nutritionCandidateQuery{}
	candidateGroups := map[int][]foodrecordrepo.SearchCandidate{}
	fullContext := fullNutritionContext(input)
	for index, item := range items {
		if source := stringFromAny(item["nutrition_source"]); source == "ingredient_label" || source == "packaged_food_library" {
			continue
		}
		name := stringFromAny(item["name"])
		queryName := nutritionResolveName(item, name, fullContext)
		rows, _ := s.nutrition.SearchCandidates(ctx, queryName, resolveFoodCandidateLimit)
		if exact, err := s.nutrition.ResolveFood(ctx, queryName); err == nil && exact != nil && exact.Food != nil {
			rows = prependUniqueNutritionCandidate(rows, foodrecordrepo.SearchCandidate{Food: *exact.Food, MatchSource: exact.MatchSource, Score: exact.Score})
		}
		if len(rows) == 0 {
			items[index]["candidate_review_status"] = "no_candidates_ai_kept"
			continue
		}
		if len(rows) > resolveFoodCandidateLimit {
			rows = rows[:resolveFoodCandidateLimit]
		}
		candidateGroups[index] = rows
		queries[index] = nutritionCandidateQuery{
			QueryName:           queryName,
			OriginalName:        name,
			FoodState:           stringFromAny(firstNonNil(item["foodState"], item["food_state"])),
			WeightBasis:         stringFromAny(firstNonNil(item["weightBasis"], item["weight_basis"])),
			RecognitionEvidence: stringFromAny(firstNonNil(item["recognitionEvidence"], item["recognition_evidence"])),
			FullContext:         fullContext,
		}
	}
	decisions, err := s.rerankNutritionCandidatesWithAI(ctx, queries, candidateGroups)
	accepted := 0
	for index, rows := range candidateGroups {
		decision := decisions[index]
		if err != nil || !isStrictNutritionReuseDecision(decision) || decision.SelectedCandidateIndex < 0 || decision.SelectedCandidateIndex >= len(rows) {
			items[index]["candidate_review_status"] = "rejected_ai_kept"
			if decision != nil && decision.Reason != "" {
				items[index]["candidate_review_reason"] = decision.Reason
			}
			continue
		}
		selected := rows[decision.SelectedCandidateIndex]
		if !foodStateCompatible(items[index], &selected.Food) {
			items[index]["candidate_review_status"] = "state_conflict_ai_kept"
			continue
		}
		items[index] = applyNutritionFoodToItem(items[index], &selected.Food, "candidate_ai_verified", decision.Confidence)
		items[index]["candidate_review_status"] = "accepted"
		items[index]["candidate_review_reason"] = decision.Reason
		accepted++
	}
	resp["items"] = items
	resp["resolved_count"] = intFromAny(resp["resolved_count"]) + accepted
	resp["nutrition_library_used"] = boolFromAny(resp["nutrition_library_used"]) || accepted > 0
	resp["nutrition_library_mode"] = "candidate_injected_ai_review"
	status := "completed"
	if err != nil {
		status = "review_failed_ai_kept"
	}
	resp["nutrition_candidate_review"] = map[string]any{
		"status": status, "candidate_groups": len(candidateGroups), "accepted": accepted, "rejected": len(candidateGroups) - accepted,
	}
	return resp
}

func (s *AnalyzeService) applyAuthoritativePackagedNutrition(ctx context.Context, resp map[string]any) map[string]any {
	if s.nutrition == nil {
		return resp
	}
	items := toItems(resp["items"])
	matched := 0
	triggered := 0
	weightApplied := 0
	fallback := 0
	for index, item := range items {
		if stringFromAny(item["nutrition_source"]) == "ingredient_label" || !shouldResolvePackagedFoodForDBFirst(item, true) {
			continue
		}
		triggered++
		query := packagedFoodResolveQuery(item)
		weight := nutritionWeightFromItem(item)
		resolveWeight := 0.0
		if hasStrongPackagedExperimentEvidence(item, "") {
			resolveWeight = weight
		}
		resolved, err := s.nutrition.ResolvePackagedFood(ctx, foodrecordrepo.PackagedFoodResolveInput{
			Name: query, Brand: stringFromAny(item["brand"]),
			FlavorText: stringFromAny(firstNonNil(item["flavorText"], item["flavor_text"], item["flavor"])),
			SpecText:   stringFromAny(firstNonNil(item["specText"], item["spec_text"], item["packageSpec"])),
			NetWeightG: resolveWeight,
			Barcode:    stringFromAny(firstNonNil(item["barcode"], item["ean"], item["gtin"])),
		})
		if err != nil || resolved == nil || resolved.Food == nil {
			items[index]["package_match_status"] = "not_found_ai_kept"
			fallback++
			continue
		}
		candidates := searchPackagedExperimentCandidates(ctx, s.nutrition, query, resolved.Food)
		resolvedWeight, weightMeta := packagedExperimentWeightForItem(item, resolved.Food, candidates, resolved.Status, weight, true, s.storage)
		if packagedCandidateNeedsConfirmation(weightMeta) {
			items[index]["package_match_status"] = "needs_confirmation_ai_kept"
			fallback++
			continue
		}
		next := copyAnyMap(item)
		for key, value := range weightMeta {
			next[key] = value
		}
		unit := packagedNutritionUnit(resolved.Food)
		next["type"] = "snack"
		next["matched_food_id"] = resolved.Food.ID
		next["packaged_food_id"] = resolved.Food.ID
		next["matched_food_name"] = packagedFoodDisplayName(resolved.Food)
		next["standardized_food_name"] = packagedFoodDisplayName(resolved.Food)
		next["resolve_status"] = resolved.Status
		next["resolve_score"] = resolved.Score
		next["nutrition_source"] = "packaged_food_library"
		next["nutrition_source_category"] = "database"
		next["unit_nutrition_per_100g"] = unit
		next["nutrients"] = scaleNutrition(unit, resolvedWeight)
		next["estimatedWeightGrams"] = resolvedWeight
		next["originalWeightGrams"] = resolvedWeight
		ensureGrossWeightField(next, resolvedWeight)
		items[index] = next
		matched++
		if boolFromAny(weightMeta["package_weight_applied"]) {
			weightApplied++
		}
	}
	resp["items"] = items
	if triggered > 0 {
		resp["packaged_food_resolution"] = map[string]any{
			"enabled": true, "triggered_count": triggered, "matched_count": matched,
			"weight_applied_count": weightApplied, "fallback_count": fallback, "mode": "authoritative_exception",
		}
	}
	if matched > 0 {
		resp["resolved_count"] = intFromAny(resp["resolved_count"]) + matched
		resp["nutrition_library_used"] = true
	}
	return resp
}

func fullNutritionContext(input AnalyzeInput) string {
	textInput := strings.TrimSpace(input.Text)
	additionalContext := strings.TrimSpace(input.AdditionalContext)
	if textInput == "" {
		return additionalContext
	}
	parts := []string{}
	parts = append(parts, "用户完整输入："+textInput)
	if additionalContext != "" {
		parts = append(parts, "用户补充信息："+additionalContext)
	}
	return strings.Join(parts, "\n")
}

func prependUniqueNutritionCandidate(rows []foodrecordrepo.SearchCandidate, exact foodrecordrepo.SearchCandidate) []foodrecordrepo.SearchCandidate {
	out := []foodrecordrepo.SearchCandidate{exact}
	for _, row := range rows {
		if row.Food.ID != "" && row.Food.ID == exact.Food.ID {
			continue
		}
		out = append(out, row)
	}
	return out
}

func foodStateCompatible(item map[string]any, food *foodrecorddomain.FoodNutrition) bool {
	if food == nil {
		return false
	}
	itemState := normalizeFoodStateToken(firstNonEmptyString(
		stringFromAny(firstNonNil(item["foodState"], item["food_state"])),
		stringFromAny(item["name"]),
	))
	foodState := normalizeFoodStateToken(firstNonEmptyString(food.FoodState, food.CanonicalName))
	if itemState == "" {
		return true
	}
	if foodState == "" {
		return false
	}
	return itemState == foodState
}

func normalizeFoodStateToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch {
	case value == "dehydrated" || strings.Contains(value, "脱水") || strings.Contains(value, "烘干") || strings.Contains(value, "风干") || strings.Contains(value, "干制"):
		return "dehydrated"
	case value == "hydrated" || strings.Contains(value, "泡发") || strings.Contains(value, "复水"):
		return "hydrated"
	case value == "fried" || strings.Contains(value, "油炸") || strings.Contains(value, "炸制") || strings.Contains(value, "薯条"):
		return "fried"
	case value == "cooked" || strings.Contains(value, "水煮") || strings.Contains(value, "煮熟") || strings.Contains(value, "熟制") || strings.Contains(value, "熟"):
		return "cooked"
	case value == "baked" || strings.Contains(value, "烤") || strings.Contains(value, "焙"):
		return "baked"
	case value == "raw" || value == "fresh" || strings.Contains(value, "生") || strings.Contains(value, "raw"):
		return "raw"
	case value == "dry" || strings.Contains(value, "干") || strings.Contains(value, "dry"):
		return "dry"
	case value == "liquid" || strings.Contains(value, "液体") || strings.Contains(value, "饮料"):
		return "liquid"
	case value == "packaged" || strings.Contains(value, "预包装"):
		return "packaged"
	}
	return ""
}

func applyNutritionFoodToItem(item map[string]any, food *foodrecorddomain.FoodNutrition, status string, score float64) map[string]any {
	next := copyAnyMap(item)
	weight := nutritionWeightFromItem(next)
	unit := nutritionUnit(food)
	next["matched_food_id"] = food.ID
	next["matched_food_name"] = food.CanonicalName
	next["standardized_food_name"] = food.CanonicalName
	next["resolve_status"] = status
	next["resolve_score"] = score
	next["is_unresolved"] = false
	next["nutrition_source"] = nutritionSource(status)
	next["nutrition_source_category"] = "database"
	next["unit_nutrition_per_100g"] = unit
	next["nutrients"] = scaleNutrition(unit, weight)
	next["estimatedWeightGrams"] = weight
	next["originalWeightGrams"] = weight
	next["matched_food_state"] = food.FoodState
	next["matched_weight_basis"] = food.WeightBasis
	next["matched_preparation_method"] = food.PreparationMethod
	ensureGrossWeightField(next, weight)
	return next
}
