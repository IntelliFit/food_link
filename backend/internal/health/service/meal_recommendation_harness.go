package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"food_link/backend/internal/health/domain"
)

const mealHarnessVersion = "foodlink-meal-harness-v3"

type mealHistoryEvidence struct {
	Date   string                  `json:"date"`
	Meal   string                  `json:"meal"`
	Foods  []string                `json:"foods"`
	Macros DietRecommendationMacro `json:"macros"`
}

type mealFoodFrequency struct {
	Name        string `json:"name"`
	Count       int    `json:"record_count"`
	RecentCount int    `json:"last_3_days_count"`
}

type mealPersonalContext struct {
	Profile        string                  `json:"health_profile"`
	LookbackDays   int                     `json:"lookback_days"`
	RecordedDays   int                     `json:"recorded_days"`
	RecordCount    int                     `json:"record_count"`
	Average        DietRecommendationMacro `json:"average_per_recorded_day"`
	RecentMeals    []mealHistoryEvidence   `json:"recent_meals"`
	FoodFrequency  []mealFoodFrequency     `json:"food_frequency"`
	RecentExercise []map[string]any        `json:"recent_exercise"`
	Notes          []string                `json:"notes"`
}

func (s *StatsService) loadMealHarnessContext(ctx context.Context, state *campusDietAgentRunState) error {
	if state.MealContextLoaded {
		return nil
	}
	now := time.Now().In(chinaTZ)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ)
	records, err := s.repo.GetFoodRecordsForDateRange(ctx, state.UserID, start.AddDate(0, 0, -29).UTC(), now.UTC())
	if err != nil {
		return fmt.Errorf("饮食历史暂时无法读取")
	}
	profile, err := s.repo.GetUserProfile(ctx, state.UserID)
	if err != nil {
		return fmt.Errorf("健康档案暂时无法读取")
	}
	exercise, exerciseErr := s.repo.GetExerciseLogsForDateRange(ctx, state.UserID, start.AddDate(0, 0, -6).Format("2006-01-02"), start.Format("2006-01-02"))
	personal := summarizeMealHistory(records, now)
	personal.Profile = formatStatsHealthProfile(profile, nil)
	if exerciseErr != nil {
		personal.Notes = append(personal.Notes, "运动记录暂时读取失败，不能据此判断没有运动")
	}
	for _, log := range exercise {
		if len(personal.RecentExercise) >= 8 {
			break
		}
		date := ""
		if log.RecordedOn != nil {
			date = log.RecordedOn.In(chinaTZ).Format("2006-01-02")
		}
		personal.RecentExercise = append(personal.RecentExercise, map[string]any{"date": date, "activity": trimStatsRunes(log.ExerciseDesc, 160), "duration_min": log.DurationMin, "calories": log.CaloriesBurned})
	}
	meal := campusDietAgentMealContext{Date: start.Format("2006-01-02"), MealType: inferCampusDietMealType(state.Question, now), CalorieTarget: 2000}
	protein, carbs, fat := 100.0, 240.0, 60.0
	if profile != nil {
		if profile.TDEE != nil && *profile.TDEE > 0 {
			meal.CalorieTarget = *profile.TDEE
		}
		if profile.DietGoal != nil {
			meal.UserGoal = *profile.DietGoal
		}
		health := profile.HealthCondition
		targets := mapFromAny(health["dashboard_targets"])
		meal.CalorieTarget = positiveMapFloat(targets, []string{"calorie_target", "calories"}, meal.CalorieTarget)
		protein = positiveMapFloat(targets, []string{"protein_target", "protein"}, protein)
		carbs = positiveMapFloat(targets, []string{"carbs_target", "carbs"}, carbs)
		fat = positiveMapFloat(targets, []string{"fat_target", "fat"}, fat)
		meal.Allergies = stringSliceFromCampusDietAny(health["allergies"])
		meal.DietPreferences = stringSliceFromCampusDietAny(health["diet_preference"])
	}
	for _, record := range records {
		if record.RecordTime == nil || record.RecordTime.Before(start) || record.RecordTime.After(now) {
			continue
		}
		meal.Current.Calories += record.TotalCalories
		meal.Current.Protein += record.TotalProtein
		meal.Current.Carbs += record.TotalCarbs
		meal.Current.Fat += record.TotalFat
	}
	meal.UserGoal = explicitCampusDietGoal(state.Question, meal.UserGoal)
	if state.Constraints.MealType != "" {
		meal.MealType = state.Constraints.MealType
	}
	if state.Constraints.Goal != "" {
		meal.UserGoal = state.Constraints.Goal
	}
	meal.Remaining = DietRecommendationMacro{Calories: math.Max(0, meal.CalorieTarget-meal.Current.Calories), Protein: math.Max(0, protein-meal.Current.Protein), Carbs: math.Max(0, carbs-meal.Current.Carbs), Fat: math.Max(0, fat-meal.Current.Fat)}
	state.MealContext, state.PersonalContext, state.MealContextLoaded = meal, personal, true
	state.HistoryRecords = records
	return nil
}

func summarizeMealHistory(records []domain.FoodRecord, now time.Time) mealPersonalContext {
	out := mealPersonalContext{LookbackDays: 30, Notes: []string{"记录缺失不代表没有进食；常吃不等于喜欢，频率仅用于避免重复和了解习惯"}}
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ)
	days := map[string]bool{}
	freq := map[string]mealFoodFrequency{}
	records = append([]domain.FoodRecord(nil), records...)
	sort.SliceStable(records, func(i, j int) bool {
		if records[i].RecordTime == nil {
			return false
		}
		if records[j].RecordTime == nil {
			return true
		}
		return records[i].RecordTime.After(*records[j].RecordTime)
	})
	for _, record := range records {
		if record.RecordTime == nil || record.RecordTime.Before(start.AddDate(0, 0, -29)) || record.RecordTime.After(now) {
			continue
		}
		date := record.RecordTime.In(chinaTZ).Format("2006-01-02")
		days[date] = true
		out.RecordCount++
		out.Average.Calories += record.TotalCalories
		out.Average.Protein += record.TotalProtein
		out.Average.Carbs += record.TotalCarbs
		out.Average.Fat += record.TotalFat
		names := []string{}
		seen := map[string]bool{}
		for _, item := range record.Items {
			name, _ := item["name"].(string)
			name = trimStatsRunes(strings.TrimSpace(name), 80)
			if name != "" && !seen[name] {
				names = append(names, name)
				seen[name] = true
			}
		}
		if len(names) == 0 && record.Description != nil && strings.TrimSpace(*record.Description) != "" {
			names = append(names, trimStatsRunes(*record.Description, 120))
		}
		for _, name := range names {
			f := freq[name]
			f.Name = name
			f.Count++
			if !record.RecordTime.Before(start.AddDate(0, 0, -2)) {
				f.RecentCount++
			}
			freq[name] = f
		}
		if len(out.RecentMeals) < 18 {
			out.RecentMeals = append(out.RecentMeals, mealHistoryEvidence{Date: date, Meal: record.MealType, Foods: names, Macros: DietRecommendationMacro{Calories: record.TotalCalories, Protein: record.TotalProtein, Carbs: record.TotalCarbs, Fat: record.TotalFat}})
		}
	}
	out.RecordedDays = len(days)
	if out.RecordedDays > 0 {
		d := float64(out.RecordedDays)
		out.Average.Calories /= d
		out.Average.Protein /= d
		out.Average.Carbs /= d
		out.Average.Fat /= d
	}
	for _, f := range freq {
		out.FoodFrequency = append(out.FoodFrequency, f)
	}
	sort.Slice(out.FoodFrequency, func(i, j int) bool {
		a, b := out.FoodFrequency[i], out.FoodFrequency[j]
		if a.Count == b.Count {
			return a.Name < b.Name
		}
		return a.Count > b.Count
	})
	if len(out.FoodFrequency) > 30 {
		out.FoodFrequency = out.FoodFrequency[:30]
	}
	return out
}

func mealHarnessScope(state *campusDietAgentRunState) string {
	if state.Location != nil {
		return "nearby"
	}
	if state.School.ID != "" {
		return "school"
	}
	return "unknown"
}

func mealHarnessSourceLabel(state *campusDietAgentRunState) string {
	if state.Location != nil {
		return "附近已收录餐食"
	}
	return state.School.Name + "校园餐食库"
}

func mealHarnessNotes(state *campusDietAgentRunState) []string {
	notes := []string{"菜品来自已收录的公开餐食数据；价格和营养以记录为准，当日供应需向商家或食堂确认"}
	if state.Location != nil {
		notes = append(notes, "距离为约算直线距离；校园级定位只代表校区附近，不保证校外人员可以进入")
	}
	if state.Constraints.Scene == "takeout" {
		notes = append(notes, "商家来自已有餐食库；缺失价格或具体位置会明确标注，不把资料缺失当作没有这家店")
	}
	if len(state.MealContext.Allergies) > 0 {
		notes = append(notes, "已排除菜名和已记录配料中命中的忌口；配料与交叉接触信息不完整，请向商家核实过敏原")
	}
	return notes
}

func mealHarnessEmptyResult(state *campusDietAgentRunState, reason string) *CampusDietAgentResult {
	answer := "目前收录的餐食里没有找到符合这些条件的选择。你愿意调整预算、搜索范围，还是告诉我想吃的菜系？"
	if mealHarnessScope(state) == "unknown" {
		answer = "我可以结合你的近期饮食和个人目标选这餐。点下方‘使用当前位置’，或告诉我学校和校区，我再查附近已收录的餐食。"
	}
	if reason == "context_unavailable" {
		answer = "这次没能读取完整饮食记录或健康档案，请稍后再试。你也可以先补充本餐需求。"
	}
	if state.Constraints.PendingSchool != nil && !state.Constraints.CampusAccessDenied && state.Constraints.Scene != "takeout" {
		answer = fmt.Sprintf("已收录的附近选择里有%s食堂，但位置不代表能在校内就餐。你这次可以在%s食堂吃饭吗？也可以只看校外商家。", state.Constraints.PendingSchool.Name, state.Constraints.PendingSchool.Name)
		reason = "campus_access_required"
	} else if state.SearchAttempted && state.Constraints.CompleteMeal && len(state.LastSearch) > 0 {
		answer = "现有记录里有单道菜，但还没找到能核算份量、总价并满足这次条件的完整一餐。我不会把单道配菜当作吃饱的方案。你愿意调整预算，还是换一个就餐地点？"
	} else if state.SearchAttempted && state.Constraints.Scene == "takeout" {
		answer = "在本次范围和条件下，现有餐食库没有检索到位置与餐食资料足够的校外商家选项；这不代表当地没有商家。你愿意提供一个具体店名或换个地点吗？"
	}
	if state.RetrievalFailed {
		answer = "餐食数据暂时查询失败，请稍后再试；这次没有生成方案，不扣积分。"
	}
	if state.Constraints.Scene == "home" {
		answer = "这餐准备自己做，我需要知道你手边有哪些食材、大概有多少时间？补充后我会按你的目标安排搭配。"
	}
	answer = mealConstraintConfirmation(state) + answer
	recommendation := DietRecommendationResult{Scene: "eat_out", Title: "补充这餐的需求", Summary: answer, Recommendations: []DietRecommendationOption{}, HarnessVersion: mealHarnessVersion, SearchScope: mealHarnessScope(state), NeedsClarification: true, DataNotes: mealHarnessNotes(state), AgentConstraints: &state.Constraints}
	if state.School.ID != "" {
		recommendation.ResolvedSchool = &state.School
	}
	return &CampusDietAgentResult{AgentRunID: state.RunID, Answer: answer, Recommendation: recommendation, ToolTrace: state.ToolTrace, ToolCount: state.ToolCount, FallbackReason: reason}
}

func mealHarnessContextSummary(state *campusDietAgentRunState) []string {
	parts := []string{fmt.Sprintf("参考近30天的%d天、%d条饮食记录", state.PersonalContext.RecordedDays, state.PersonalContext.RecordCount)}
	if len(state.PersonalContext.RecentExercise) > 0 {
		parts = append(parts, "结合近期运动记录")
	}
	if state.Location != nil {
		parts = append(parts, "按本次位置查询附近已收录餐食")
	}
	return parts
}

func mealHarnessRank(state *campusDietAgentRunState, candidates []DietRecommendationCandidate) []DietRecommendationCandidate {
	ctx := dietDecisionContextFromCampusState(state)
	out := make([]DietRecommendationCandidate, 0, len(candidates))
	scores := map[string]float64{}
	for _, candidate := range candidates {
		if !mealCampusAvailable(state, candidate) {
			continue
		}
		if state.Location != nil {
			radius := state.Constraints.RadiusKM
			if radius <= 0 {
				radius = 3
			}
			if candidate.DistanceKM == nil || *candidate.DistanceKM > radius {
				continue
			}
		}
		if state.Constraints.Scene == "takeout" && (candidate.IsCampusFood || candidate.MerchantName == "") {
			continue
		}
		if state.Constraints.Scene == "campus" && !candidate.IsCampusFood {
			continue
		}
		eval := evaluateDietDecisionCandidate(ctx, candidate)
		if !eval.Feasible {
			continue
		}
		text := normalizedDietDecisionCandidateText(candidate)
		blocked := false
		for _, avoid := range state.Constraints.AvoidFoods {
			if mealAvoidFoodMatches(avoid, text) {
				blocked = true
			}
		}
		if blocked {
			continue
		}
		score := eval.Scores.BalancedUtility
		if candidate.DistanceKM != nil {
			score -= math.Min(15, *candidate.DistanceKM*2)
		}
		for _, f := range state.PersonalContext.FoodFrequency {
			if f.RecentCount > 0 && strings.Contains(text, normalizeDietDecisionToken(f.Name)) {
				score -= math.Min(18, float64(f.RecentCount)*6)
			}
		}
		for _, prefer := range state.Constraints.PreferFoods {
			if prefer != "" && strings.Contains(text, normalizeDietDecisionToken(prefer)) {
				score += 8
			}
		}
		scores[candidate.SourceID] = score
		out = append(out, candidate)
	}
	sort.SliceStable(out, func(i, j int) bool { return scores[out[i].SourceID] > scores[out[j].SourceID] })
	return out
}

func mealHarnessConversation(state *campusDietAgentRunState) []map[string]any {
	messages := []map[string]any{}
	start := len(state.History) - 12
	if start < 0 {
		start = 0
	}
	for _, m := range state.History[start:] {
		role := normalizePetChatRole(m.Role)
		if role != "user" && role != "assistant" {
			continue
		}
		messages = append(messages, map[string]any{"role": role, "content": trimStatsRunes(m.Content, 1000)})
	}
	return messages
}

func mealHarnessPreferences(state *campusDietAgentRunState, raw string) (map[string]any, error) {
	var args struct {
		AvoidFoods  *[]string `json:"avoid_foods"`
		PreferFoods *[]string `json:"prefer_foods"`
		Scene       string    `json:"scene"`
		RadiusKM    float64   `json:"radius_km"`
	}
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return nil, fmt.Errorf("参数需要是JSON对象")
	}
	normalize := func(values []string) []string {
		out := []string{}
		for _, v := range values {
			v = trimStatsRunes(strings.TrimSpace(v), 40)
			if v != "" {
				out = append(out, v)
			}
			if len(out) >= 12 {
				break
			}
		}
		return out
	}
	// Hard exclusions come from explicit user clauses, not a model's inferred
	// full replacement list (e.g. treating 清淡 as an allergy to all fried food).
	_ = args.AvoidFoods
	if args.PreferFoods != nil {
		state.Constraints.PreferFoods = normalize(*args.PreferFoods)
	}
	// Scene and distance changes must be supported by this user's text.
	applyCampusDietAgentQuestionConstraints(&state.Constraints, state.Question)
	// Previously retrieved candidates must be revalidated after preferences change.
	state.LastSearch = mealHarnessRank(state, state.LastSearch)
	for id, c := range state.Candidates {
		if len(mealHarnessRank(state, []DietRecommendationCandidate{c})) == 0 {
			delete(state.Candidates, id)
		}
	}
	return map[string]any{"constraints": state.Constraints, "note": "只更新本次对话的用餐条件，不修改健康档案；不能删除档案过敏原"}, nil
}
