package service

import (
	"slices"
	"sort"
	"strings"

	"food_link/backend/internal/health/domain"
	userservice "food_link/backend/internal/user/service"
)

// The user's focus (up to three, saved in health_condition.focus_keys) steers the state:
// the gaps, the next plate, the focus cards and the headline put what they care about
// first. A custom focus is listed but does not reorder anything yet: its label is free
// text with no reliable link to a nutrient.

// nutritionFocusNutrients are the "今天还差什么" rows each focus card is about.
var nutritionFocusNutrients = map[string][]string{
	"hypertension":  {"sodium", "potassium", "vegetables"},
	"diabetes":      {"added_sugar", "fiber"},
	"cardio":        {"sat_fat", "sodium", "fiber"},
	"weight":        {"energy", "protein"},
	"colorectal":    {"fiber", "vegetables"},
	"longevity":     {"vegetables", "protein"},
	"micronutrient": {"calcium", "potassium"},
}

// nutritionFocusTopics are the headline topics (finding key prefixes) each focus is about.
var nutritionFocusTopics = map[string][]string{
	"hypertension": {"sodium", "vegetables"},
	"diabetes":     {"fiber", "late"},
	"cardio":       {"sodium", "fish", "no"},
	"weight":       {"weight", "protein"},
	"colorectal":   {"fiber", "vegetables"},
	"longevity":    {"late", "vegetables", "fish", "no"},
}

const nutritionFocusGapBoost = .3

type nutritionFocus struct {
	Choices   []domain.NutritionFocusChoice
	Keys      []string
	Nutrients map[string]bool
	Topics    map[string]bool
}

func (f nutritionFocus) has(key string) bool { return slices.Contains(f.Keys, key) }

func (in nutritionStateInput) focus() nutritionFocus {
	f := nutritionFocus{Choices: []domain.NutritionFocusChoice{}, Keys: []string{}, Nutrients: map[string]bool{}, Topics: map[string]bool{}}
	if in.Profile == nil {
		return f
	}
	titles := map[string]string{}
	for _, spec := range nutritionFocusSpecs {
		titles[spec.Key] = spec.Title
	}
	custom := map[string]string{}
	for _, c := range parseCustomHealthFocusesFromProfile(in.Profile) {
		custom[c.ID] = c.Label
	}
	for _, key := range userservice.ParseHealthFocusKeys(in.Profile.HealthCondition["focus_keys"]) {
		if len(f.Keys) == userservice.HealthFocusKeyLimit {
			break
		}
		if id, ok := strings.CutPrefix(key, userservice.HealthFocusCustomPrefix); ok {
			if label := custom[id]; label != "" {
				f.Choices = append(f.Choices, domain.NutritionFocusChoice{Key: key, Title: label, Custom: true})
				f.Keys = append(f.Keys, key)
			}
			continue
		}
		if titles[key] == "" {
			continue
		}
		f.Choices = append(f.Choices, domain.NutritionFocusChoice{Key: key, Title: titles[key]})
		f.Keys = append(f.Keys, key)
		for _, n := range nutritionFocusNutrients[key] {
			f.Nutrients[n] = true
		}
		for _, t := range nutritionFocusTopics[key] {
			f.Topics[t] = true
		}
	}
	return f
}

// nutritionFocusGaps moves the gaps the user cares about up the list.
func nutritionFocusGaps(gaps []domain.NutritionGap, f nutritionFocus) []domain.NutritionGap {
	out := slices.Clone(gaps)
	for i := range out {
		if f.Nutrients[out[i].Key] {
			out[i].Severity = min(1.2, out[i].Severity+nutritionFocusGapBoost)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Severity > out[j].Severity })
	return out
}

// nutritionFocusCards puts the chosen focus cards first, in the user's order.
func nutritionFocusCards(cards []domain.NutritionFocusScore, f nutritionFocus) []domain.NutritionFocusScore {
	rank := func(key string) int {
		if i := slices.Index(f.Keys, key); i >= 0 {
			return i
		}
		return len(f.Keys)
	}
	out := slices.Clone(cards)
	sort.SliceStable(out, func(i, j int) bool { return rank(out[i].Key) < rank(out[j].Key) })
	return out
}

// nutritionPriorities merges what the health profile says (medical history) with the
// focus: either way blood pressure means watching sodium, blood glucose sugar.
func nutritionPriorities(medical map[string]bool, f nutritionFocus) map[string]bool {
	out := map[string]bool{}
	for k, v := range medical {
		out[k] = v
	}
	if f.has("hypertension") {
		out["hypertension"] = true
	}
	if f.has("diabetes") {
		out["diabetes"] = true
	}
	return out
}
