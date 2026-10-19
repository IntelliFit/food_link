package service

import (
	"math"
	"sort"
	"strings"

	"food_link/backend/internal/health/domain"
)

const (
	mealComboVegetableBonus    = 8.0  // lunch/dinner: a vegetable settles a tie between equally healthy meals, even at one more counter
	mealComboDishRepeatPenalty = 30.0 // per dish already recommended earlier in this conversation or earlier in this answer
	mealComboExposurePerDay    = 6.0  // per day a dish was recently put in front of the user
	mealComboExposureDishCap   = 12.0
	mealComboExposureCap       = 24.0
	mealComboWindowPenalty     = 4.0 // per extra window the user must queue at
	mealComboSameVenuePenalty  = 8.0
	mealComboSameFamilyPenalty = 14.0
	mealComboFreePrice         = 25.0 // a canteen meal up to this price costs nothing in the tie-break
	mealComboPricePerYuan      = 0.05
	mealComboPriceCap          = 6.0
	mealComboMinHealthFit      = 50.0 // below this a "meal" is not worth offering, whatever the menu looks like
	mealComboMaxWindows        = 3
	mealComboAnchorLimit       = 40 // main dishes kept per canteen before full validation
	mealComboPerAnchor         = 6  // best assemblies kept per main dish (different sides keep variety alive)
	mealComboMaxPlaces         = 8  // canteens/merchants fully assembled per request
	mealComboSecondProteins    = 6  // a two-meat meal pairs its main with the next few protein-dense dishes only
	mealComboSecondSides       = 6  // and with the lightest vegetables only, which keeps big menus fast
	mealComboToolLimit         = 6
)

// mealCombo is a validated meal built from real catalog dishes of one canteen (or
// merchant address). An assembled meal has a synthetic "meal_plan" Plan and the
// dishes the user actually buys as Components; a Single meal is one catalog dish
// that is already a complete meal.
type mealCombo struct {
	Plan        DietRecommendationCandidate
	Components  []DietRecommendationCandidate
	HealthFit   float64
	Score       float64
	ShownDays   int
	CrossWindow bool
	Single      bool
	Windows     []string
}

type mealComboReport struct {
	Combos     []mealCombo
	Places     int
	Considered int
	Reason     string
}

type mealComboPart struct {
	c       DietRecommendationCandidate
	role    mealComboRole
	window  string
	floor   string // normalised (mealFloorKey); empty when the catalogue has no floor
	special bool
	plain   bool   // an ordinary merchant at one address (no canteen, no windows)
	dish    string // the dish by name: the same dish at two windows is one dish
}

type mealComboPlace struct {
	key                                                 string
	staples, fulls, proteins, vegetables, soups, drinks []*mealComboPart
}

type mealComboPoolStats struct {
	considered, unpriced, usable int
}

func (s mealComboPoolStats) reason() string {
	switch {
	case s.considered == 0:
		return "范围内没有可用于搭配的食堂或商家菜品"
	case s.usable == 0 && s.unpriced > 0:
		return "这些菜品没有标明每份价格，无法核算整餐总价，不能凭空拼出一餐"
	case s.usable == 0:
		return "符合本餐条件的可搭配菜品为空"
	}
	return "同一食堂（或同一商家）里没有同时收录主食和荤菜（或整份主餐）的条目，凑不成一餐"
}

func mealComboMealType(state *campusDietAgentRunState) string {
	if state.Constraints.MealType != "" {
		return state.Constraints.MealType
	}
	return state.MealContext.MealType
}

// The venue a dish is sold at, in the same terms as mealSamePlace: school or area, campus and the
// normalised canteen/merchant name. Floors and windows are decided pair by pair.
func mealComboPlaceKey(c DietRecommendationCandidate) string {
	venue := domain.DiningVenueKey(defaultIfEmpty(c.CanteenName, c.MerchantName))
	if venue == "" {
		return ""
	}
	return strings.Join([]string{defaultIfEmpty(c.SchoolID, defaultIfEmpty(c.SchoolName, c.Address)), c.CampusID, venue}, "|")
}

// The same quick macro fit the engine uses, without the micronutrient pass.
// Only used to shortlist assemblies; the shortlist is then fully evaluated.
func mealComboQuickFit(ctx dietDecisionContext, c DietRecommendationCandidate) float64 {
	if resolvedDietEngineVersion(ctx) == dietDecisionEngineVersion {
		return v3MacroFit(ctx, c)
	}
	return dietDecisionHealthFit(ctx, c)
}

// Single dishes become building blocks only when their serving price is known,
// they pass the ordinary scope/allergy/budget rules, and nothing about them
// suggests a dependent add-on. Whole-meal minimums are applied to the assembly.
func mealComboPlaces(state *campusDietAgentRunState, pool []DietRecommendationCandidate) ([]*mealComboPlace, mealComboPoolStats) {
	stats := mealComboPoolStats{}
	exposure := state.exposureIndex()
	componentState := *state
	componentState.Constraints.MinProtein = nil
	componentState.Constraints.RequiredStaple = ""
	candidates := make([]DietRecommendationCandidate, 0, len(pool))
	for _, c := range pool {
		if c.Source == "food_record" || c.Source == "meal_plan" {
			continue
		}
		stats.considered++
		if !mealKnownServing(c) {
			stats.unpriced++
			continue
		}
		if c.Calories <= 0 || c.NutritionBasis == "unavailable" || mealOrderingRisk(c) != "" || mealComboPlaceKey(c) == "" || exposure.wasSkipped(c) {
			continue
		}
		candidates = append(candidates, c)
	}
	byKey := map[string]*mealComboPlace{}
	keys := []string{}
	for _, c := range mealHarnessRank(&componentState, candidates) {
		role := mealComboRoleOf(c)
		if role == mealRoleOther {
			continue
		}
		stats.usable++
		key := mealComboPlaceKey(c)
		place := byKey[key]
		if place == nil {
			place = &mealComboPlace{key: key}
			byKey[key] = place
			keys = append(keys, key)
		}
		part := &mealComboPart{c: c, role: role, window: mealWindowKey(c), floor: mealFloorKey(c.Floor), special: mealSpecialVenue(c),
			plain: !c.IsCampusFood && c.CanteenName == "" && c.Address != "", dish: mealComboDishKey(c)}
		switch role {
		case mealRoleStaple:
			place.staples = append(place.staples, part)
		case mealRoleFull:
			place.fulls = append(place.fulls, part)
		case mealRoleProtein:
			place.proteins = append(place.proteins, part)
		case mealRoleVegetable:
			place.vegetables = append(place.vegetables, part)
		case mealRoleSoup:
			place.soups = append(place.soups, part)
		case mealRoleDrink:
			place.drinks = append(place.drinks, part)
		}
	}
	sort.Strings(keys)
	places := []*mealComboPlace{}
	for _, key := range keys {
		place := byKey[key]
		place.restrictBases(state.Constraints.RequiredStaple)
		place.cap()
		if (len(place.staples) > 0 && len(place.proteins) > 0) || len(place.fulls) > 0 {
			places = append(places, place)
		}
	}
	return places, stats
}

// A required staple (rice / noodles) is a property of the whole meal; the part
// that carries it is the staple or the whole-meal dish.
func (p *mealComboPlace) restrictBases(required string) {
	var food string
	switch required {
	case "rice":
		food = "米饭"
	case "noodles":
		food = "面"
	default:
		return
	}
	keep := func(parts []*mealComboPart) []*mealComboPart {
		out := parts[:0:0]
		for _, part := range parts {
			if mealAvoidFoodMatches(food, normalizedDietDecisionCandidateText(part.c)) {
				out = append(out, part)
			}
		}
		return out
	}
	p.staples, p.fulls = keep(p.staples), keep(p.fulls)
}

// Bound the enumeration without hiding menu variety: keep the protein-dense
// dishes and the lightest sides, which are the ones that make a balanced plate.
func (p *mealComboPlace) cap() {
	sort.SliceStable(p.proteins, func(i, j int) bool {
		a, b := p.proteins[i].c, p.proteins[j].c
		return a.Protein/math.Max(a.Calories, 1) > b.Protein/math.Max(b.Calories, 1)
	})
	sort.SliceStable(p.vegetables, func(i, j int) bool { return p.vegetables[i].c.Calories < p.vegetables[j].c.Calories })
	trim := func(parts []*mealComboPart, n int) []*mealComboPart {
		if len(parts) > n {
			return parts[:n]
		}
		return parts
	}
	p.staples, p.fulls = trim(p.staples, 8), trim(p.fulls, 8)
	p.proteins, p.vegetables = trim(p.proteins, 32), trim(p.vegetables, 12)
	p.soups, p.drinks = trim(p.soups, 5), trim(p.drinks, 4)
}

type mealComboLimits struct {
	maxPrice, maxCalories, maxFat, minProtein *float64
}

func (l mealComboLimits) allows(calories, protein, fat, price float64) bool {
	return (l.maxPrice == nil || price <= *l.maxPrice) && (l.maxCalories == nil || calories <= *l.maxCalories) &&
		(l.maxFat == nil || fat <= *l.maxFat) && (l.minProtein == nil || protein >= *l.minProtein)
}

type mealComboDraft struct {
	parts [4]*mealComboPart
	n     int
	fit   float64
	price float64
}

func mealComboDraftBefore(a, b mealComboDraft) bool {
	if a.fit != b.fit {
		return a.fit > b.fit
	}
	if a.price != b.price {
		return a.price < b.price
	}
	for i := 0; i < a.n && i < b.n; i++ {
		if x, y := a.parts[i].c.SourceID, b.parts[i].c.SourceID; x != y {
			return x < y
		}
	}
	return a.n < b.n
}

// mealComboInsert keeps the best mealComboPerAnchor drafts, best first, without
// sorting or allocating on the hot path (an assembly is scored many thousand times).
func mealComboInsert(list []mealComboDraft, d mealComboDraft) []mealComboDraft {
	i := len(list)
	for i > 0 && mealComboDraftBefore(d, list[i-1]) {
		i--
	}
	if i >= mealComboPerAnchor {
		return list
	}
	list = append(list, mealComboDraft{})
	copy(list[i+1:], list[i:])
	list[i] = d
	if len(list) > mealComboPerAnchor {
		list = list[:mealComboPerAnchor]
	}
	return list
}

// The main dish is what the user remembers about a meal.
func mealComboAnchor(d mealComboDraft) string {
	anchor, best := "", -1.0
	for i := 0; i < d.n; i++ {
		part := d.parts[i]
		if (part.role == mealRoleProtein || part.role == mealRoleFull) && part.c.Protein > best {
			anchor, best = part.c.SourceID, part.c.Protein
		}
	}
	return anchor
}

// Parts of one meal must be reachable in one visit: a known floor may not differ,
// at most mealComboMaxWindows counters are queued at, and a stall that sells its
// own kind of food (pizza, hot pot, grill, drinks) never lends a side to another.
func mealComboReachable(d mealComboDraft) bool {
	windows := 0
	var seen [4]string
	for i := 0; i < d.n; i++ {
		part := d.parts[i]
		for j := 0; j < i; j++ {
			// The same rule as mealSamePlace: a known floor must be shared; without floor
			// evidence only one verified window (or one merchant address) can be combined.
			other := d.parts[j]
			if part.floor != "" || other.floor != "" {
				if part.floor == "" || part.floor != other.floor {
					return false
				}
			} else if !(part.window != "" && part.window == other.window) && !(part.plain && other.plain && part.c.Address == other.c.Address) {
				return false
			}
		}
		if part.window == "" {
			continue
		}
		known := false
		for j := 0; j < windows; j++ {
			known = known || seen[j] == part.window
		}
		if !known {
			seen[windows] = part.window
			windows++
		}
	}
	if windows > mealComboMaxWindows {
		return false
	}
	if windows > 1 {
		for i := 0; i < d.n; i++ {
			if d.parts[i].special {
				return false
			}
		}
	}
	return true
}

// enumerate scores every role-consistent assembly with the cheap macro fit and
// keeps the best few per main dish, so variety survives the shortlist.
func (p *mealComboPlace) enumerate(ctx dietDecisionContext, limits mealComboLimits, breakfast bool) (map[string][]mealComboDraft, int) {
	best := map[string][]mealComboDraft{}
	considered := 0
	consider := func(n int, a, b, c, d *mealComboPart) {
		draft := mealComboDraft{parts: [4]*mealComboPart{a, b, c, d}, n: n}
		var kcal, protein, carbs, fat float64
		for i := 0; i < n; i++ {
			item := draft.parts[i].c
			kcal, protein, carbs, fat, draft.price = kcal+item.Calories, protein+item.Protein, carbs+item.Carbs, fat+item.Fat, draft.price+item.Price
		}
		if !limits.allows(kcal, protein, fat, draft.price) || !mealComboReachable(draft) {
			return
		}
		considered++
		draft.fit = mealComboQuickFit(ctx, DietRecommendationCandidate{Calories: kcal, Protein: protein, Carbs: carbs, Fat: fat})
		anchor := mealComboAnchor(draft)
		best[anchor] = mealComboInsert(best[anchor], draft)
	}
	for _, base := range p.staples {
		for i, main := range p.proteins {
			consider(2, base, main, nil, nil)
			for _, veg := range p.vegetables {
				consider(3, base, main, veg, nil)
				for _, soup := range p.soups {
					consider(4, base, main, veg, soup)
				}
			}
			for _, second := range p.proteins[i+1 : min(len(p.proteins), i+1+mealComboSecondProteins)] {
				if second.dish == main.dish {
					continue // the same dish sold at another window
				}
				consider(3, base, main, second, nil)
				for _, veg := range p.vegetables[:min(len(p.vegetables), mealComboSecondSides)] {
					consider(4, base, main, second, veg)
				}
			}
			if breakfast {
				for _, drink := range p.drinks {
					consider(3, base, main, drink, nil)
				}
			}
		}
	}
	for _, whole := range p.fulls {
		for _, veg := range p.vegetables {
			consider(2, whole, veg, nil, nil)
			for _, soup := range p.soups {
				consider(3, whole, veg, soup, nil)
			}
		}
		if breakfast {
			for _, drink := range p.drinks {
				consider(2, whole, drink, nil, nil)
			}
		}
	}
	return best, considered
}

type mealComboRow struct {
	combo  mealCombo
	roles  []mealComboRole // role of each component, worked out once per dish
	place  string
	dishes map[string]bool
	family string
}

// mealComboDishKey names a dish the way the eater does: by what it is called, not by the
// window or catalog row that sells it.
func mealComboDishKey(c DietRecommendationCandidate) string {
	if key := normalizeDietDecisionToken(c.Title); key != "" {
		return key
	}
	return c.SourceID
}

func mealComboDishSet(components []DietRecommendationCandidate) map[string]bool {
	dishes := map[string]bool{}
	for _, c := range components {
		if mealComboRoleOf(c) != mealRoleStaple {
			dishes[mealComboDishKey(c)] = true
		}
	}
	return dishes
}

func mealComboSharedDishes(a, b map[string]bool) int {
	shared := 0
	for id := range a {
		if b[id] {
			shared++
		}
	}
	return shared
}

// Dishes already recommended in this conversation matter when the user asks for
// a different batch or changes the requirement; a new question starts fresh.
func mealComboConversationDishes(state *campusDietAgentRunState) (dishes, plans map[string]bool) {
	var ids []string
	switch state.Intent {
	case "more":
		ids = state.ExcludedSourceIDs
	case "refine":
		ids = state.ActiveSourceIDs
	}
	dishes, plans = map[string]bool{}, map[string]bool{}
	for _, id := range mealPhysicalIDs(state, ids) {
		dishes[id] = true
	}
	for _, id := range ids {
		plans[id] = true
		// Earlier dishes are also remembered by name, whichever window sold them.
		for _, c := range mealStoredComponents(state, id) {
			dishes[mealComboDishKey(c)] = true
		}
	}
	if state.ActiveResult != nil {
		for _, option := range state.ActiveResult.Recommendations {
			if plans[option.SourceID] && len(option.MealComponents) == 0 {
				dishes[mealComboDishKey(DietRecommendationCandidate{SourceID: option.SourceID, Title: option.Title})] = true
			}
		}
	}
	return dishes, plans
}

// searchMealCombos assembles meals from single dishes sold in one canteen. The
// engine, not a model, ranks them: health fit first, then within the same
// tolerance band used for single dishes, variety, recent exposure and ease.
func searchMealCombos(state *campusDietAgentRunState, pool []DietRecommendationCandidate, limit int) mealComboReport {
	return searchMealOptions(state, pool, limit, false)
}

// searchMealOptions is searchMealCombos plus, when asked, the canteen's dishes
// that are already a complete meal, so one ranking covers both kinds of answer.
func searchMealOptions(state *campusDietAgentRunState, pool []DietRecommendationCandidate, limit int, includeSingles bool) mealComboReport {
	if limit <= 0 {
		limit = campusDietAgentDefaultResultSize
	}
	places, stats := mealComboPlaces(state, pool)
	if len(places) == 0 {
		return mealComboReport{Reason: stats.reason()}
	}
	ctx := dietDecisionContextFromCampusState(state)
	mealType := mealComboMealType(state)
	breakfast := mealType == "breakfast"
	limits := mealComboLimits{state.Constraints.MaxPrice, state.Constraints.MaxCalories, state.Constraints.MaxFat, state.Constraints.MinProtein}

	type placeDrafts struct {
		place  *mealComboPlace
		drafts []mealComboDraft
		fit    float64
	}
	report := mealComboReport{}
	shortlist := make([]placeDrafts, 0, len(places))
	for _, place := range places {
		anchors, considered := place.enumerate(ctx, limits, breakfast)
		report.Considered += considered
		drafts := []mealComboDraft{}
		for _, list := range anchors {
			drafts = append(drafts, list...)
		}
		if len(drafts) == 0 && !(includeSingles && len(place.fulls) > 0) {
			continue
		}
		sort.SliceStable(drafts, func(i, j int) bool { return mealComboDraftBefore(drafts[i], drafts[j]) })
		// One entry per main dish, best first, bounded per canteen.
		perAnchor, kept := map[string]int{}, drafts[:0:0]
		anchorsSeen := 0
		for _, d := range drafts {
			a := mealComboAnchor(d)
			if perAnchor[a] == 0 {
				if anchorsSeen >= mealComboAnchorLimit {
					continue
				}
				anchorsSeen++
			}
			perAnchor[a]++
			kept = append(kept, d)
		}
		fit := 0.0
		if len(kept) > 0 {
			fit = kept[0].fit
		}
		if includeSingles {
			for _, whole := range place.fulls {
				fit = math.Max(fit, mealComboQuickFit(ctx, whole.c))
			}
		}
		shortlist = append(shortlist, placeDrafts{place: place, drafts: kept, fit: fit})
	}
	sort.SliceStable(shortlist, func(i, j int) bool {
		if shortlist[i].fit != shortlist[j].fit {
			return shortlist[i].fit > shortlist[j].fit
		}
		return shortlist[i].place.key < shortlist[j].place.key
	})
	if len(shortlist) > mealComboMaxPlaces {
		shortlist = shortlist[:mealComboMaxPlaces]
	}

	rows := []mealComboRow{}
	placesWithMeals := map[string]bool{}
	for _, sp := range shortlist {
		for _, d := range sp.drafts {
			components := make([]DietRecommendationCandidate, 0, d.n)
			roles := make([]mealComboRole, 0, d.n)
			dishes := map[string]bool{}
			for i := 0; i < d.n; i++ {
				components = append(components, d.parts[i].c)
				roles = append(roles, d.parts[i].role)
				if d.parts[i].role != mealRoleStaple {
					dishes[d.parts[i].dish] = true
				}
			}
			plan, err := composeMealPlan(state, components)
			if err != nil {
				continue
			}
			windows, windowCount := mealPurchasePoints(components)
			rows = append(rows, mealComboRow{
				combo:  mealCombo{Plan: plan, Components: components, CrossWindow: windowCount > 1, Windows: windows},
				roles:  roles,
				place:  sp.place.key,
				dishes: dishes,
				family: mealCandidateFamily(plan),
			})
			placesWithMeals[sp.place.key] = true
		}
		if !includeSingles {
			continue
		}
		for _, whole := range sp.place.fulls {
			c := whole.c
			if !limits.allows(c.Calories, c.Protein, c.Fat, c.Price) || len(mealHarnessRank(state, []DietRecommendationCandidate{c})) == 0 {
				continue
			}
			windows, _ := mealPurchasePoints([]DietRecommendationCandidate{c})
			rows = append(rows, mealComboRow{
				combo:  mealCombo{Plan: c, Components: []DietRecommendationCandidate{c}, Single: true, Windows: windows},
				roles:  []mealComboRole{whole.role},
				place:  sp.place.key,
				dishes: map[string]bool{mealComboDishKey(c): true},
				family: mealCandidateFamily(c),
			})
			placesWithMeals[sp.place.key] = true
		}
	}
	if len(rows) == 0 {
		report.Reason = "在预算、热量、忌口、窗口和楼层等条件下，没有能组成一餐的组合"
		return report
	}
	report.Places = len(placesWithMeals)

	plans := make([]DietRecommendationCandidate, len(rows))
	for i, row := range rows {
		plans[i] = row.combo.Plan
	}
	evalCtx := prepareDietDecisionComparison(ctx, plans)
	exposure := state.exposureIndex()
	shownDays := map[string]int{}
	dayCount := func(c DietRecommendationCandidate) int {
		if days, ok := shownDays[c.SourceID]; ok {
			return days
		}
		days := exposure.shownDays(c)
		shownDays[c.SourceID] = days
		return days
	}
	conversationDishes, conversationPlans := mealComboConversationDishes(state)
	scored := rows[:0:0]
	for _, row := range rows {
		if conversationPlans[row.combo.Plan.SourceID] {
			continue
		}
		evaluation := evaluateDietDecisionCandidate(evalCtx, row.combo.Plan)
		if !evaluation.Feasible || evaluation.Scores.HealthFit < mealComboMinHealthFit {
			continue
		}
		fit := evaluation.Scores.HealthFit
		score, maxDays := fit, 0
		historyPenalty, conversationPenalty := 0.0, 0.0
		hasVegetable, evidencePenalty := false, 0.0
		for i, c := range row.combo.Components {
			role := row.roles[i]
			hasVegetable = hasVegetable || role == mealRoleVegetable
			if _, penalty := mealEvidenceIssues(c, mealType); penalty > evidencePenalty {
				evidencePenalty = penalty
			}
			if role == mealRoleStaple {
				continue
			}
			days := dayCount(c)
			maxDays = max(maxDays, days)
			historyPenalty += math.Min(mealComboExposureDishCap, float64(days)*mealComboExposurePerDay)
			if conversationDishes[c.SourceID] || conversationDishes[mealComboDishKey(c)] {
				conversationPenalty += mealComboDishRepeatPenalty
			}
		}
		score -= math.Min(mealComboExposureCap, historyPenalty) + conversationPenalty + evidencePenalty
		score -= math.Min(mealComboPriceCap, math.Max(0, row.combo.Plan.Price-mealComboFreePrice)*mealComboPricePerYuan)
		if hasVegetable && mealType != "breakfast" {
			score += mealComboVegetableBonus
		}
		if len(row.combo.Windows) > 1 {
			score -= mealComboWindowPenalty * float64(len(row.combo.Windows)-1)
		}
		row.combo.HealthFit, row.combo.Score, row.combo.ShownDays = fit, score, maxDays
		scored = append(scored, row)
	}
	if len(scored) == 0 {
		report.Reason = "候选组合的营养贴合度都偏低或不满足本餐硬约束，不建议当作一餐"
		return report
	}
	for _, row := range selectMealCombos(scored, limit) {
		report.Combos = append(report.Combos, row.combo)
	}
	return report
}

func mealComboRowBefore(a, b mealComboRow) bool {
	if a.combo.HealthFit != b.combo.HealthFit {
		return a.combo.HealthFit > b.combo.HealthFit
	}
	return a.combo.Plan.SourceID < b.combo.Plan.SourceID
}

// Same shape as the single-dish selection: anchor the shortlist to the best
// remaining health fit, and only inside that band let variety decide. A dish,
// a canteen or a protein style already chosen counts against a later pick.
func selectMealCombos(rows []mealComboRow, limit int) []mealComboRow {
	chosen := make([]mealComboRow, 0, limit)
	taken := make([]bool, len(rows))
	for len(chosen) < limit {
		maxHealth := math.Inf(-1)
		for i, row := range rows {
			if !taken[i] {
				maxHealth = math.Max(maxHealth, row.combo.HealthFit)
			}
		}
		if math.IsInf(maxHealth, -1) {
			break
		}
		best, bestScore := -1, math.Inf(-1)
		for i, row := range rows {
			if taken[i] || row.combo.HealthFit < maxHealth-mealHealthShortlistTolerance {
				continue
			}
			score := row.combo.Score
			for _, prior := range chosen {
				score -= mealComboDishRepeatPenalty * float64(mealComboSharedDishes(row.dishes, prior.dishes))
				if row.place == prior.place {
					score -= mealComboSameVenuePenalty
				}
				if row.family != "" && row.family == prior.family {
					score -= mealComboSameFamilyPenalty
				}
			}
			if best < 0 || score > bestScore || score == bestScore && mealComboRowBefore(row, rows[best]) {
				best, bestScore = i, score
			}
		}
		if best < 0 {
			break
		}
		taken[best] = true
		chosen = append(chosen, rows[best])
	}
	return chosen
}
