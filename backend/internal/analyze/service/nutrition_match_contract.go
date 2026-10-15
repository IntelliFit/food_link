package service

import (
	"context"
	"log/slog"
	"strings"

	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
	"food_link/backend/pkg/logger"
)

// A name match is only a candidate. Every nutrition engine must enforce the
// same state/portion contract before replacing a contextual estimate.
func nutritionReuseRejection(item map[string]any, food *foodrecorddomain.FoodNutrition) string {
	if food == nil {
		return "missing_food"
	}
	if strings.Contains(food.Source, "历史识别记录营养均值") && food.QualityReviewedAt == nil {
		return "unreviewed_historical_average"
	}
	state := normalizeFoodStateToken(firstNonEmptyString(stringFromAny(firstNonNil(item["foodState"], item["food_state"])), stringFromAny(item["name"])))
	if state == "" {
		return "unknown_item_food_state"
	}
	foodState := normalizeFoodStateToken(food.FoodState)
	evidence := nutritionItemEvidence(item)
	if state == "cooked" {
		switch nutritionPreparation(evidence) {
		case "roasted":
			state = "baked"
		case "deep_fried":
			state = "fried"
		}
	}
	basis := normalizeWeightBasisToken(stringFromAny(firstNonNil(item["weightBasis"], item["weight_basis"])))
	if basis == "" {
		return "unknown_item_weight_basis"
	}
	foodBasis := normalizeWeightBasisToken(food.WeightBasis)
	dryEquivalent := basis == "dry" && foodBasis == "dry" && (state == "raw" || state == "dry") && (foodState == "raw" || foodState == "dry")
	if state != "" && foodState != state && !dryEquivalent {
		if foodState == "" {
			return "unknown_food_state"
		}
		return "food_state_conflict"
	}
	if basis != "" {
		if foodBasis == "" {
			return "unknown_weight_basis"
		}
		if nutritionComparableBasis(basis, state) != nutritionComparableBasis(foodBasis, foodState) {
			return "weight_basis_conflict"
		}
	}
	foodEvidence := strings.Join(append([]string{food.CanonicalName, food.PreparationMethod}, food.StateTags...), " ")
	if strings.HasSuffix(food.WeightBasis, "_edible") {
		foodEvidence += " boneless"
	}
	for _, dimension := range []struct {
		name string
		read func(string) string
	}{
		{"skin", nutritionSkinState},
		{"bone", nutritionBoneState},
		{"preparation", nutritionPreparation},
	} {
		requested := dimension.read(evidence)
		if requested == "" {
			continue
		}
		actual := dimension.read(foodEvidence)
		if actual == "" {
			return "unknown_" + dimension.name
		}
		if requested != actual {
			return dimension.name + "_conflict"
		}
	}
	return ""
}

func nutritionComparableBasis(basis, state string) string {
	if basis == "as_served" {
		switch state {
		case "raw":
			return "raw"
		case "cooked", "fried", "baked":
			return "cooked"
		}
	}
	return basis
}

func nutritionItemEvidence(item map[string]any) string {
	parts := make([]string, 0, 10)
	for _, key := range []string{"name", "foodState", "food_state", "weightBasis", "weight_basis", "item_hint", "basisEvidence", "basis_evidence", "recognitionEvidence", "weightEvidence", "ediblePortionReason", "skinState", "boneState", "preparationMethod"} {
		if value := stringFromAny(item[key]); value != "" {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, " ")
}

func nutritionSkinState(text string) string {
	text = strings.ToLower(text)
	text = strings.NewReplacer("不去皮", "with_skin", "未去皮", "with_skin", "不用去皮", "with_skin", "保留皮", "with_skin").Replace(text)
	if containsAnyAnalyzeText(text, []string{"去皮", "不吃皮", "不准备吃皮", "不含皮", "皮不吃", "皮去掉", "去掉皮", "无皮", "剥皮", "skinless", "skin_removed"}) {
		return "skinless"
	}
	if containsAnyAnalyzeText(text, []string{"带皮", "含皮", "连皮", "with_skin", "skin_on"}) {
		return "with_skin"
	}
	return ""
}

func nutritionBoneState(text string) string {
	text = strings.ToLower(text)
	text = strings.NewReplacer("不去骨", "bone_in", "未去骨", "bone_in", "不用去骨", "bone_in").Replace(text)
	if containsAnyAnalyzeText(text, []string{"去骨", "不含骨", "不吃骨", "不含皮与骨", "不含皮和骨", "无骨", "净肉", "boneless", "bone_removed"}) {
		return "boneless"
	}
	if containsAnyAnalyzeText(text, []string{"带骨", "含骨", "连骨", "bone_in"}) {
		return "bone_in"
	}
	return ""
}

func nutritionPreparation(text string) string {
	text = strings.ToLower(text)
	for _, method := range []struct {
		name  string
		words []string
	}{
		{"air_dried", []string{"空气炸锅烘干", "air_dried"}},
		{"deep_fried", []string{"油炸", "炸制", "deep_fried"}},
		{"braised", []string{"卤", "红烧", "braised"}},
		{"roasted", []string{"烤", "roasted", "baked"}},
		{"steamed", []string{"清蒸", "蒸熟", "steamed"}},
		{"boiled", []string{"水煮", "煮熟", "boiled"}},
	} {
		if containsAnyAnalyzeText(text, method.words) {
			return method.name
		}
	}
	return ""
}

func rejectNutritionReuse(ctx context.Context, item map[string]any, food *foodrecorddomain.FoodNutrition, reason string) {
	item["nutrition_match_status"] = "rejected"
	item["nutrition_match_reason"] = reason
	foodID := ""
	if food != nil {
		foodID = food.ID
	}
	logger.Warn(ctx, "营养库候选与食物状态或可食口径不符，拒绝复用",
		slog.String("food_id", foodID), slog.String("reason", reason))
}

func compatibleNutritionCandidates(ctx context.Context, item map[string]any, rows []foodrecordrepo.SearchCandidate) []foodrecordrepo.SearchCandidate {
	out := make([]foodrecordrepo.SearchCandidate, 0, len(rows))
	for _, row := range rows {
		if reason := nutritionReuseRejection(item, &row.Food); reason != "" {
			rejectNutritionReuse(ctx, item, &row.Food, reason)
			continue
		}
		out = append(out, row)
	}
	return out
}

func (s *AnalyzeService) searchNutritionCandidates(ctx context.Context, item map[string]any, query string, limit int) ([]foodrecordrepo.SearchCandidate, error) {
	if resolver, ok := s.nutrition.(interface {
		SearchCandidatesForState(context.Context, string, foodrecorddomain.NutritionStateQuery, int) ([]foodrecordrepo.SearchCandidate, error)
	}); ok {
		evidence := nutritionItemEvidence(item)
		return resolver.SearchCandidatesForState(ctx, query, foodrecorddomain.NutritionStateQuery{FoodState: normalizeFoodStateToken(stringFromAny(firstNonNil(item["foodState"], item["food_state"]))), WeightBasis: normalizeWeightBasisToken(stringFromAny(firstNonNil(item["weightBasis"], item["weight_basis"]))), SkinState: nutritionSkinState(evidence), BoneState: nutritionBoneState(evidence), Preparation: nutritionPreparation(evidence)}, limit)
	}
	return s.nutrition.SearchCandidates(ctx, query, limit)
}

func nutritionQueryForItem(item map[string]any, queryName, fullContext string) nutritionCandidateQuery {
	return nutritionCandidateQuery{
		QueryName: queryName, OriginalName: stringFromAny(item["name"]),
		FoodState:           stringFromAny(firstNonNil(item["foodState"], item["food_state"])),
		WeightBasis:         stringFromAny(firstNonNil(item["weightBasis"], item["weight_basis"])),
		RecognitionEvidence: stringFromAny(firstNonNil(item["recognitionEvidence"], item["recognition_evidence"])),
		BasisEvidence:       stringFromAny(firstNonNil(item["basisEvidence"], item["basis_evidence"])),
		ItemHint:            stringFromAny(item["item_hint"]), FullContext: fullContext,
	}
}

func nutritionFallbackForItem(index int, item map[string]any, name string) UnresolvedNutritionCandidate {
	return UnresolvedNutritionCandidate{
		Index: index, Name: name, EstimatedWeightGrams: nutritionWeightFromItem(item),
		FoodState:     stringFromAny(firstNonNil(item["foodState"], item["food_state"])),
		WeightBasis:   stringFromAny(firstNonNil(item["weightBasis"], item["weight_basis"])),
		BasisEvidence: nutritionItemEvidence(item),
	}
}
