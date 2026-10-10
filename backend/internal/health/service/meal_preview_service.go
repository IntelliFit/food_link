package service

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/nutritionagg"
	"food_link/backend/pkg/logger"
)

const hybridMealVersion = "foodlink-grounded-meals-v2"

// Preview never creates intake or paid user tasks. Bounded model arbitration
// may refine the shortlist; it never changes points or writes food records.
// Issued option IDs are saved
// for authenticated feedback; an issued option is not counted as an impression.
type MealPreviewInput struct {
	RadiusKM         float64              `json:"radius_km,omitempty"`
	SchoolNames      []string             `json:"school_names,omitempty"`
	EngineVersion    string               `json:"engine_version,omitempty"`
	MealType         string               `json:"meal_type"`
	Location         *domain.DietLocation `json:"location,omitempty"`
	ExcludeSourceIDs []string             `json:"exclude_source_ids,omitempty"`
}

func (s *StatsService) PreviewMeals(ctx context.Context, userID string, input MealPreviewInput) (*DietRecommendationResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	if strings.TrimSpace(userID) == "" {
		return nil, fmt.Errorf("请先登录")
	}
	if len(input.ExcludeSourceIDs) > 60 {
		return nil, commonerrors.ErrBadRequest
	}
	if math.IsNaN(input.RadiusKM) || math.IsInf(input.RadiusKM, 0) || input.RadiusKM < 0 || input.RadiusKM > 10 {
		return nil, commonerrors.ErrBadRequest
	}
	for _, id := range input.ExcludeSourceIDs {
		if len(id) > 256 {
			return nil, commonerrors.ErrBadRequest
		}
	}
	state := &campusDietAgentRunState{UserID: userID, Intent: "initial", Question: "下一餐吃什么", Location: input.Location, IsHomePreview: true, ExcludedSourceIDs: input.ExcludeSourceIDs}
	state.Constraints.RadiusKM = input.RadiusKM
	if state.Constraints.RadiusKM == 0 {
		state.Constraints.RadiusKM = 5
	}
	state.EngineVersion = s.defaultDietEngineVersion()
	if input.EngineVersion != "" {
		var err error
		state.EngineVersion, err = normalizeDietEngineVersion(input.EngineVersion)
		if err != nil {
			return nil, commonerrors.ErrBadRequest
		}
	}
	if len(input.ExcludeSourceIDs) > 0 {
		state.Intent = "more"
	}
	if profile, err := s.repo.GetUserProfile(ctx, userID); err == nil {
		if school, campusID, campusName := studentDiningPreference(profile); school != nil {
			state.School = *school
			state.CampusID = campusID
			state.CampusName = campusName
		}
	}
	if slices.Contains([]string{"breakfast", "lunch", "dinner"}, input.MealType) {
		state.Constraints.MealType = input.MealType
	}
	if err := s.resolvePreviewSchools(ctx, state, input.SchoolNames); err != nil {
		return nil, err
	}
	return s.hybridMealRecommendation(ctx, state)
}

func mealHistoryQuestion(q string) bool {
	return regexp.MustCompile(`历史.*(?:餐|吃|饮食|记录)|过去.*(?:吃|餐|记录)|吃过|记录过的餐|本人.*餐|记录(?:里|中)|核对.{0,6}日期`).MatchString(q)
}

type groundedMeal struct {
	recentRepeat   bool
	varietyPenalty float64
	plan           *MealDayPlan
	venuePenalty   float64
	evaluation     dietDecisionEvaluation
	candidate      DietRecommendationCandidate
	date           string
	score          float64
}

func (s *StatsService) hybridMealRecommendation(ctx context.Context, state *campusDietAgentRunState) (*DietRecommendationResult, error) {
	locationNow := mealDecisionNow(state)
	if state.ReadOnlyReplay {
		// Replay uses today's catalog and an explicitly supplied current test
		// origin, not a claim that the user was there at the intake cutoff.
		locationNow = time.Now()
	}
	if !state.Location.Valid(locationNow) {
		state.Location = nil
	}
	if err := s.loadMealHarnessContext(ctx, state); err != nil {
		return nil, err
	}
	if state.IsHomePreview && !state.ReadOnlyReplay {
		s.loadMealPreviewMemory(ctx, state)
	}
	if state.ReadOnlyReplay {
		state.PreviewContextKey = mealPreviewContextKey(state)
	}
	state.ToolCount++
	state.ToolTrace = append(state.ToolTrace, CampusDietAgentToolTrace{ToolName: "retrieve_personal_meals", Status: "success", ResultCount: len(state.HistoryRecords)})
	result := &DietRecommendationResult{HarnessVersion: mealHarnessVersion, GeneratedBy: hybridMealVersion, Scene: "eat_out", Title: "下一餐，选一份就好", SearchScope: "history", Recommendations: []DietRecommendationOption{}, AgentConstraints: &state.Constraints, ContextSummary: mealHarnessContextSummary(state), CalorieRemaining: state.MealContext.Remaining.Calories, MacroGaps: state.MealContext.Remaining}
	result.DataNotes = []string{"历史份量和营养来自本人记录，并非当前商家报价或在售证明；记录不完整时营养余量也可能不完整。"}
	result.DecisionEngineVersion = state.EngineVersion
	if state.EngineVersion == dietDecisionEngineVersion {
		result.SelectionPolicyVersion = dietMealSelectionPolicyVersion
	}
	result.DecisionBasis = state.MealContext.DecisionBasis
	if state.MealContext.MealType == "breakfast" {
		result.DataNotes = append(result.DataNotes, "早餐按原记录餐次或菜单名称线索筛选，不代表已核实早餐营业；未把普通午晚餐仅凭营养分当成早餐。")
	}
	if len(state.MealContext.Allergies) > 0 {
		result.DataNotes = append(result.DataNotes, "已排除记录中命中的过敏原，但未核实全部配料和交叉接触；曾经吃过不代表过敏安全。")
	}
	if areaRepo, ok := s.repo.(interface {
		LatestMealArea(context.Context, string) (*domain.MealArea, error)
	}); ok && !state.ReadOnlyReplay {
		area, err := areaRepo.LatestMealArea(ctx, state.UserID)
		if err == nil {
			result.LocationHint = area
		} else {
			logger.Warn(ctx, "历史地区读取失败", slog.String("user_id", state.UserID), logger.Err(err))
		}
	}
	historyOnly := mealHistoryQuestion(state.Question) && !regexp.MustCompile(`附近|身边|周围|综合`).MatchString(state.Question)
	pool := []groundedMeal{}
	for _, record := range state.HistoryRecords {
		if record.UserID != state.UserID || record.RecordTime == nil || !record.RecordTime.Before(mealDecisionNow(state)) {
			continue
		}
		candidate, ok := mealFromHistory(record)
		if !ok {
			continue
		}
		pool = append(pool, groundedMeal{candidate: candidate, date: record.RecordTime.In(chinaTZ).Format("2006-01-02")})
	}
	if state.Location != nil && !historyOnly {
		result.SearchScope = "nearby_and_history"
		radius := state.Constraints.RadiusKM
		if radius <= 0 {
			radius = 5
		}
		nearby, _, err := s.retrievePreviewCandidates(ctx, state, domain.CampusDietSearchFilter{AllowUnknownNutrition: true, ViewerID: state.UserID, Location: state.Location, RadiusKM: radius, MerchantOnly: state.Constraints.Scene == "takeout", Limit: 100, MaxPrice: state.Constraints.MaxPrice, SortBy: "best_match"})
		state.ToolCount++
		status := "success"
		if err != nil {
			status = "failed"
			logger.Error(ctx, "附近餐食检索失败，保留历史选项", err, slog.String("user_id", state.UserID))
			result.DataNotes = append(result.DataNotes, "附近餐食暂时读取失败，当前只展示可核对的历史选项。")
		} else {
			for _, candidate := range nearby {
				if candidate.Calories <= 0 {
					candidate.NutritionBasis = "unavailable"
					for i := range candidate.Items {
						if candidate.Items[i].Amount == "1份" {
							candidate.Items[i].Amount = "份量待确认"
						}
					}
				}
				if candidate.DistanceKM == nil || *candidate.DistanceKM > radius {
					continue
				}
				if len(candidate.Items) == 0 {
					candidate.Items = []DietRecommendationFoodItem{{Name: candidate.Title, Amount: candidate.PortionDescription, Source: candidate.Source, SourceID: candidate.SourceID}}
				}
				pool = append(pool, groundedMeal{candidate: candidate})
			}
			if len(nearby) == 0 {
				result.DataNotes = append(result.DataNotes, "当前位置附近的已收录餐食不足，未扩大到其它城市或默认学校。")
			}
		}
		state.ToolTrace = append(state.ToolTrace, CampusDietAgentToolTrace{ToolName: "search_nearby_foods", Status: status, ResultCount: len(nearby)})
	} else if state.School.ID != "" && len(state.ExplicitSchools) == 0 && !historyOnly {
		result.SearchScope = "campus_and_history"
		campusMeals, _, err := s.retrievePreviewCandidates(ctx, state, domain.CampusDietSearchFilter{
			AllowUnknownNutrition: true,
			ViewerID:              state.UserID,
			CampusOnly:            true,
			SchoolID:              state.School.ID,
			CampusID:              state.CampusID,
			Limit:                 100,
			SortBy:                "best_match",
		})
		state.ToolCount++
		status := "success"
		if err != nil {
			status = "failed"
			logger.Error(ctx, "学生学校食堂餐食检索失败，保留历史选项", err, slog.String("user_id", state.UserID), slog.String("school_id", state.School.ID))
			result.DataNotes = append(result.DataNotes, "本校食堂餐食暂时读取失败，当前只展示可核对的历史选项。")
		} else {
			for _, candidate := range campusMeals {
				if candidate.Calories <= 0 {
					candidate.NutritionBasis = "unavailable"
					for i := range candidate.Items {
						if candidate.Items[i].Amount == "1份" {
							candidate.Items[i].Amount = "份量待确认"
						}
					}
				}
				if len(candidate.Items) == 0 {
					candidate.Items = []DietRecommendationFoodItem{{Name: candidate.Title, Amount: candidate.PortionDescription, Source: candidate.Source, SourceID: candidate.SourceID}}
				}
				pool = append(pool, groundedMeal{candidate: candidate})
			}
			result.DataNotes = append(result.DataNotes, "已根据注册档案中确认的学生学校优先查询本校食堂；开放时段和当日供应仍以食堂现场为准。")
		}
		state.ToolTrace = append(state.ToolTrace, CampusDietAgentToolTrace{ToolName: "search_student_campus_foods", Status: status, ResultCount: len(campusMeals)})
	} else if state.Location == nil && len(state.ExplicitSchools) == 0 {
		note := "没有有效的实时定位；可先选历史餐食，使用当前位置后再加入附近选项。"
		if result.LocationHint != nil {
			a := result.LocationHint
			note = fmt.Sprintf("最近保存地区为%s%s%s（%s），不是实时位置；使用当前位置后再加入附近选项。", a.Province, a.City, a.District, a.RecordedAt.In(chinaTZ).Format("01-02"))
		}
		result.DataNotes = append(result.DataNotes, note)
	}
	if len(state.ExplicitSchools) > 0 && !historyOnly {
		result.SearchScope = "named_campuses_and_history"
		seenCatalog := map[string]bool{}
		for _, meal := range pool {
			seenCatalog[meal.candidate.Source+":"+meal.candidate.SourceID] = true
		}
		for _, school := range state.ExplicitSchools {
			rows, _, err := s.retrievePreviewCandidates(ctx, state, domain.CampusDietSearchFilter{ViewerID: state.UserID, SchoolID: school.ID, CampusOnly: true, AllowUnknownNutrition: true, MaxPrice: state.Constraints.MaxPrice})
			if err != nil {
				logger.Error(ctx, "指定学校菜单检索失败", err, logger.UserID(state.UserID), slog.String("school_id", school.ID))
				result.DataNotes = append(result.DataNotes, school.Name+"菜单检索失败，不能视为没有餐食。")
			} else {
				for _, c := range rows {
					key := c.Source + ":" + c.SourceID
					if !seenCatalog[key] {
						pool = append(pool, groundedMeal{candidate: normalizeMealEvidence(c)})
						seenCatalog[key] = true
					}
				}
			}
			if len(state.CatalogCoverage) > 0 {
				state.CatalogCoverage[len(state.CatalogCoverage)-1].School = school
			}
		}
		result.DataNotes = append(result.DataNotes, "已按本次指定学校查询公开食堂菜单；不是实时定位，未核实步行距离、入校条件、营业时段或当前供应。")
	}
	result.CatalogCoverage = state.CatalogCoverage
	if state.IsHomePreview && state.EngineVersion == dietDecisionEngineVersion {
		state.PlanningCatalog = prepareMealPlanningCatalog(ctx, state, pool)
	}
	bySourceID := map[string]DietRecommendationCandidate{}
	for _, m := range pool {
		bySourceID[m.candidate.SourceID] = m.candidate
	}
	decision := dietDecisionContextFromCampusState(state)
	excluded := map[string]bool{}
	if state.Intent == "more" {
		for _, meal := range pool {
			if slices.Contains(state.ExcludedSourceIDs, meal.candidate.SourceID) || slices.Contains(state.ActiveSourceIDs, meal.candidate.SourceID) {
				excluded[mealFingerprint(meal.candidate)] = true
			}
		}
	}
	// A verification follow-up re-reads the original records, not a different meal.
	verify := state.ActiveResult != nil && regexp.MustCompile(`确实|核对|来源|日期|为什么|不要换|不用换`).MatchString(state.Question) && state.Intent != "more" && !campusDietAgentHasNewSearchConstraints(state.Question)
	if state.ActiveResult != nil && regexp.MustCompile(`确实|核对`).MatchString(state.Question) && state.Intent != "more" {
		verify = true
	}
	selectedID := ""
	if state.EntryContext != nil && state.Intent != "more" {
		if match := regexp.MustCompile(`餐食ID[：:]\s*([a-fA-F0-9-]{36})`).FindStringSubmatch(state.Question); len(match) > 1 {
			selectedID = match[1]
			verify = false
		}
	}
	// Unknown-value bounds must use only this request's selectable meals.
	comparisonPool := []DietRecommendationCandidate{}
	for _, meal := range pool {
		c := meal.candidate
		if !groundedMealAllowed(state, c) || !mealHasEvidenceStructure(c) || excluded[mealFingerprint(c)] ||
			selectedID != "" && c.SourceID != selectedID || verify && !slices.Contains(state.ActiveSourceIDs, c.SourceID) ||
			meal.date == state.MealContext.Date && !verify {
			continue
		}
		if _, skipped := mealPreviewMemoryEffect(state, c); state.IsHomePreview && skipped {
			continue
		}
		comparisonPool = append(comparisonPool, c)
	}
	decision = prepareDietDecisionComparison(decision, comparisonPool)
	result.CandidateSnapshotHash = dietCandidatePoolHash(comparisonPool)
	eligible := []groundedMeal{}
	for _, meal := range pool {
		c := meal.candidate
		if selectedID != "" && c.SourceID != selectedID {
			continue
		}
		structured := mealHasEvidenceStructure(c)
		if !structured || excluded[mealFingerprint(c)] {
			continue
		}
		if verify && !slices.Contains(state.ActiveSourceIDs, c.SourceID) {
			continue
		}
		evaluation := evaluateDietDecisionCandidate(decision, c)
		if !evaluation.Feasible || !groundedMealAllowed(state, c) {
			continue
		}
		meal.score = evaluation.Scores.BalancedUtility
		meal.evaluation = evaluation
		if c.NutritionBasis == "unavailable" {
			meal.score = 35
		} // Unknown nutrition is not zero intake or a perfect nutritional match.
		if state.IsHomePreview {
			penalty, skipped := mealPreviewMemoryEffect(state, c)
			if skipped {
				continue
			}
			meal.score -= penalty
		}
		if c.DistanceKM != nil {
			meal.score -= math.Min(15, *c.DistanceKM*2)
		}
		if state.Location == nil && c.SchoolID != "" && c.SchoolID == state.School.ID {
			meal.score += 10
		}
		text := normalizedDietDecisionCandidateText(c)
		for _, f := range state.PersonalContext.FoodFrequency {
			if strings.Contains(text, normalizeDietDecisionToken(f.Name)) {
				meal.score += math.Min(4, float64(f.Count))
				meal.score -= math.Min(18, float64(f.RecentCount)*6)
			}
		}
		for _, prefer := range state.Constraints.PreferFoods {
			if strings.Contains(text, normalizeDietDecisionToken(prefer)) {
				meal.score += 8
			}
		}
		if evaluation.Scores.Version == dietDecisionEngineVersion {
			_, evidencePenalty := mealEvidenceIssues(c, state.MealContext.MealType)
			meal.venuePenalty = mealRecentVenuePenalty(state, c, bySourceID)
			meal.score -= evidencePenalty + meal.venuePenalty
			if state.IsHomePreview {
				meal.plan = buildConditionalMealDayPlan(ctx, state, c, pool)
				if meal.plan.Status == "conditional" {
					meal.score -= math.Min(3, meal.plan.ProjectedLoss*5)
				}
			}
		}
		if meal.date == state.MealContext.Date && !verify {
			continue
		}
		eligible = append(eligible, meal)
	}
	sort.SliceStable(eligible, func(i, j int) bool {
		if resolvedDietEngineVersion(decision) == dietDecisionEngineVersion {
			return dietDecisionBetter(eligible[i].evaluation, eligible[j].evaluation, eligible[i].score, eligible[j].score)
		}
		if eligible[i].score == eligible[j].score {
			return eligible[i].date > eligible[j].date
		}
		return eligible[i].score > eligible[j].score
	})
	result.CandidateCount = len(eligible)
	seen := map[string]bool{}
	add := func(meal groundedMeal, role, label string) {
		c := meal.candidate
		fingerprint := mealFingerprint(c)
		if len(result.Recommendations) >= 3 || seen[fingerprint] {
			return
		}
		seen[fingerprint] = true
		reason := "按今日已记录摄入、个人目标和近期重复情况筛选"
		if c.Protein >= 20 && state.MealContext.Remaining.Protein > 20 {
			reason = fmt.Sprintf("记录蛋白质约%.0fg，可补充今日已记录的蛋白缺口", c.Protein)
		}
		if c.NutritionBasis == "unavailable" {
			reason = "附近已收录的具体餐食；份量、营养待确认，不能据此保证满足营养目标"
		}
		if _, patternReason := dietPatternBonus(state.MealContext.DecisionBasis, c); patternReason != "" && c.NutritionBasis != "unavailable" {
			reason = patternReason
		}
		option := campusDietRecommendationOption(c, reason, "")
		option.MealComponents = state.MealPlans[c.SourceID]
		option.EvidenceIssues, _ = mealEvidenceIssues(c, state.MealContext.MealType)
		if result.SelectionAudit != nil {
			for _, row := range result.SelectionAudit.Rows {
				if row.SourceID == c.SourceID {
					option.SelectionReason = row.Reason
					break
				}
			}
		}
		option.Items = c.Items
		option.HistoryDate = meal.date
		option.DistanceKM, option.MerchantName, option.Address, option.LocationLevel = c.DistanceKM, c.MerchantName, c.Address, c.LocationLevel
		option.DecisionRole, option.DecisionLabel, option.DecisionScore = role, label, meal.score
		option.DecisionScores = &meal.evaluation.Scores
		option.DecisionMissingEvidence = append(option.DecisionMissingEvidence, meal.evaluation.MissingEvidence...)
		if resolvedDietEngineVersion(decision) == dietDecisionEngineVersion {
			option.DecisionScore = meal.evaluation.Scores.HealthFit
			option.Reason = dietDecisionV3Reason(meal.evaluation)
		}
		option.SourceLabel = strings.Join(compactDietStrings(c.MerchantName, c.SchoolName, c.CanteenName), " · ")
		if c.IsCampusFood {
			option.SourceLabel = strings.Join(compactDietStrings(c.SchoolName, c.CanteenName), " · ")
		}
		if c.NutritionBasis == "unavailable" {
			option.DecisionMissingEvidence = []string{"营养数据缺失", "需向商家确认份量与配料"}
		}
		if meal.date != "" {
			option.SourceLabel = historyMealSourceLabel(c) + " · " + meal.date
			option.NutritionBasis = c.NutritionBasis
		}
		result.Recommendations = append(result.Recommendations, option)
	}
	if state.IsHomePreview {
		chosen := selectVariedPreviewMeals(eligible)
		if state.EngineVersion == dietDecisionEngineVersion {
			chosen = s.arbitratePreviewMeals(ctx, state, eligible, result)
		}
		result.CandidateFunnel = mealCandidateFunnel(state, pool, eligible, chosen, excluded)
		for _, meal := range chosen {
			role := "nearby"
			if meal.candidate.Source == "food_record" {
				role = "history"
			}
			add(meal, role, "")
		}
		if state.EngineVersion == dietDecisionEngineVersion {
			for i := range result.Recommendations {
				if i < len(chosen) {
					result.Recommendations[i].RemainingDayPlan = chosen[i].plan
				}
			}
		}
		if !state.ReadOnlyReplay {
			s.saveMealPreviewOptions(ctx, state, result)
		}
	} else {
		// Home is primarily a decision about where to eat. Prefer two different
		// nearby venues; history is at most one fallback, never filler for no GPS.
		venues := map[string]bool{}
		for _, meal := range eligible {
			c := meal.candidate
			venue := strings.Join(compactDietStrings(c.MerchantName, c.SchoolID, c.CanteenName), ":")
			if c.Source != "food_record" && !venues[venue] && len(result.Recommendations) < 2 {
				add(meal, "nearby", "")
				venues[venue] = true
			}
		}
		for _, meal := range eligible {
			if meal.candidate.Source != "food_record" && len(result.Recommendations) < 2 {
				add(meal, "nearby", "")
			}
		}
		for _, meal := range eligible {
			if meal.candidate.Source == "food_record" {
				add(meal, "history", "")
				break
			}
		}
		for _, meal := range eligible {
			if meal.candidate.Source != "food_record" {
				add(meal, "nearby", "")
			}
		}
	}
	result.Summary = "结合个人目标、今日摄入和近期餐食记录，下面是互为替代的选择，不是一起吃。"
	if state.Location != nil {
		result.DataNotes = append(result.DataNotes, "附近距离按库内坐标估算，不代表步行距离或位置已核验；商家当日供应请另行确认。")
		result.DataNotes = append(result.DataNotes, "附近范围同时考虑食堂与校外餐食；未确认的入校条件、配送可达、起送价和配送费不能视为已满足。")
	}
	if verify {
		result.Summary = "已重新核对本人原始饮食记录，下面保留刚才的餐食和当次实际份量，没有用收藏食谱替代。"
	}
	if state.Location == nil && len(state.ExplicitSchools) == 0 && state.School.ID == "" && regexp.MustCompile(`附近|身边|周围`).MatchString(state.Question) {
		result.Summary = "目前只有历史地区线索，没有有效实时定位，也未确认学校就餐资格。暂不能把任何餐食称为你身边可买；下面保留历史选项，定位后再加入附近商家。"
	}
	if len(result.Recommendations) == 0 {
		result.NeedsClarification = true
		result.Summary = "已检索本人近30天记录和可用的附近餐食，但没有找到满足当前条件、份量可核对的完整一餐。"
		if state.Constraints.MaxPrice != nil {
			result.DataNotes = append(result.DataNotes, "历史记录没有可靠价格，不能把它们当作满足预算的餐食。")
		}
	} else if len(result.Recommendations) < 2 {
		if result.SearchScope == "history" && result.CandidateCount > 1 {
			result.DataNotes = append(result.DataNotes, "缺少可核对的附近在售菜单，本次仅展示一个历史餐食参考；历史可比较餐食不止这一份。")
		} else {
			result.DataNotes = append(result.DataNotes, "目前只有这一份满足条件，不用通用搭配凑数。")
		}
	}
	if len(result.Recommendations) > 0 && result.Recommendations[0].DecisionScore < 60 && state.EngineVersion == dietDecisionEngineVersion {
		result.DataNotes = append(result.DataNotes, "当前候选与已记录口径下的营养计划匹配度较低；请先核实当日记录、目标和实际份量，不能把首选当作全天达标保证。")
	}
	logger.Info(ctx, "真实餐食推荐完成", slog.String("user_id", state.UserID), slog.String("scope", result.SearchScope), slog.String("engine_version", result.DecisionEngineVersion), slog.Bool("read_only_replay", state.ReadOnlyReplay), slog.Int("compared_nutrient_count", len(decision.ComparisonKeys)), slog.Int("candidate_count", result.CandidateCount), slog.Int("result_count", len(result.Recommendations)))
	return result, nil
}

func mealFromHistory(record domain.FoodRecord) (DietRecommendationCandidate, bool) {
	c := DietRecommendationCandidate{Source: "food_record", SourceID: record.ID, RecordedMealType: record.MealType, Calories: record.TotalCalories, Protein: record.TotalProtein, Carbs: record.TotalCarbs, Fat: record.TotalFat, NutritionBasis: "本人饮食记录中的份量与估算营养，未核实实际食用", UncertaintyLevel: "medium"}
	if record.EntryType != nil {
		c.RecordEntryType = *record.EntryType
	}
	if record.Description != nil {
		c.Description = *record.Description
	}
	c.Nutrients = nutritionagg.Observe(record.Items, true)
	names := []string{}
	for _, raw := range record.Items {
		name, _ := raw["name"].(string)
		if strings.TrimSpace(name) == "" {
			return c, false
		}
		if raw["weight"] == nil && raw["intake"] == nil {
			return c, false
		}
		amount := anyFloat(raw["weight"])
		if intake, exists := raw["intake"]; exists && intake != nil {
			amount = anyFloat(intake)
		} else if ratio, exists := raw["ratio"]; exists && ratio != nil {
			if anyFloat(ratio) < 0 || anyFloat(ratio) > 100 {
				return c, false
			}
			amount *= anyFloat(ratio) / 100
		}
		if amount == 0 {
			continue
		}
		if amount < 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
			return c, false
		}
		c.Items = append(c.Items, DietRecommendationFoodItem{Name: name, Amount: formatCampusDietNumber(amount) + "g", Source: c.Source, SourceID: c.SourceID})
		names = append(names, name)
	}
	c.Title = strings.Join(names, " + ")
	return c, len(names) > 0 && c.SourceID != "" && c.Calories > 0
}

func mealFingerprint(c DietRecommendationCandidate) string {
	names := []string{}
	for _, item := range c.Items {
		names = append(names, normalizeDietDecisionToken(item.Name))
	}
	if len(names) == 0 {
		names = append(names, normalizeDietDecisionToken(c.Title))
	}
	sort.Strings(names)
	return strings.Join(names, "|")
}

func groundedMealAllowed(state *campusDietAgentRunState, c DietRecommendationCandidate) bool {
	return groundedMealExclusion(state, c) == ""
}

func groundedMealExclusion(state *campusDietAgentRunState, c DietRecommendationCandidate) string {
	choosingMeal := state.IsHomePreview || campusDietAgentIsSearchIntent(state.Intent)
	if choosingMeal && !mealWeekdayAllowed(mealDecisionNow(state), c) {
		return "weekday_unavailable"
	}
	if choosingMeal && (c.AvailabilityStatus == "temporarily_unavailable" || c.AvailabilityStatus == "discontinued") {
		return "not_available"
	}
	mealType := state.Constraints.MealType
	if mealType == "" && state.IsHomePreview {
		mealType = state.MealContext.MealType
	}
	// Do not turn an inferred clock-based meal into a new hard constraint on
	// an unspecific chat or a follow-up asking about an existing dish.
	if choosingMeal && !mealHistoryQuestion(state.Question) && !mealDaypartAllowed(mealType, c) {
		return "meal_period_mismatch_or_unconfirmed"
	}
	// Explicit daypart labels are catalog evidence; do not silently turn a
	// breakfast-only listing into an available lunch/dinner offer.
	if c.Source != "food_record" {
		for mealType, label := range map[string]string{"breakfast": "早餐", "lunch": "午餐", "dinner": "晚餐"} {
			if strings.Contains(c.Title, label) && state.Constraints.MealType != "" && state.Constraints.MealType != mealType {
				return "meal_period_mismatch_or_unconfirmed"
			}
		}
	}
	if c.NutritionBasis == "unavailable" && (state.Constraints.MaxCalories != nil || state.Constraints.MinProtein != nil || state.Constraints.MaxFat != nil) {
		return "nutrition_unknown_for_hard_limit"
	}
	text := normalizedDietDecisionCandidateText(c)
	for _, avoid := range append(slices.Clone(state.Constraints.AvoidFoods), state.MealContext.Allergies...) {
		if mealAvoidFoodMatches(avoid, text) {
			return "allergy_or_avoid_food"
		}
	}
	if state.Constraints.MaxPrice != nil && !mealKnownServing(c) {
		return "serving_price_unconfirmed"
	}
	for _, preference := range state.MealContext.DietPreferences {
		if regexp.MustCompile(`素食|vegetarian|vegan`).MatchString(preference) && regexp.MustCompile(`肉|排骨|牛腩|鸡腿|鸡胸|鸡翅|鱼|虾|蟹|鸭|猪|羊`).MatchString(text) {
			return "diet_preference"
		}
		if regexp.MustCompile(`纯素|vegan`).MatchString(preference) && regexp.MustCompile(`蛋|奶|乳|蜂蜜`).MatchString(text) {
			return "diet_preference"
		}
	}
	return ""
}
