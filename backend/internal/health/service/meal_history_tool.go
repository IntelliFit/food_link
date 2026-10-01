package service

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

// History and catalog candidates share the selection contract, but not their
// availability: an old meal is evidence of eating, never of a nearby seller.
func searchMealHistoryTool(state *campusDietAgentRunState, raw string) (map[string]any, error) {
	if !state.MealContextLoaded {
		return nil, fmt.Errorf("请先读取get_meal_context")
	}
	var args struct {
		Keyword string `json:"keyword"`
		Offset  int    `json:"offset"`
	}
	if err := json.Unmarshal([]byte(defaultIfEmpty(raw, "{}")), &args); err != nil {
		return nil, err
	}
	pool := mealHistoryCandidates(state)
	excluded := map[string]bool{}
	if state.Intent == "more" {
		for _, c := range pool {
			if slices.Contains(state.ExcludedSourceIDs, c.SourceID) {
				excluded[mealFingerprint(c)] = true
			}
		}
	}
	choices := []DietRecommendationCandidate{}
	seen := map[string]bool{}
	for _, c := range mealHarnessRank(state, pool) {
		key := mealFingerprint(c)
		if seen[key] || excluded[key] || args.Keyword != "" && !strings.Contains(normalizedDietDecisionCandidateText(c), normalizeDietDecisionToken(args.Keyword)) {
			continue
		}
		seen[key] = true
		choices = append(choices, c)
	}
	state.SearchAttempted = true
	total := len(choices)
	start := max(0, min(args.Offset, total))
	choices = choices[start:min(start+campusDietAgentSearchLimit, total)]
	if state.Candidates == nil {
		state.Candidates = map[string]DietRecommendationCandidate{}
	}
	for _, c := range choices {
		state.Candidates[c.SourceID] = c
	}
	state.LastSearch = mergeCampusDietCandidates(choices, state.LastSearch, campusDietAgentSearchLimit)
	state.SearchTotal += int64(total)
	return map[string]any{"total_matches": total, "returned": len(choices), "candidates": campusDietAgentToolCandidates(choices, true, state), "note": "仅证明本人当日记录过；份量是当次实际摄入量，不证明现在附近有售。需要具体日期时读description。"}, nil
}

func mealHistoryCandidates(state *campusDietAgentRunState) []DietRecommendationCandidate {
	pool := []DietRecommendationCandidate{}
	for _, record := range state.HistoryRecords {
		if record.UserID != state.UserID || record.RecordTime == nil || record.RecordTime.After(time.Now()) {
			continue
		}
		if c, ok := mealFromHistory(record); ok {
			c.Description = "本人饮食记录，日期：" + record.RecordTime.In(chinaTZ).Format("2006-01-02") + "，餐次：" + record.MealType
			pool = append(pool, c)
		}
	}
	return pool
}

func normalizeMealEvidence(c DietRecommendationCandidate) DietRecommendationCandidate {
	if c.Calories <= 0 {
		c.NutritionBasis = "unavailable"
		for i := range c.Items {
			if c.Items[i].Amount == "1份" {
				c.Items[i].Amount = "份量待确认"
			}
		}
	}
	return c
}

func mealHasEvidenceStructure(c DietRecommendationCandidate) bool {
	return mealHasStructure(c) || c.Source != "food_record" && c.NutritionBasis == "unavailable" && mealHasNamedStructure(c)
}

func decorateMealSource(state *campusDietAgentRunState, c DietRecommendationCandidate, option *DietRecommendationOption) {
	option.SourceLabel = strings.Join(compactDietStrings(c.MerchantName, c.CanteenName), " · ")
	if c.Source != "food_record" {
		return
	}
	for _, record := range state.HistoryRecords {
		if record.ID == c.SourceID && record.UserID == state.UserID && record.RecordTime != nil {
			option.HistoryDate = record.RecordTime.In(chinaTZ).Format("2006-01-02")
			option.SourceLabel = "吃过 · " + option.HistoryDate
			return
		}
	}
}

func homeSelectedMealID(state *campusDietAgentRunState) string {
	if state.EntryContext == nil {
		return ""
	}
	if id := state.EntryContext.SelectedSourceID; regexp.MustCompile(`^[a-fA-F0-9-]{36}$`).MatchString(id) {
		return id
	}
	match := regexp.MustCompile(`餐食ID[：:]\s*([a-fA-F0-9-]{36})`).FindStringSubmatch(state.Question)
	if len(match) > 1 {
		return match[1]
	}
	return ""
}

func mealRequestsNearbyOnly(q string) bool {
	return regexp.MustCompile(`附近|身边|周围`).MatchString(q) && !regexp.MustCompile(`综合|结合.*历史|历史.*都|附近.*历史.*(?:都|各)|历史.*附近.*(?:都|各)`).MatchString(q)
}
