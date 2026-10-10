package service

import (
	"math"
	"sort"
	"strings"

	"food_link/backend/internal/health/domain"
)

const dietDecisionEngineVersion = "foodlink-diet-decision-v3"
const dietDecisionLegacyVersion = "foodlink-diet-decision-v2.1"

const (
	dietDecisionRoleHealth   = "health_goal"
	dietDecisionRoleEasy     = "easy_to_follow"
	dietDecisionRoleBalanced = "balanced_best"
)

type DietDecisionScorecard struct {
	Version         string               `json:"version,omitempty"`
	MacroFit        float64              `json:"macro_fit,omitempty"`
	NutrientLoss    float64              `json:"nutrient_plan_loss,omitempty"`
	NutrientEffects []DietNutrientEffect `json:"nutrient_effects,omitempty"`
	ComparedKeys    []string             `json:"compared_nutrients,omitempty"`
	HealthFit       float64              `json:"health_fit"`
	Adherence       float64              `json:"adherence"`
	Confidence      float64              `json:"confidence"`
	RiskPenalty     float64              `json:"risk_penalty"`
	BalancedUtility float64              `json:"balanced_utility"`
}

type dietDecisionContext struct {
	RecentFoods     []mealFoodFrequency
	EngineVersion   string
	ComparisonKeys  []string
	MissingLoss     map[string]float64
	Basis           *DietDecisionBasis
	Goal            string
	MealType        string
	Current         DietRecommendationMacro
	Targets         DietRecommendationMacro
	Remaining       DietRecommendationMacro
	Constraints     CampusDietRecommendationConstraints
	Allergies       []string
	DietPreferences []string
}

type dietDecisionEvaluation struct {
	Candidate       DietRecommendationCandidate
	Scores          DietDecisionScorecard
	Feasible        bool
	Violations      []string
	MissingEvidence []string
}

type dietDecisionSelection struct {
	Role      string
	RoleLabel string
	Reason    string
	Eval      dietDecisionEvaluation
}

type dietDecisionGoalWeights struct {
	Calories float64
	Protein  float64
	Carbs    float64
	Fat      float64
}

func dietDecisionContextFromInput(input DietRecommendationInput) dietDecisionContext {
	return dietDecisionContext{
		EngineVersion: input.EngineVersion,
		Basis:         input.DecisionBasis,
		Goal:          dietRecommendationGoalContext(input),
		MealType:      input.MealType,
		Current:       input.Current,
		Targets:       input.Targets,
		Remaining:     input.MacroGaps,
	}
}

func dietDecisionContextFromCampusState(state *campusDietAgentRunState) dietDecisionContext {
	if state == nil {
		return dietDecisionContext{}
	}
	current := state.MealContext.Current
	remaining := state.MealContext.Remaining
	targets := state.MealContext.Targets
	goal := state.MealContext.UserGoal
	if state.MealContext.DecisionBasis != nil {
		for _, focus := range state.MealContext.DecisionBasis.Goals {
			// The current conversation may override the saved primary goal.
			if focus != state.MealContext.DecisionBasis.PrimaryGoal {
				goal += " " + focus
			}
		}
	}
	if targets.Calories <= 0 {
		targets = DietRecommendationMacro{Calories: current.Calories + remaining.Calories, Protein: current.Protein + remaining.Protein, Carbs: current.Carbs + remaining.Carbs, Fat: current.Fat + remaining.Fat}
	}
	return dietDecisionContext{
		Basis:           state.MealContext.DecisionBasis,
		RecentFoods:     state.PersonalContext.FoodFrequency,
		EngineVersion:   defaultIfEmpty(state.EngineVersion, state.MealContext.EngineVersion),
		Goal:            goal,
		MealType:        state.MealContext.MealType,
		Current:         current,
		Targets:         targets,
		Remaining:       remaining,
		Constraints:     state.Constraints,
		Allergies:       append([]string(nil), state.MealContext.Allergies...),
		DietPreferences: append([]string(nil), state.MealContext.DietPreferences...),
	}
}

func selectDietDecisionPortfolio(ctx dietDecisionContext, candidates []DietRecommendationCandidate) []dietDecisionSelection {
	if resolvedDietEngineVersion(ctx) == dietDecisionEngineVersion {
		return selectDietDecisionPortfolioV3(ctx, candidates)
	}
	evaluations := make([]dietDecisionEvaluation, 0, len(candidates))
	for _, candidate := range normalizeDietRecommendationCandidates(candidates) {
		evaluation := evaluateDietDecisionCandidate(ctx, candidate)
		if evaluation.Feasible {
			evaluations = append(evaluations, evaluation)
		}
	}
	if len(evaluations) == 0 {
		return nil
	}

	roles := []string{dietDecisionRoleHealth, dietDecisionRoleEasy, dietDecisionRoleBalanced}
	if len(evaluations) < len(roles) {
		roles = roles[:len(evaluations)]
	}
	indexes := bestDietDecisionAssignment(evaluations, roles)
	selections := make([]dietDecisionSelection, 0, len(indexes))
	for roleIndex, candidateIndex := range indexes {
		role := roles[roleIndex]
		selections = append(selections, dietDecisionSelection{
			Role:      role,
			RoleLabel: dietDecisionRoleLabel(role),
			Reason:    dietDecisionRoleReason(role),
			Eval:      evaluations[candidateIndex],
		})
	}
	return selections
}

func bestDietDecisionAssignment(evaluations []dietDecisionEvaluation, roles []string) []int {
	best := make([]int, 0, len(roles))
	bestScore := math.Inf(-1)
	used := make([]bool, len(evaluations))
	current := make([]int, 0, len(roles))
	var visit func(int, float64)
	visit = func(roleIndex int, score float64) {
		if roleIndex == len(roles) {
			if score > bestScore {
				bestScore = score
				best = append(best[:0], current...)
			}
			return
		}
		for candidateIndex := range evaluations {
			if used[candidateIndex] {
				continue
			}
			used[candidateIndex] = true
			current = append(current, candidateIndex)
			visit(roleIndex+1, score+dietDecisionRoleScore(roles[roleIndex], evaluations[candidateIndex].Scores))
			current = current[:len(current)-1]
			used[candidateIndex] = false
		}
	}
	visit(0, 0)
	return best
}

// V2.1 is deliberately preserved, including its original weights and heuristics.
func evaluateDietDecisionCandidateV21(ctx dietDecisionContext, candidate DietRecommendationCandidate) dietDecisionEvaluation {
	violations := dietDecisionConstraintViolations(ctx, candidate)
	missingEvidence := make([]string, 0, 3)
	if len(ctx.Allergies) > 0 && len(candidate.Items) == 0 {
		missingEvidence = append(missingEvidence, "配料信息不足，无法完整核对过敏原")
	}
	if ctx.Constraints.MaxPrice != nil && candidate.Price <= 0 {
		missingEvidence = append(missingEvidence, "价格未记录")
	}
	if candidate.CanteenName == "" {
		missingEvidence = append(missingEvidence, "食堂位置不完整")
	}

	confidence := dietDecisionConfidence(candidate)
	health := dietDecisionHealthFit(ctx, candidate)
	adherence := dietDecisionAdherence(ctx, candidate, confidence)
	riskPenalty := dietDecisionRiskPenalty(ctx, candidate, missingEvidence)
	balanced := clampDecisionScore(health*0.55 + adherence*0.30 + confidence*0.15 - riskPenalty)
	patternBonus, _ := dietPatternBonus(ctx.Basis, candidate)
	balanced = clampDecisionScore(balanced + patternBonus)
	return dietDecisionEvaluation{
		Candidate: candidate,
		Scores: DietDecisionScorecard{
			Version:         dietDecisionLegacyVersion,
			HealthFit:       roundDietNumber(health),
			Adherence:       roundDietNumber(adherence),
			Confidence:      roundDietNumber(confidence),
			RiskPenalty:     roundDietNumber(riskPenalty),
			BalancedUtility: roundDietNumber(balanced),
		},
		Feasible:        len(violations) == 0,
		Violations:      violations,
		MissingEvidence: missingEvidence,
	}
}

func dietDecisionConstraintViolations(ctx dietDecisionContext, candidate DietRecommendationCandidate) []string {
	violations := make([]string, 0, 5)
	constraints := ctx.Constraints
	if constraints.MaxCalories != nil && *constraints.MaxCalories > 0 && candidate.Calories > *constraints.MaxCalories {
		violations = append(violations, "超过本餐热量上限")
	}
	if constraints.MinProtein != nil && *constraints.MinProtein > 0 && candidate.Protein < *constraints.MinProtein {
		violations = append(violations, "未达到蛋白质下限")
	}
	if constraints.MaxFat != nil && *constraints.MaxFat > 0 && candidate.Fat > *constraints.MaxFat {
		violations = append(violations, "超过脂肪上限")
	}
	if constraints.MaxPrice != nil && *constraints.MaxPrice > 0 {
		if candidate.Price <= 0 {
			violations = append(violations, "价格未知，无法确认预算约束")
		} else if candidate.Price > *constraints.MaxPrice {
			violations = append(violations, "超过预算上限")
		}
	}
	if allergen := matchedDietDecisionAllergen(ctx.Allergies, candidate); allergen != "" {
		violations = append(violations, "命中已知过敏原："+allergen)
	}
	return violations
}

func dietDecisionHealthFit(ctx dietDecisionContext, candidate DietRecommendationCandidate) float64 {
	ratio := dietDecisionMealRatio(ctx.MealType)
	calorieTarget := dietDecisionMealTarget(ctx.Remaining.Calories, ctx.Targets.Calories, ratio)
	proteinTarget := dietDecisionMealTarget(ctx.Remaining.Protein, ctx.Targets.Protein, ratio)
	carbTarget := dietDecisionMealTarget(ctx.Remaining.Carbs, ctx.Targets.Carbs, ratio)
	fatLimit, remainingFat := ctx.Targets.Fat, ctx.Remaining.Fat
	if ctx.Basis != nil && ctx.Basis.FatMax > 0 {
		fatLimit = ctx.Basis.FatMax
		remainingFat = math.Max(0, fatLimit-ctx.Current.Fat)
	}
	fatTarget := dietDecisionMealTarget(remainingFat, fatLimit, ratio)

	calorieFit := dietDecisionIntervalFit(candidate.Calories, calorieTarget, ctx.Targets.Calories*ratio, 0.70, 1.15, 1.2)
	proteinFit := dietDecisionIntervalFit(candidate.Protein, proteinTarget, ctx.Targets.Protein*ratio, 0.75, 1.60, 0.25)
	carbFit := dietDecisionIntervalFit(candidate.Carbs, carbTarget, ctx.Targets.Carbs*ratio, 0.55, 1.35, 0.8)
	fatFit := dietDecisionUpperFit(candidate.Fat, fatTarget, fatLimit*ratio)
	weights := dietDecisionWeights(ctx.Goal)
	return clampDecisionScore(
		calorieFit*weights.Calories +
			proteinFit*weights.Protein +
			carbFit*weights.Carbs +
			fatFit*weights.Fat,
	)
}

func dietDecisionAdherence(ctx dietDecisionContext, candidate DietRecommendationCandidate, confidence float64) float64 {
	priceScore := 70.0
	if ctx.Constraints.MaxPrice != nil && *ctx.Constraints.MaxPrice > 0 && candidate.Price > 0 {
		priceScore = clampDecisionScore(100 - candidate.Price / *ctx.Constraints.MaxPrice * 40)
	} else if candidate.Price > 0 {
		priceScore = 80
	} else {
		priceScore = 55
	}

	locationScore := 40.0
	if candidate.SchoolID != "" || candidate.SchoolName != "" {
		locationScore = 65
	}
	if candidate.CanteenName != "" {
		locationScore = 90
	}
	if candidate.WindowName != "" {
		locationScore = 100
	}

	preferenceScore := 70.0
	if len(ctx.DietPreferences) > 0 {
		preferenceScore = 55
		candidateText := normalizedDietDecisionCandidateText(candidate)
		for _, preference := range ctx.DietPreferences {
			if normalized := normalizeDietDecisionToken(preference); normalized != "" && strings.Contains(candidateText, normalized) {
				preferenceScore = 100
				break
			}
		}
	}

	simplicityScore := 55.0
	if len(candidate.Items) > 0 && len(candidate.Items) <= 4 {
		simplicityScore = 88
	} else if len(candidate.Items) > 4 {
		simplicityScore = 70
	}
	return clampDecisionScore(priceScore*0.30 + locationScore*0.25 + confidence*0.20 + preferenceScore*0.15 + simplicityScore*0.10)
}

func dietDecisionConfidence(candidate DietRecommendationCandidate) float64 {
	if candidate.WeightConfidence > 0 {
		return clampDecisionScore(50 + clampDecisionUnit(candidate.WeightConfidence)*50)
	}
	switch strings.TrimSpace(candidate.NutritionBasis) {
	case "nutrition_label":
		return 95
	case "library_record":
		return 90
	case "library_estimate":
		return 65
	}
	if candidate.Source == "public_food_library" {
		return 78
	}
	return 60
}

func dietDecisionRiskPenalty(ctx dietDecisionContext, candidate DietRecommendationCandidate, missingEvidence []string) float64 {
	penalty := 0.0
	switch strings.ToLower(strings.TrimSpace(candidate.UncertaintyLevel)) {
	case "high":
		penalty += 16
	case "medium":
		penalty += 8
	}
	if len(ctx.Allergies) > 0 && len(candidate.Items) == 0 {
		penalty += 18
	}
	if ctx.Constraints.MaxPrice != nil && candidate.Price <= 0 {
		penalty += 12
	}
	if len(missingEvidence) >= 3 {
		penalty += 4
	}
	return math.Min(40, penalty)
}

func dietDecisionWeights(goal string) dietDecisionGoalWeights {
	normalized := strings.ToLower(strings.TrimSpace(goal))
	strength := containsAnyText(normalized, "增肌", "长肌肉", "muscle_gain", "力量", "抗阻")
	loss := containsAnyText(normalized, "减脂", "减肥", "控脂", "fat_loss")
	switch {
	case strength && loss:
		return dietDecisionGoalWeights{Calories: 0.30, Protein: 0.40, Carbs: 0.15, Fat: 0.15}
	case strength:
		return dietDecisionGoalWeights{Calories: 0.20, Protein: 0.45, Carbs: 0.25, Fat: 0.10}
	case loss:
		return dietDecisionGoalWeights{Calories: 0.35, Protein: 0.35, Carbs: 0.10, Fat: 0.20}
	default:
		return dietDecisionGoalWeights{Calories: 0.30, Protein: 0.30, Carbs: 0.20, Fat: 0.20}
	}
}

func dietDecisionMealRatio(mealType string) float64 {
	switch strings.TrimSpace(mealType) {
	case "breakfast":
		return 0.25
	case "lunch":
		return 0.35
	case "dinner":
		return 0.30
	default:
		return 0.30
	}
}

func dietDecisionMealTarget(remaining, dailyTarget, ratio float64) float64 {
	if remaining <= 0 {
		return 0
	}
	if dailyTarget <= 0 {
		return remaining
	}
	return math.Min(remaining, dailyTarget*ratio)
}

func dietDecisionIntervalFit(value, target, zeroScale, lowerRatio, upperRatio, overshootWeight float64) float64 {
	value = math.Max(0, value)
	if target <= 0 {
		if value <= 0 {
			return 100
		}
		if zeroScale <= 0 {
			return 50
		}
		return clampDecisionScore(100 - value/zeroScale*100*overshootWeight)
	}
	lower := target * lowerRatio
	upper := target * upperRatio
	if value < lower {
		return clampDecisionScore(100 - (lower-value)/math.Max(lower, 1)*100)
	}
	if value > upper {
		return clampDecisionScore(100 - (value-upper)/math.Max(upper, 1)*100*overshootWeight)
	}
	return 100
}

func dietDecisionUpperFit(value, target, zeroScale float64) float64 {
	value = math.Max(0, value)
	if target <= 0 {
		if zeroScale <= 0 {
			return 60
		}
		return clampDecisionScore(100 - value/math.Max(zeroScale, 1)*120)
	}
	if value <= target {
		return 100
	}
	return clampDecisionScore(100 - (value-target)/math.Max(target, 1)*120)
}

func matchedDietDecisionAllergen(allergies []string, candidate DietRecommendationCandidate) string {
	text := normalizedDietDecisionCandidateText(candidate)
	for _, allergy := range allergies {
		normalized := normalizeDietDecisionToken(allergy)
		if normalized == "" {
			continue
		}
		terms := append([]string{normalized}, dietDecisionAllergenAliases(normalized)...)
		for _, term := range terms {
			if term != "" && strings.Contains(text, term) {
				return strings.TrimSpace(allergy)
			}
		}
	}
	return ""
}

func dietDecisionAllergenAliases(normalized string) []string {
	switch normalized {
	case "spicy", "辛辣", "辣":
		return []string{"辣", "生椒", "spicy"}
	case "花生", "peanut", "peanuts":
		return []string{"花生", "peanut", "peanuts"}
	case "牛奶", "乳制品", "奶制品", "milk", "dairy":
		return []string{"牛奶", "奶油", "奶酪", "芝士", "乳粉", "milk", "dairy"}
	case "鸡蛋", "蛋类", "egg", "eggs":
		return []string{"鸡蛋", "蛋液", "egg", "eggs"}
	case "海鲜", "seafood":
		return []string{"虾", "蟹", "贝", "鱼", "鱿", "章鱼", "蛤", "蚝", "蚬", "海鲜", "seafood", "shellfish"}
	case "甲壳类", "shellfish":
		return []string{"虾", "蟹", "贝", "蛤", "蚝", "蚬", "shellfish"}
	case "坚果", "nuts":
		return []string{"坚果", "核桃", "腰果", "杏仁", "nuts"}
	case "大豆", "黄豆", "soy":
		return []string{"大豆", "黄豆", "豆浆", "豆腐", "soy"}
	}
	return nil
}

func normalizedDietDecisionCandidateText(candidate domain.DietRecommendationCandidate) string {
	parts := []string{candidate.Title, candidate.Description}
	for _, item := range candidate.Items {
		parts = append(parts, item.Name)
	}
	return normalizeDietDecisionToken(strings.Join(parts, " "))
}

func normalizeDietDecisionToken(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.NewReplacer(" ", "", "　", "", "-", "", "_", "").Replace(value)
	return value
}

func dietDecisionRoleScore(role string, scores DietDecisionScorecard) float64 {
	if scores.Version == dietDecisionEngineVersion {
		return scores.HealthFit
	}
	switch role {
	case dietDecisionRoleHealth:
		return scores.HealthFit
	case dietDecisionRoleEasy:
		return scores.Adherence
	default:
		return scores.BalancedUtility
	}
}

func dietDecisionRoleLabel(role string) string {
	switch role {
	case dietDecisionRoleHealth:
		return "最符合健康目标"
	case dietDecisionRoleEasy:
		return "最容易坚持"
	default:
		return "综合最优"
	}
}

func dietDecisionRoleReason(role string) string {
	switch role {
	case dietDecisionRoleHealth:
		return "按当前这餐的热量和营养缺口计算，这是健康目标匹配度更高的选择。"
	case dietDecisionRoleEasy:
		return "综合价格、食堂位置、点餐复杂度和数据可信度，这是更容易真正执行的选择。"
	default:
		return "综合营养匹配、执行难度、数据可信度和不确定性，这是当前的均衡选择。"
	}
}

func decorateDietDecisionOption(option *DietRecommendationOption, selection dietDecisionSelection) {
	if option == nil {
		return
	}
	option.DecisionRole = selection.Role
	option.DecisionLabel = selection.RoleLabel
	option.DecisionScore = roundDietNumber(dietDecisionRoleScore(selection.Role, selection.Eval.Scores))
	option.DecisionScores = &selection.Eval.Scores
	option.DecisionMissingEvidence = append([]string(nil), selection.Eval.MissingEvidence...)
	if strings.TrimSpace(option.Reason) == "" {
		option.Reason = selection.Reason
	}
}

func dietDecisionPresentedMeta(result *DietRecommendationResult) map[string]any {
	if result == nil || result.DecisionEngineVersion == "" || len(result.Recommendations) == 0 {
		return nil
	}
	options := make([]map[string]any, 0, len(result.Recommendations))
	for _, option := range result.Recommendations {
		options = append(options, map[string]any{
			"source_id": option.SourceID,
			"role":      option.DecisionRole,
			"label":     option.DecisionLabel,
			"score":     option.DecisionScore,
			"scores":    option.DecisionScores,
		})
	}
	return map[string]any{
		"event":   "presented",
		"version": result.DecisionEngineVersion,
		"options": options,
	}
}

func rankDietDecisionEvaluations(ctx dietDecisionContext, candidates []DietRecommendationCandidate) []dietDecisionEvaluation {
	ctx = prepareDietDecisionComparison(ctx, candidates)
	out := make([]dietDecisionEvaluation, 0, len(candidates))
	for _, candidate := range normalizeDietRecommendationCandidates(candidates) {
		evaluation := evaluateDietDecisionCandidate(ctx, candidate)
		if evaluation.Feasible {
			out = append(out, evaluation)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if resolvedDietEngineVersion(ctx) == dietDecisionEngineVersion {
			return dietDecisionBetter(out[i], out[j], out[i].Scores.Adherence, out[j].Scores.Adherence)
		}
		return out[i].Scores.BalancedUtility > out[j].Scores.BalancedUtility
	})
	return out
}

func clampDecisionScore(value float64) float64 {
	return math.Max(0, math.Min(100, value))
}

func clampDecisionUnit(value float64) float64 {
	return math.Max(0, math.Min(1, value))
}
