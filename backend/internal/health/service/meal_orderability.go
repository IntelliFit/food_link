package service

import (
	"regexp"
	"strings"
)

var (
	mealDependentItemPattern = regexp.MustCompile(`锅底|汤底|火锅底料|蘸料|自助调料|餐位费|开锅费|起锅费|加购|加料|火锅食材|涮菜`)
	mealRequiredOrderPattern = regexp.MustCompile(`不能单点|不可单点|不单卖|需另(?:点|购|付)|必须另|(?:不|未)(?:含|包含|包括)(?:锅底|汤底)|(?:锅底|汤底|调料|蘸料|餐位)(?:费|费用)?另(?:算|点|付|收)|搭配主餐购买|仅限加购`)
	mealHotpotVenuePattern   = regexp.MustCompile(`火锅|涮锅|涮肉`)
	mealIncludedBasePattern  = regexp.MustCompile(`(?:已含|包含|含有|含)[^。；;]{0,12}(?:锅底|汤底|底料)|(?:锅底|汤底|底料)[^。；;]{0,8}(?:已含|已计入|包含在)`)
	mealBundlePattern        = regexp.MustCompile(`套餐|套饭|单人餐|双人餐|整餐`)
	mealPreparedMainPattern  = regexp.MustCompile(`臊子面|打卤面|阳春面|清汤面|热干面|炸酱面|拌面|炒面|炒饭|拌饭|盖饭|盖浇饭|煲仔饭|馅饼|汉堡|肉夹馍`)
)

// A model verdict using normal ordering knowledge, not a source of prices or fees.
// Kept internal to the harness so the user does not see another block of small text.
type mealOrderingCheck struct {
	ReadyToOrder           bool `json:"ready_to_order"`
	MandatoryCostsIncluded bool `json:"mandatory_costs_included"`
}

// This is a conservative catalog-evidence guard, not an exhaustive menu ontology.
// The model must still use ordinary ordering knowledge for unmarked dependencies.
// A saved intake is evidence of eating, not an offer to buy again at that price.
func mealOrderingRisk(c DietRecommendationCandidate) string {
	if c.Source == "food_record" {
		return ""
	}
	if regexp.MustCompile(`饺|包子|生煎|烧麦|烧卖`).MatchString(c.Title) && !mealKnownServing(c) &&
		!regexp.MustCompile(`(?:[0-9一二三四五六七八九十]+\s*(?:只|个)|套餐|套饭|单人餐)`).MatchString(c.Title) {
		return "单个或整份的计价与份量未注明，不能把参考营养的一份当作实际售卖的一餐"
	}
	food := c.Title + " " + c.Description
	dependencyText := strings.NewReplacer("无需另点", "", "无需另购", "", "无需另付", "", "不需要另点", "", "不需要另购", "", "不需要另付", "").Replace(food)
	if mealRequiredOrderPattern.MatchString(dependencyText) {
		return "记录提示需要额外点单或付费，当前标价不是完整一餐总价"
	}
	venue := strings.Join([]string{c.MerchantName, c.WindowName}, " ")
	if mealHotpotVenuePattern.MatchString(venue) || mealHotpotVenuePattern.MatchString(c.Title) {
		// Only a documented bundle including its base can clear this guard.
		// Adding a separately priced base alone does not establish all mandatory
		// fees, serving sizes, or what fraction of soup is actually consumed.
		if mealBundlePattern.MatchString(c.Title) && mealIncludedBasePattern.MatchString(c.Description) {
			return ""
		}
		return "火锅条目须核对锅底和必选费用；配菜标价不能当作可独立点单的整餐价"
	}
	if mealDependentItemPattern.MatchString(c.Title) {
		return "这是底料、加料或费用条目，不能作为独立主餐或已算齐总价的一餐"
	}
	return ""
}

func mealOrderingGap(state *campusDietAgentRunState) string {
	q := strings.ReplaceAll(state.Question, " ", "")
	if !regexp.MustCompile(`火锅|锅底|必选费用|单点|只点`).MatchString(q) || state.RetrievalFailed {
		return ""
	}
	if regexp.MustCompile(`不要火锅|不吃火锅|不想吃火锅`).MatchString(q) && !strings.Contains(q, "锅底") {
		return ""
	}
	for _, c := range state.Candidates {
		if mealHotpotVenuePattern.MatchString(c.Title+" "+c.WindowName+" "+c.MerchantName) && mealOrderingRisk(c) == "" && mealHasEvidenceStructure(c) && mealKnownServing(c) {
			// A malformed model answer is not proof of a catalog gap when a
			// documented complete bundle already exists. Keep the error honest.
			return ""
		}
	}
	for _, c := range state.Candidates {
		if mealOrderingRisk(c) != "" && mealHotpotVenuePattern.MatchString(c.Title+" "+c.WindowName+" "+c.MerchantName) {
			return "查到的是火锅配菜或单项价格，还缺完整套餐和锅底等必选费用依据，不能把配菜合计当作整餐总价。要不要改选可直接点的面饭？"
		}
	}
	return ""
}

// Preserve ranking within each venue while exposing more than one window.
// Complete meals lead the page; ordinary sides remain available for composition,
// and dependency-risk items remain inspectable rather than being deleted.
func mealSearchPage(candidates []DietRecommendationCandidate, limit int, completeMeal bool) []DietRecommendationCandidate {
	if limit <= 0 || limit > len(candidates) {
		limit = len(candidates)
	}
	if !completeMeal {
		return candidates[:limit]
	}
	tiers := [3][]DietRecommendationCandidate{}
	for _, c := range candidates {
		switch {
		case mealHasEvidenceStructure(c):
			tiers[0] = append(tiers[0], c)
		case mealOrderingRisk(c) == "":
			tiers[1] = append(tiers[1], c)
		default:
			tiers[2] = append(tiers[2], c)
		}
	}
	out := make([]DietRecommendationCandidate, 0, limit)
	for _, tier := range tiers {
		keys := []string{}
		groups := map[string][]DietRecommendationCandidate{}
		for _, c := range tier {
			key := strings.Join([]string{c.SchoolID, c.CanteenName, c.WindowName, c.Floor, c.MerchantName, c.Address}, "|")
			if _, exists := groups[key]; !exists {
				keys = append(keys, key)
			}
			groups[key] = append(groups[key], c)
		}
		for round := 0; len(out) < limit; round++ {
			added := false
			for _, key := range keys {
				if round < len(groups[key]) {
					out = append(out, groups[key][round])
					added = true
					if len(out) == limit {
						return out
					}
				}
			}
			if !added {
				break
			}
		}
	}
	return out
}
