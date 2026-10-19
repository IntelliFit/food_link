package service

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"

	"food_link/backend/internal/health/domain"
)

// mealTakeoutCoverage is what the takeout searches of one run actually found around the
// user: ordinary merchants in range, and the canteens left out because a canteen is not
// delivered. The catalogue holds only a few merchants with a few dishes each, so the
// honest answer to "nothing fits" is these counts, not a guess. Searches may be filtered
// (dishes already offered, a keyword, a budget), so the counts describe what matched this
// request, and the merchants offered earlier in the conversation are named separately.
type mealTakeoutCoverage struct {
	Measured  bool
	Merchants int
	Dishes    int
	Canteens  []string
	RadiusKM  float64
	merchants map[string]bool
	dishes    map[string]bool
}

// mealMeasureTakeoutCoverage adds one search's results to what the run has measured so far.
func mealMeasureTakeoutCoverage(state *campusDietAgentRunState, retrieved []DietRecommendationCandidate) mealTakeoutCoverage {
	coverage := state.TakeoutCoverage
	coverage.Measured = true
	coverage.RadiusKM = state.Constraints.RadiusKM
	if coverage.RadiusKM <= 0 {
		coverage.RadiusKM = 5
	}
	merchants, dishes := map[string]bool{}, map[string]bool{}
	for name := range coverage.merchants {
		merchants[name] = true
	}
	for id := range coverage.dishes {
		dishes[id] = true
	}
	canteens := slices.Clone(coverage.Canteens)
	for _, c := range retrieved {
		if c.Source == "food_record" || c.MerchantName == "" && c.CanteenName == "" {
			continue
		}
		if state.Location != nil && (c.DistanceKM == nil || *c.DistanceKM > coverage.RadiusKM) {
			continue
		}
		if domain.IsCanteenVenue(c) {
			// The same canteen may be stored twice (as a canteen and as a placeholder merchant).
			if name := mealCleanVenueName(defaultIfEmpty(c.CanteenName, c.MerchantName)); !slices.Contains(canteens, name) {
				canteens = append(canteens, name)
			}
			continue
		}
		merchants[c.MerchantName] = true
		dishes[c.SourceID] = true
	}
	slices.Sort(canteens)
	coverage.merchants, coverage.dishes, coverage.Canteens = merchants, dishes, canteens
	coverage.Merchants, coverage.Dishes = len(merchants), len(dishes)
	return coverage
}

func mealCleanVenueName(name string) string {
	return strings.TrimSpace(strings.NewReplacer("（名称待确认）", "", "(名称待确认)", "").Replace(name))
}

// mealOfferedMerchants names the ordinary merchants of the recommendation on screen.
func mealOfferedMerchants(state *campusDietAgentRunState) []string {
	if state.ActiveResult == nil {
		return nil
	}
	names := []string{}
	for _, option := range state.ActiveResult.Recommendations {
		candidate := DietRecommendationCandidate{MerchantName: option.MerchantName, CanteenName: option.CanteenName, IsCampusFood: option.IsCampusFood}
		if option.MerchantName != "" && !domain.IsCanteenVenue(candidate) && !slices.Contains(names, option.MerchantName) {
			names = append(names, option.MerchantName)
		}
	}
	return names
}

// mealTakeoutGapAnswer says what is and is not available instead of repeating a
// generic question: what matched in range, what was already offered, what was
// excluded, and that no delivery platform is connected.
func mealTakeoutGapAnswer(state *campusDietAgentRunState) string {
	c := state.TakeoutCoverage
	radius := formatCampusDietNumber(c.RadiusKM)
	if c.RadiusKM <= 0 {
		radius = "5"
	}
	offered := mealOfferedMerchants(state)
	var answer string
	switch {
	case c.Merchants > 0:
		answer = fmt.Sprintf("附近%s公里内符合这次条件的校外商家有%d家、%d道菜，但没有能核算成完整一餐的选项", radius, c.Merchants, c.Dishes)
	case len(offered) > 0:
		answer = fmt.Sprintf("附近%s公里内符合这次条件、已收录的校外商家，刚才都推荐过了（%s）", radius, strings.Join(offered, "、"))
	default:
		answer = fmt.Sprintf("附近%s公里内没有收录符合这次条件的校外商家", radius)
	}
	if len(c.Canteens) > 0 {
		answer += "；" + strings.Join(c.Canteens, "、") + "是食堂，不算外卖，已经排除"
	}
	return answer + "。这不代表当地没有商家：我没有接入美团、饿了么这类外卖平台的实时数据，所以查不到更多。你可以告诉我想吃的店名或菜系、放宽预算或距离，也可以让我按你的目标说说点外卖时怎么选。"
}

// mealAnyFeasibleChoice is true when something searched this run could still be offered.
func mealAnyFeasibleChoice(state *campusDietAgentRunState) bool {
	ids := make([]string, 0, len(state.Candidates))
	for id := range state.Candidates {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	pool := mergeCampusDietCandidates(state.LastSearch, candidatesForCampusDietIDs(ids, state.Candidates), campusDietAgentSearchLimit)
	return len(mealFeasibleChoices(state, pool)) > 0
}

// mealTakeoutCoverageFacts gives the model what the takeout search really covered, so it
// can explain an empty or thin result itself instead of a fixed paragraph.
func mealTakeoutCoverageFacts(state *campusDietAgentRunState) map[string]any {
	c := state.TakeoutCoverage
	if !c.Measured || state.Constraints.Scene != "takeout" {
		return nil
	}
	return map[string]any{
		"radius_km": c.RadiusKM, "merchants_in_range": c.Merchants, "dishes_in_range": c.Dishes,
		"canteens_excluded_as_not_takeout": c.Canteens, "merchants_already_offered": mealOfferedMerchants(state),
		"note": "这是已收录餐食库的范围，不代表当地全部商家；没有接入美团、饿了么等外卖平台的实时数据，也不能替用户下单。没有合适结果时如实说明这些事实并给出一个可行的下一步，不要说只能看到校园食堂。",
	}
}

var mealAsksForLocation = regexp.MustCompile(`(?:缺少|没有|需要|提供)(?:你的|您的)?(?:地点|位置|定位)|你在哪|您在哪|请问.{0,6}(?:在哪|位置|地点)`)

var mealEmptyAnswerUnsafe = regexp.MustCompile(`只能看到校园|只能查到校园|只有校园|没有(?:任何)?商家(?:数据|信息)|已(?:经)?(?:为你|帮你|替你)?下单|帮你点了|替你点了|给你点好`)

// mealModelEmptyAnswer keeps the model's own explanation of an empty result when it is
// grounded (the evidence filter drops unverifiable numbers and claims) and states nothing
// false about the data; otherwise the caller keeps the fixed explanation.
func mealModelEmptyAnswer(state *campusDietAgentRunState, answer string) string {
	words := strings.TrimSpace(mealEvidenceText(state, answer))
	if utf8.RuneCountInString(words) < 8 || mealEmptyAnswerUnsafe.MatchString(answer) {
		return ""
	}
	// Asking where the user is when a location is known is not an explanation of the result.
	if state.Location != nil && mealAsksForLocation.MatchString(answer) {
		return ""
	}
	if state.Constraints.Scene == "takeout" && !strings.Contains(words, "不代表当地没有商家") {
		if !strings.ContainsAny(string([]rune(words)[utf8.RuneCountInString(words)-1:]), "。！？!?") {
			words += "。"
		}
		words += "这不代表当地没有商家：我没有接入美团、饿了么这类外卖平台的实时数据，查到的只是已收录的商家。"
	}
	return words
}

// mealFreshFeasibleChoices are this run's feasible options, best first, without the ones on
// the card the user is reacting to (showing those again would pretend to have adjusted).
func mealFreshFeasibleChoices(state *campusDietAgentRunState) []DietRecommendationCandidate {
	ids := make([]string, 0, len(state.Candidates))
	for id := range state.Candidates {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	pool := mergeCampusDietCandidates(state.LastSearch, candidatesForCampusDietIDs(ids, state.Candidates), campusDietAgentSearchLimit)
	out := []DietRecommendationCandidate{}
	for _, c := range mealFeasibleChoices(state, pool) {
		if state.Intent != "initial" && slices.Contains(state.ActiveSourceIDs, c.SourceID) {
			continue
		}
		out = append(out, c)
	}
	// The taste the user just asked for comes first ("能不能来点辣的").
	sort.SliceStable(out, func(i, j int) bool {
		return mealTasteMatch(state.Question, out[i]) > mealTasteMatch(state.Question, out[j])
	})
	return out
}

var mealTasteWords = []struct{ asked, dish *regexp.Regexp }{
	{regexp.MustCompile(`辣|麻|川|湘|重口`), regexp.MustCompile(`辣|椒|麻|川|湘|水煮|毛血旺`)},
	{regexp.MustCompile(`清淡|少油|不油|别太油`), regexp.MustCompile(`清|蒸|炖|汤|白灼|凉拌`)},
	{regexp.MustCompile(`酸`), regexp.MustCompile(`酸|醋|番茄|柠檬`)},
	{regexp.MustCompile(`甜`), regexp.MustCompile(`甜|糖|蜜|叉烧`)},
}

func mealTasteMatch(question string, c DietRecommendationCandidate) int {
	score := 0
	text := c.Title + c.Description
	for _, taste := range mealTasteWords {
		if taste.asked.MatchString(question) && !regexp.MustCompile(`不(?:要|想|吃)?`+taste.asked.String()).MatchString(question) && taste.dish.MatchString(text) {
			score++
		}
	}
	return score
}
