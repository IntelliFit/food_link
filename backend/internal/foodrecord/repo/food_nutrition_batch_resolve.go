package repo

import (
	"context"
	"sort"
	"strings"

	"food_link/backend/internal/foodrecord/domain"
)

// ResolveFoods resolves many names with exactly the rules of ResolveFood
// (canonical before alias, first row per variant by id, the same eligibility
// and safety gates) in three queries. A meal's library pass then costs a fixed
// number of round trips instead of several per name and spelling variant.
func (r *FoodNutritionRepo) ResolveFoods(ctx context.Context, names []string) (map[string]*ResolveResult, error) {
	type pendingName struct {
		raw      string
		variants []nutritionQueryVariant
	}
	out := map[string]*ResolveResult{}
	pending := []pendingName{}
	texts, normalized := []string{}, []string{}
	seenText, seenNormalized := map[string]bool{}, map[string]bool{}
	for _, name := range names {
		raw := strings.TrimSpace(name)
		if raw == "" || out[raw] != nil {
			continue
		}
		out[raw] = &ResolveResult{Status: "unresolved", Score: 0}
		variants := nutritionExactQueryVariants(raw)
		pending = append(pending, pendingName{raw: raw, variants: variants})
		for _, variant := range variants {
			if text := strings.ToLower(variant.Text); !seenText[text] {
				seenText[text] = true
				texts = append(texts, text)
			}
			if !seenNormalized[variant.Normalized] {
				seenNormalized[variant.Normalized] = true
				normalized = append(normalized, variant.Normalized)
			}
		}
	}
	if len(pending) == 0 {
		return out, nil
	}

	var foods []domain.FoodNutrition
	if err := r.db.WithContext(ctx).
		Where("is_active = ? AND (LOWER(canonical_name) IN ? OR normalized_name IN ?)", true, texts, normalized).
		Find(&foods).Error; err != nil {
		return nil, err
	}
	var aliases []domain.FoodNutritionAlias
	if err := r.db.WithContext(ctx).
		Where("LOWER(alias_name) IN ? OR normalized_alias IN ?", texts, normalized).
		Find(&aliases).Error; err != nil {
		return nil, err
	}
	aliasFoods := map[string]domain.FoodNutrition{}
	aliasFoodIDs := []string{}
	for _, alias := range aliases {
		if alias.FoodID != "" && domain.IsApprovedExactNutritionAlias(alias.MatchStatus) {
			aliasFoodIDs = append(aliasFoodIDs, alias.FoodID)
		}
	}
	if len(aliasFoodIDs) > 0 {
		var rows []domain.FoodNutrition
		if err := r.db.WithContext(ctx).Where("is_active = ? AND id IN ?", true, aliasFoodIDs).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			aliasFoods[row.ID] = row
		}
	}
	// ResolveFood takes the first row by primary key for each variant.
	sort.SliceStable(foods, func(i, j int) bool { return foods[i].ID < foods[j].ID })
	sort.SliceStable(aliases, func(i, j int) bool { return aliases[i].ID < aliases[j].ID })

	for _, entry := range pending {
		out[entry.raw] = resolveFromPrefetched(entry.raw, entry.variants, foods, aliases, aliasFoods)
	}
	return out, nil
}

func resolveFromPrefetched(raw string, variants []nutritionQueryVariant, foods []domain.FoodNutrition, aliases []domain.FoodNutritionAlias, aliasFoods map[string]domain.FoodNutrition) *ResolveResult {
	for _, variant := range variants {
		lower := strings.ToLower(variant.Text)
		for _, food := range foods {
			if strings.ToLower(food.CanonicalName) != lower && food.NormalizedName != variant.Normalized {
				continue
			}
			if isAutoMatchEligibleNutritionFood(food) && !isImplausibleNutritionFoodMatch(raw, food) {
				matched := food
				return &ResolveResult{Food: &matched, Status: "exact_canonical", MatchSource: variant.matchSource("canonical"), Score: 1}
			}
			break
		}
	}
	for _, variant := range variants {
		lower := strings.ToLower(variant.Text)
		for _, alias := range aliases {
			if strings.ToLower(alias.AliasName) != lower && alias.NormalizedAlias != variant.Normalized {
				continue
			}
			if alias.FoodID != "" && domain.IsApprovedExactNutritionAlias(alias.MatchStatus) {
				if food, ok := aliasFoods[alias.FoodID]; ok && isAutoMatchEligibleNutritionFood(food) && !isUnsafeNutritionAliasMatch(raw, alias.AliasName, food.CanonicalName) && !isImplausibleNutritionFoodMatch(raw, food) {
					matched := food
					return &ResolveResult{Food: &matched, Status: "exact_alias", MatchSource: variant.matchSource("alias"), Score: 1}
				}
			}
			break
		}
	}
	return &ResolveResult{Status: "unresolved", Score: 0}
}

// ListPackagedBrands returns the distinct brands of active packaged products,
// used to recognise a brand inside a free-text food name.
func (r *FoodNutritionRepo) ListPackagedBrands(ctx context.Context) ([]string, error) {
	var brands []string
	err := activePackagedFoodScope(r.db.WithContext(ctx).Model(&domain.PackagedFood{})).
		Where("is_active = ? AND COALESCE(brand, '') <> ''", true).
		Distinct("brand").
		Pluck("brand", &brands).Error
	return brands, err
}
