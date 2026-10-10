package service

import (
	"context"
	"fmt"
	"food_link/backend/internal/health/domain"
	"math"
	"strings"
)

func roundedMealLocation(location *domain.DietLocation) string {
	return fmt.Sprintf("%.3f,%.3f", location.Latitude, location.Longitude)
}

// This is a menu variety heuristic, not a nutrient measurement or CHEI score.
func mealCandidateFamily(c DietRecommendationCandidate) string {
	title := strings.ReplaceAll(strings.ToLower(c.Title), "鱼香", "")
	staple := "other"
	for _, group := range []struct {
		key   string
		words []string
	}{
		{"hotpot", []string{"火锅", "麻辣烫", "冒菜"}}, {"dumplings", []string{"水饺", "蒸饺", "馄饨", "抄手"}},
		{"bread", []string{"面包", "包子", "馒头", "饼", "汉堡", "三明治", "菜包", "肉包"}},
		{"noodles", []string{"面", "米粉", "河粉", "粉丝"}}, {"rice", []string{"饭"}},
	} {
		if containsAnyText(title, group.words...) {
			staple = group.key
			break
		}
	}
	protein := "mixed"
	for _, group := range []struct {
		key   string
		words []string
	}{
		{"fish", []string{"鱼", "虾"}}, {"beef", []string{"牛肉", "肥牛"}}, {"chicken", []string{"鸡肉", "鸡腿", "鸡胸", "鸡排", "宫保鸡", "黄焖鸡"}},
		{"pork", []string{"猪肉", "排骨", "叉烧", "卤肉", "红烧肉"}}, {"soy", []string{"豆腐", "豆干", "腐竹", "豆皮"}}, {"egg", []string{"鸡蛋", "卤蛋", "蛋炒", "蛋饼"}},
	} {
		if containsAnyText(title, group.words...) {
			protein = group.key
			break
		}
	}
	if staple == "other" && protein == "mixed" {
		return ""
	}
	return staple + ":" + protein
}

func (s *StatsService) retrievePreviewCandidates(ctx context.Context, state *campusDietAgentRunState, f domain.CampusDietSearchFilter) ([]DietRecommendationCandidate, int64, error) {
	f.IncludeMenuEvidence = true
	f.ScanCatalog, f.Offset, f.Limit, f.AfterID = true, 0, 100, ""
	if f.RadiusKM <= 0 {
		f.RadiusKM = 5
	}
	var all []DietRecommendationCandidate
	var total int64
	seen := map[string]bool{}
	coverage := MealCatalogCoverage{School: domain.DietRecommendationSchool{ID: f.SchoolID}, Scope: "school", Status: "complete"}
	if f.Location != nil {
		coverage.Scope, coverage.RadiusKM = "nearby", f.RadiusKM
	}
	defer func() {
		coverage.Total, coverage.Retrieved = total, len(all)
		state.CatalogCoverage = append(state.CatalogCoverage, coverage)
	}()
	for {
		if err := ctx.Err(); err != nil {
			coverage.Status = "partial_timeout"
			return all, total, err
		}
		rows, count, err := s.repo.SearchCampusDietCandidates(ctx, f)
		if err != nil {
			coverage.Status = "partial_error"
			return all, total, err
		}
		total = count
		added := 0
		for _, row := range rows {
			if !seen[row.SourceID] {
				seen[row.SourceID] = true
				all = append(all, row)
				added++
			}
			if row.SourceID > f.AfterID {
				f.AfterID = row.SourceID
			}
		}
		if len(all) >= int(total) {
			break
		}
		if added == 0 || len(rows) < f.Limit {
			coverage.Status = "partial_catalog_changed"
			return all, total, fmt.Errorf("目录扫描未完整：已读取%d/%d条", len(all), total)
		}
	}
	return all, total, nil
}

func mealPreviewMemoryEffect(state *campusDietAgentRunState, c DietRecommendationCandidate) (float64, bool) {
	key := mealDecisionHash(c.Source, c.SourceID)
	fingerprint := mealDecisionHash(mealFingerprint(c))
	days := map[string]bool{}
	familyDays := map[string]bool{}
	family := mealCandidateFamily(c)
	for _, memory := range state.PreviewMemory {
		if family != "" && memory.Family == family && memory.ShownAt != nil && memory.ContextKey != state.PreviewContextKey {
			familyDays[memory.MealDate] = true
		}
		if memory.OptionKey != key && memory.Fingerprint != fingerprint {
			continue
		}
		if memory.SkippedAt != nil && memory.MealDate == state.MealContext.Date && memory.MealType == state.MealContext.MealType {
			return 0, true
		}
		// A card seen in this exact state must not make its own next refresh re-roll.
		if memory.ShownAt != nil && memory.ContextKey != state.PreviewContextKey {
			days[memory.MealDate] = true
		}
	}
	return math.Min(18, float64(len(days))*6) + math.Min(6, float64(len(familyDays))*2), false
}

func selectVariedPreviewMeals(eligible []groundedMeal) []groundedMeal {
	if len(eligible) > 0 && eligible[0].evaluation.Scores.Version == dietDecisionEngineVersion {
		return selectHealthBoundedMeals(eligible, 3)
	}
	chosen := []groundedMeal{}
	seen := map[string]bool{}
	for len(chosen) < 3 {
		best := -1
		bestScore := math.Inf(-1)
		for i, meal := range eligible {
			c := meal.candidate
			if seen[mealFingerprint(c)] {
				continue
			}
			// A history option is optional, never a forced third slot. First two are places to eat.
			if c.Source == "food_record" && len(chosen) < 2 {
				continue
			}
			score := meal.score
			for _, prior := range chosen {
				p := prior.candidate
				if c.Source == "food_record" && p.Source == "food_record" {
					score = math.Inf(-1)
					break
				}
				if family := mealCandidateFamily(c); family != "" && family == mealCandidateFamily(p) {
					score -= 14
				}
				venue := strings.Join(compactDietStrings(c.MerchantName, c.SchoolID, c.CanteenName, c.WindowName), ":")
				other := strings.Join(compactDietStrings(p.MerchantName, p.SchoolID, p.CanteenName, p.WindowName), ":")
				if venue != "" && venue == other {
					score -= 8
				}
			}
			better := score > bestScore
			if meal.evaluation.Scores.Version == dietDecisionEngineVersion && best >= 0 {
				better = dietDecisionBetter(meal.evaluation, eligible[best].evaluation, score, bestScore)
			}
			if better {
				best, bestScore = i, score
			}
		}
		if best < 0 {
			// Sparse public data: at most one honest history fallback, never filler to three.
			if len(chosen) < 2 {
				for _, meal := range eligible {
					if meal.candidate.Source == "food_record" && !seen[mealFingerprint(meal.candidate)] {
						return append(chosen, meal)
					}
				}
			}
			break
		}
		chosen = append(chosen, eligible[best])
		seen[mealFingerprint(eligible[best].candidate)] = true
	}
	return chosen
}

const dietMealSelectionPolicyVersion = "foodlink-meal-selection-v3.3"

// This is a versioned engineering tolerance, not clinical equivalence. Anchor
// the shortlist to a fixed maximum each round (no non-transitive pairwise epsilon).
// Hard constraints are applied before this point and are never relaxed for variety.
const mealHealthShortlistTolerance = 5.0

func selectHealthBoundedMeals(eligible []groundedMeal, limit int) []groundedMeal {
	chosen := []groundedMeal{}
	for len(chosen) < limit {
		pool := mealSelectionRound(eligible, chosen)
		if len(pool) == 0 {
			break
		}
		best, bestScore := -1, math.Inf(-1)
		for i, meal := range pool {
			score := meal.score
			for _, prior := range chosen {
				if family := mealCandidateFamily(meal.candidate); family != "" && family == mealCandidateFamily(prior.candidate) {
					score -= 14
				}
				if venue := mealSelectionVenue(meal.candidate); venue != "" && venue == mealSelectionVenue(prior.candidate) {
					score -= 8
				}
			}
			if best < 0 || score > bestScore || score == bestScore && dietDecisionBetter(meal.evaluation, pool[best].evaluation, 0, 0) {
				best, bestScore = i, score
			}
		}
		if best < 0 {
			break
		}
		meal := pool[best]
		chosen = append(chosen, meal)
	}
	return chosen
}

func mealSelectionVenue(c DietRecommendationCandidate) string {
	if c.SchoolID != "" && c.CanteenName != "" {
		name := strings.TrimSpace(c.CanteenName)
		// Sub-restaurants may be separate catalog IDs inside the same named hall.
		// Only explicit suffixes are normalised; no geographic location is invented.
		for _, suffix := range []string{"简约餐厅", "风味餐厅"} {
			if strings.HasSuffix(name, suffix) && len([]rune(name)) > len([]rune(suffix)) {
				name = strings.TrimSuffix(name, suffix)
			}
		}
		return "canteen:" + c.SchoolID + ":" + name
	}
	if c.CanteenID != "" {
		return "canteen:" + c.CanteenID
	}
	if c.MerchantName != "" && c.Address != "" {
		return "merchant:" + c.MerchantName + ":" + c.Address
	}
	return ""
}
