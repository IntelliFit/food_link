package service

import (
	"regexp"
	"slices"
	"sort"
	"strings"
)

// A user who names a dish wants that dish. Real-model replay 2026-11-26: "想吃猪肉炖粉条" near
// 清华 found 红烧肉炖粉条, but no rice was recorded at that shop, so the whole-meal rule left
// nothing to offer and the user was asked to relax the request. When a turn would end with
// no option, the named dish, or the closest dish on record, is offered as a single dish and
// the answer says what it is and that a staple goes with it.

var (
	// "想吃X", "来一份X", "有没有X": the dish follows the request words.
	mealNamedDishPattern = regexp.MustCompile(`(?:想吃(?:点|些)?|想来(?:点|一)?(?:份|碗|个|盘)?|(?:来|要|点)(?:一)?(?:份|碗|个|盘)|有没有)([\p{Han}]{2,12})`)
	// Words that describe a wish, not a dish.
	mealNamedDishGeneric = regexp.MustCompile(`什么|啥|东西|便宜|实惠|清淡|健康|好吃|高蛋白|低脂|低卡|减脂|减肥|增肌|早餐|午餐|晚餐|早饭|午饭|晚饭|夜宵|外卖|食堂|餐厅|附近|推荐|随便|一点|热的|凉的|辣的|甜的|咸的|素的|荤的`)
)

// mealDishSimilarityFloor is how much of the named dish a title must share to count as the
// same or a closely related dish.
const mealDishSimilarityFloor = 0.6

// mealNamedDish is the dish a request names, or "" when it describes a wish instead
// ("想吃清淡", "想吃便宜点的").
func mealNamedDish(question string) string {
	match := mealNamedDishPattern.FindStringSubmatch(strings.ReplaceAll(question, " ", ""))
	if len(match) < 2 {
		return ""
	}
	name := strings.TrimRight(match[1], "吧吗呢呀啊了的嘛哦")
	if len([]rune(name)) < 2 || mealNamedDishGeneric.MatchString(name) {
		return ""
	}
	return name
}

// mealDishSimilarity is the share of the named dish found, in order, in a title: 0.8 for
// 猪肉炖粉条 and 红烧肉炖粉条. Below mealDishSimilarityFloor, or with no two characters in a
// row in common, it is 0: one shared ingredient is not the same dish.
func mealDishSimilarity(name, title string) float64 {
	a, b := []rune(name), []rune(title)
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	subsequence := make([][]int, len(a)+1)
	run := make([][]int, len(a)+1)
	for i := range subsequence {
		subsequence[i], run[i] = make([]int, len(b)+1), make([]int, len(b)+1)
	}
	longestRun := 0
	for i := 1; i <= len(a); i++ {
		for j := 1; j <= len(b); j++ {
			if a[i-1] == b[j-1] {
				subsequence[i][j] = subsequence[i-1][j-1] + 1
				run[i][j] = run[i-1][j-1] + 1
				longestRun = max(longestRun, run[i][j])
			} else {
				subsequence[i][j] = max(subsequence[i-1][j], subsequence[i][j-1])
			}
		}
	}
	share := float64(subsequence[len(a)][len(b)]) / float64(len(a))
	if longestRun < 2 || share < mealDishSimilarityFloor {
		return 0
	}
	return share
}

// mealNamedDishShare is how well an option matches the named dish: by its title, or by one
// of the dishes it is made of ("米饭 + 鱼香肉丝" for 鱼香肉丝).
func mealNamedDishShare(name string, c DietRecommendationCandidate) float64 {
	share := mealDishSimilarity(name, c.Title)
	for _, item := range c.Items {
		share = max(share, mealDishSimilarity(name, item.Name))
	}
	return share
}

// mealNamedDishChoices are the retrieved options closest to the dish the user named, under
// this turn's other conditions (hours, avoid foods, budget). Whole meals that contain the
// dish come first; when there is none, the dish itself as a single dish (single = true).
func mealNamedDishChoices(state *campusDietAgentRunState) (picks []DietRecommendationCandidate, name string, single bool) {
	name = mealNamedDish(state.Question)
	if name == "" || !campusDietAgentIsSearchIntent(state.Intent) {
		return nil, "", false
	}
	type scored struct {
		c     DietRecommendationCandidate
		share float64
	}
	all := make([]DietRecommendationCandidate, 0, len(state.Candidates))
	for _, c := range state.Candidates {
		if c.Source != "food_record" {
			all = append(all, c)
		}
	}
	rows := []scored{}
	if state.Constraints.CompleteMeal {
		for _, c := range mealFeasibleChoices(state, all) {
			if share := mealNamedDishShare(name, c); share > 0 {
				rows = append(rows, scored{c, share})
			}
		}
	}
	if len(rows) == 0 {
		// Whatever carries the name counts: 麻辣香锅 is neither a staple dish nor a side.
		single = true
		dish := *state
		dish.Constraints.CompleteMeal, dish.Constraints.ItemKind = false, ""
		for _, c := range all {
			if c.Source == "meal_plan" {
				continue
			}
			share := mealDishSimilarity(name, c.Title)
			if share == 0 || len(mealHarnessRank(&dish, []DietRecommendationCandidate{c})) == 0 {
				continue
			}
			rows = append(rows, scored{c, share})
		}
	}
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.share != b.share {
			return a.share > b.share
		}
		da, db := 99.0, 99.0
		if a.c.DistanceKM != nil {
			da = *a.c.DistanceKM
		}
		if b.c.DistanceKM != nil {
			db = *b.c.DistanceKM
		}
		if da != db {
			return da < db
		}
		return a.c.SourceID < b.c.SourceID
	})
	seen := []string{}
	for _, row := range rows {
		if key := mealFingerprint(row.c); !slices.Contains(seen, key) && len(picks) < 3 {
			seen = append(seen, key)
			picks = append(picks, row.c)
		}
	}
	return picks, name, single
}

// mealNamedDishAnswer says what was found for the dish the user named.
func mealNamedDishAnswer(name string, picks []DietRecommendationCandidate, single bool) string {
	titles := []string{}
	exact := true
	for _, c := range picks {
		titles = append(titles, "「"+c.Title+"」")
		exact = exact && strings.Contains(c.Title, name)
	}
	found := "找到了" + strings.Join(titles, "")
	if !exact {
		found = "没有收录「" + name + "」，最接近的是" + strings.Join(titles, "")
	}
	if single && mealNeedsStapleBeside(picks) {
		return found + "。这是单点的菜，建议再加一份主食。"
	}
	return found + "。"
}

// mealNeedsStapleBeside is true when every pick is a meat, vegetable or soup dish that is
// normally eaten with a staple.
func mealNeedsStapleBeside(picks []DietRecommendationCandidate) bool {
	for _, c := range picks {
		if role := mealComboRoleOf(c); role != mealRoleProtein && role != mealRoleVegetable && role != mealRoleSoup {
			return false
		}
	}
	return len(picks) > 0
}

// namedDishResult offers the dish the user named when the model's own answer is empty or
// fails validation: a whole meal that contains it, else the dish alone. Nil when no such
// dish was retrieved.
func namedDishResult(state *campusDietAgentRunState) *CampusDietAgentResult {
	picks, name, single := mealNamedDishChoices(state)
	if len(picks) == 0 {
		return nil
	}
	before, beforePick := state.Constraints, state.NamedDishPick
	state.NamedDishPick = true
	if single {
		state.Constraints.CompleteMeal, state.Constraints.ItemKind = false, ""
	}
	final := campusDietAgentFinal{Answer: mealNamedDishAnswer(name, picks, single)}
	for _, c := range picks {
		final.Selections = append(final.Selections, campusDietAgentFinalSelection{SourceID: c.SourceID, Reason: "你点名要的菜"})
	}
	result, err := buildCampusDietAgentResult(state, final, true, "")
	if err != nil || len(result.Recommendation.Recommendations) == 0 {
		state.Constraints, state.NamedDishPick = before, beforePick
		return nil
	}
	result.Answer = final.Answer
	result.Recommendation.Summary = final.Answer
	// Offering one named dish does not turn the conversation into single-dish mode: the
	// card keeps the turn's own requirements for the turns that follow.
	standing := before
	result.Recommendation.AgentConstraints = &standing
	return result
}

// mealNamedDishInstead checks a validated answer against the dish the user named. When the
// dish, or a close one, was retrieved but the answer offers none of them, the named dish is
// given instead (replay 2026-11-26: "想吃猪肉炖粉条" was answered with 炒合菜炒饼). When the
// server's own search matched nothing at all, the answer says so before its other options
// (the same replay: "想吃麻辣香锅" got two rice dishes and no word about 麻辣香锅).
func mealNamedDishInstead(state *campusDietAgentRunState, result *CampusDietAgentResult) *CampusDietAgentResult {
	name := mealNamedDish(state.Question)
	if name == "" || result == nil || len(result.Recommendation.Recommendations) == 0 || !campusDietAgentIsSearchIntent(state.Intent) {
		return nil
	}
	for _, option := range result.Recommendation.Recommendations {
		if c, ok := state.Candidates[option.SourceID]; ok && mealNamedDishShare(name, c) > 0 {
			return nil
		}
	}
	if named := namedDishResult(state); named != nil {
		return named
	}
	if state.NamedDishSearched && state.NamedDishMatches == 0 {
		prefix := "这里收录的餐食里没有「" + name + "」，先看看这几份。"
		if !strings.HasPrefix(result.Answer, prefix) {
			result.Answer = prefix + result.Answer
			result.Recommendation.Summary = result.Answer
		}
	}
	return nil
}
