package service

import (
	"fmt"
	"food_link/backend/internal/nutritionagg"
	"math"
	"sort"
	"strings"
)

type DietNutrientEffect struct {
	Key            string   `json:"key"`
	Unit           string   `json:"unit"`
	Status         string   `json:"status"`
	Mode           string   `json:"mode"`
	KnownSubtotal  float64  `json:"known_subtotal"`
	CandidateValue *float64 `json:"candidate_value,omitempty"`
	Target         float64  `json:"plan_target,omitempty"`
	Limit          float64  `json:"plan_limit,omitempty"`
	BeforeLoss     float64  `json:"before_plan_loss"`
	AfterLoss      float64  `json:"after_plan_loss"`
	Improvement    float64  `json:"plan_improvement"`
	ReferenceType  string   `json:"reference_type"`
	SourceID       string   `json:"source_id"`
}

func normalizeDietEngineVersion(version string) (string, error) {
	switch strings.TrimSpace(version) {
	case "", "v3", dietDecisionEngineVersion:
		return dietDecisionEngineVersion, nil
	case "v2.1", dietDecisionLegacyVersion:
		return dietDecisionLegacyVersion, nil
	default:
		return "", fmt.Errorf("不支持的饮食决策版本")
	}
}

func (s *StatsService) defaultDietEngineVersion() string {
	if s.cfg != nil {
		if version, err := normalizeDietEngineVersion(s.cfg.App.DietDecisionVersion); err == nil {
			return version
		}
	}
	return dietDecisionEngineVersion
}

func resolvedDietEngineVersion(ctx dietDecisionContext) string {
	// Context-free legacy callers and the original V1 contracts keep their
	// original math. Production entry points explicitly select their version.
	if ctx.EngineVersion == "" && ctx.Basis == nil {
		return dietDecisionLegacyVersion
	}
	version, _ := normalizeDietEngineVersion(ctx.EngineVersion)
	return version
}

func evaluateDietDecisionCandidate(ctx dietDecisionContext, candidate DietRecommendationCandidate) dietDecisionEvaluation {
	if resolvedDietEngineVersion(ctx) == dietDecisionLegacyVersion {
		return evaluateDietDecisionCandidateV21(ctx, candidate)
	}
	return evaluateDietDecisionCandidateV3(ctx, candidate)
}

func v3IntervalLoss(value, target float64, lower, upper float64) float64 {
	if target <= 0 {
		return math.Min(2, value/100)
	}
	if value < target*lower {
		return math.Pow((target*lower-value)/math.Max(target*lower, 1), 2)
	}
	if value > target*upper {
		return math.Min(2, math.Pow((value-target*upper)/math.Max(target, 1), 2))
	}
	return 0
}

func v3MacroFit(ctx dietDecisionContext, c DietRecommendationCandidate) float64 {
	if c.Calories <= 0 || math.IsNaN(c.Calories) || math.IsInf(c.Calories, 0) {
		return 0
	}
	ratio := dietDecisionMealRatio(ctx.MealType)
	calories := dietDecisionMealTarget(ctx.Remaining.Calories, ctx.Targets.Calories, ratio)
	protein := dietDecisionMealTarget(ctx.Remaining.Protein, ctx.Targets.Protein, ratio)
	carbs := dietDecisionMealTarget(ctx.Remaining.Carbs, ctx.Targets.Carbs, ratio)
	fat := dietDecisionMealTarget(ctx.Remaining.Fat, ctx.Targets.Fat, ratio)
	loss := v3IntervalLoss(c.Calories, calories, .75, 1.20) * 2
	loss += v3IntervalLoss(c.Protein, protein, .75, 1.60)
	loss += v3IntervalLoss(c.Carbs, carbs, .55, 1.35)
	if fat > 0 {
		loss += v3IntervalLoss(c.Fat, fat, .4, 1.3)
	} else {
		loss += math.Min(2, c.Fat/math.Max(1, ctx.Targets.Fat*ratio))
	}
	return clampDecisionScore(100 - loss/5*100)
}

func nutrientPlanEffect(ctx dietDecisionContext, c DietRecommendationCandidate, rule DietNutrientRule) DietNutrientEffect {
	e := DietNutrientEffect{Key: rule.Key, Unit: rule.Unit, Target: rule.Target, Limit: rule.Limit, ReferenceType: rule.ReferenceType, SourceID: rule.SourceID, Status: "missing", Mode: "not_comparable"}
	state := ctx.Basis.NutrientState
	current := state.Current[rule.Key]
	e.KnownSubtotal = current.Value
	value := c.Nutrients[rule.Key]
	if !value.Complete() || value.Unit != rule.Unit {
		return e
	}
	e.Status, e.CandidateValue = value.Status, &value.Value
	// No recorded meal is not proof of no intake. Compare a bounded serving
	// share, not a fabricated full-day zero or a requirement to catch up today.
	target := rule.Target
	limit := rule.Limit
	before := current.Value
	if state.RecordedMeals == 0 {
		e.Mode, before = "serving_share_no_day_total", 0
		target *= dietDecisionMealRatio(ctx.MealType)
		limit *= dietDecisionMealRatio(ctx.MealType)
	} else if current.Complete() {
		e.Mode = "recorded_subtotal_not_complete_day"
	} else {
		e.Mode = "serving_share_partial_intake_no_day_total"
		target *= dietDecisionMealRatio(ctx.MealType)
		limit *= dietDecisionMealRatio(ctx.MealType)
	}
	adequacyBefore := before
	if e.Mode == "serving_share_partial_intake_no_day_total" {
		adequacyBefore = 0
	}
	if target > 0 {
		e.BeforeLoss = math.Pow(math.Max(0, (target-adequacyBefore)/target), 2)
		e.AfterLoss = math.Pow(math.Max(0, (target-adequacyBefore-value.Value)/target), 2)
	}
	e.Target, e.Limit = target, limit
	if limit > 0 {
		// For incomplete intake, compare the meal share and the known daily
		// lower bound independently. Partial intake is never a full-day zero.
		limitBefore := before
		if e.Mode == "serving_share_partial_intake_no_day_total" {
			limitBefore = 0
		}
		e.BeforeLoss += math.Pow(math.Max(0, (limitBefore-limit)/limit), 2)
		e.AfterLoss += math.Pow(math.Max(0, (limitBefore+value.Value-limit)/limit), 2)
		if e.Mode == "serving_share_partial_intake_no_day_total" {
			e.AfterLoss = math.Max(e.AfterLoss, math.Pow(math.Max(0, (before+value.Value-rule.Limit)/rule.Limit), 2))
		}
	}
	e.BeforeLoss = math.Min(2, e.BeforeLoss)
	e.AfterLoss = math.Min(2, e.AfterLoss)
	e.Improvement = e.BeforeLoss - e.AfterLoss
	return e
}

// A pool establishes one comparison basis. Missing nutrients get no favourable
// credit and at least the worst observed plan loss for that key; this is a
// conservative ranking bound, NOT an invented nutrient amount or clinical risk.
func prepareDietDecisionComparison(ctx dietDecisionContext, candidates []DietRecommendationCandidate) dietDecisionContext {
	ctx.ComparisonKeys, ctx.MissingLoss = nil, map[string]float64{}
	if resolvedDietEngineVersion(ctx) != dietDecisionEngineVersion || ctx.Basis == nil || ctx.Basis.NutrientState == nil {
		return ctx
	}
	for _, rule := range ctx.Basis.NutrientState.Rules {
		available, worst := false, 0.0
		for _, c := range candidates {
			if len(dietDecisionConstraintViolations(ctx, c)) > 0 {
				continue
			}
			effect := nutrientPlanEffect(ctx, c, rule)
			if effect.CandidateValue == nil {
				continue
			}
			available = true
			worst = math.Max(worst, math.Max(effect.BeforeLoss, effect.AfterLoss))
		}
		if available {
			ctx.ComparisonKeys = append(ctx.ComparisonKeys, rule.Key)
			ctx.MissingLoss[rule.Key] = worst
		}
	}
	return ctx
}

func evaluateDietDecisionCandidateV3(ctx dietDecisionContext, c DietRecommendationCandidate) dietDecisionEvaluation {
	e := evaluateDietDecisionCandidateV21(ctx, c)
	for _, value := range []float64{c.Calories, c.Protein, c.Carbs, c.Fat} {
		if value < 0 || math.IsNaN(value) || math.IsInf(value, 0) {
			e.Feasible = false
			e.Violations = append(e.Violations, "营养数值无效")
			e.Scores = DietDecisionScorecard{Version: dietDecisionEngineVersion}
			return e
		}
	}
	e.Scores.Version = dietDecisionEngineVersion
	e.Scores.MacroFit = v3MacroFit(ctx, c)
	nutrientLoss := 0.0
	if ctx.Basis != nil && ctx.Basis.NutrientState != nil {
		if ctx.ComparisonKeys == nil {
			ctx = prepareDietDecisionComparison(ctx, []DietRecommendationCandidate{c})
		}
		for _, rule := range ctx.Basis.NutrientState.Rules {
			active := false
			for _, key := range ctx.ComparisonKeys {
				active = active || key == rule.Key
			}
			if !active {
				continue
			}
			effect := nutrientPlanEffect(ctx, c, rule)
			if effect.CandidateValue == nil {
				effect.Mode = "missing_no_credit_conservative_comparison_bound"
				effect.AfterLoss = ctx.MissingLoss[rule.Key]
				e.MissingEvidence = append(e.MissingEvidence, rule.Key+"含量未知/不完整，不按零计算")
			}
			nutrientLoss += effect.AfterLoss
			e.Scores.NutrientEffects = append(e.Scores.NutrientEffects, effect)
		}
	}
	e.Scores.ComparedKeys = ctx.ComparisonKeys
	if len(ctx.ComparisonKeys) > 0 {
		nutrientLoss /= float64(len(ctx.ComparisonKeys))
	}
	e.Scores.NutrientLoss = nutrientLoss
	// Equal category budgets avoid multiplying the reward simply by adding
	// several highly correlated nutrients. These are versioned engineering
	// weights, not a validated disease-risk or personal-health score.
	health := e.Scores.MacroFit
	if len(ctx.ComparisonKeys) > 0 {
		health = .6*health + .4*clampDecisionScore(100-100*nutrientLoss)
	}
	bonus, _ := dietPatternBonus(ctx.Basis, c)
	e.Scores.HealthFit = roundDietNumber(clampDecisionScore(health + bonus))
	// Prices/preferences/confidence never offset nutritional loss in V3.
	e.Scores.BalancedUtility = e.Scores.HealthFit
	if len(ctx.ComparisonKeys) == 0 {
		e.MissingEvidence = append(e.MissingEvidence, "本轮缺少可比较的微量营养数值，未宣称微量最优")
	}
	return e
}

// Keep the comparison transitive: rounded health first, evidence next, ease
// last. No uncalibrated epsilon is used to trade away a known health difference.
func dietDecisionBetter(a, b dietDecisionEvaluation, easeA, easeB float64) bool {
	if a.Scores.HealthFit != b.Scores.HealthFit {
		return a.Scores.HealthFit > b.Scores.HealthFit
	}
	known := func(e dietDecisionEvaluation) int {
		n := 0
		for _, effect := range e.Scores.NutrientEffects {
			if effect.CandidateValue != nil {
				n++
			}
		}
		return n
	}
	if known(a) != known(b) {
		return known(a) > known(b)
	}
	if easeA != easeB {
		return easeA > easeB
	}
	if a.Candidate.SourceID != b.Candidate.SourceID {
		return a.Candidate.SourceID < b.Candidate.SourceID
	}
	return a.Candidate.Source < b.Candidate.Source
}

func selectDietDecisionPortfolioV3(ctx dietDecisionContext, candidates []DietRecommendationCandidate) []dietDecisionSelection {
	ctx = prepareDietDecisionComparison(ctx, candidates)
	evaluations := []dietDecisionEvaluation{}
	for _, c := range normalizeDietRecommendationCandidates(candidates) {
		e := evaluateDietDecisionCandidate(ctx, c)
		if e.Feasible {
			evaluations = append(evaluations, e)
		}
	}
	sort.SliceStable(evaluations, func(i, j int) bool {
		return dietDecisionBetter(evaluations[i], evaluations[j], evaluations[i].Scores.Adherence, evaluations[j].Scores.Adherence)
	})
	roles := []string{dietDecisionRoleHealth, "nutrition_alternative", "nutrition_alternative"}
	out := []dietDecisionSelection{}
	pool := []groundedMeal{}
	for _, e := range evaluations {
		score := e.Scores.HealthFit
		for _, f := range ctx.RecentFoods {
			if f.RecentCount > 0 && strings.Contains(normalizedDietDecisionCandidateText(e.Candidate), normalizeDietDecisionToken(f.Name)) {
				score -= math.Min(18, float64(f.RecentCount)*6)
			}
		}
		pool = append(pool, groundedMeal{candidate: e.Candidate, evaluation: e, score: score})
	}
	for _, meal := range selectHealthBoundedMeals(pool, len(roles)) {
		e := meal.evaluation
		i := len(out)
		label := "营养备选"
		if i == 0 {
			label = "健康优先，兼顾多样"
		}
		out = append(out, dietDecisionSelection{Role: roles[i], RoleLabel: label, Reason: dietDecisionV3Reason(e), Eval: e})
	}
	return out
}

// EvaluateDietDecisionCandidates is the same pure evaluator used by the app,
// exposed to deterministic diagnostic/replay tools without model calls.
func EvaluateDietDecisionCandidates(input DietRecommendationInput, candidates []DietRecommendationCandidate) []dietDecisionEvaluation {
	return rankDietDecisionEvaluations(dietDecisionContextFromInput(input), candidates)
}

func dietDecisionV3Reason(e dietDecisionEvaluation) string {
	labelFor := func(key string) string {
		for _, definition := range nutritionagg.Definitions {
			if definition.Key == key {
				return definition.Label
			}
		}
		return key
	}
	reason := "先核对本餐条件，再按营养计划适配优先比较；未知营养不按零计算。"
	warning := ""
	for _, effect := range e.Scores.NutrientEffects {
		if effect.CandidateValue != nil && effect.Limit > 0 && effect.AfterLoss > .05 {
			warning = "其中" + labelFor(effect.Key) + "仍高于本次规划参考，并非所有营养维度都达标。"
		}
		if effect.CandidateValue != nil && effect.Improvement > .05 {
			reason = "结合已记录摄入与本餐份量，改善" + labelFor(effect.Key) + "的营养计划适配；不代表身体指标已经改善。"
		}
	}
	return reason + warning
}
