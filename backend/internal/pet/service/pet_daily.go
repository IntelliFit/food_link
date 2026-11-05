package service

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"

	healthdomain "food_link/backend/internal/health/domain"
	petdomain "food_link/backend/internal/pet/domain"
	"food_link/backend/pkg/logger"
)

// The pet tab reads the shared daily nutrition state (docs/algorithms/daily-nutrition-state.md)
// instead of scoring meals itself: the mood, the daily note, the task and what the pet
// remembers all come from that one reading.

const (
	maxDailyFacts    = 4
	maxPetMemories   = 8
	waterCupML       = 250
	defaultWaterGoal = 1500
)

// NutritionStateReader is the diet decision engine's daily nutrition state
// ((*healthservice.StatsService).GetDailyNutritionState).
type NutritionStateReader interface {
	GetDailyNutritionState(ctx context.Context, userID, date string) (*healthdomain.DailyNutritionState, error)
}

func (s *Service) ConfigureNutritionStateReader(reader NutritionStateReader) {
	s.nutritionState = reader
}

// Daily is GET /api/pet/daily.
type Daily struct {
	Date       string                              `json:"date"`
	Pet        PetProfile                          `json:"pet"`
	Status     PetStatus                           `json:"status"`
	Mood       PetMood                             `json:"mood"`
	Headline   string                              `json:"headline"`
	Gaps       []DailyGapRow                       `json:"gaps"`
	MealsToday int                                 `json:"meals_today"`
	Report     DailyReport                         `json:"report"`
	Task       *DailyTask                          `json:"task"`
	Water      DailyWater                          `json:"water"`
	NextMeal   DailyNextMeal                       `json:"next_meal"`
	Week       DailyWeek                           `json:"week"`
	Focus      []healthdomain.NutritionFocusChoice `json:"focus"`
	Memories   []PetMemory                         `json:"memories"`
	StateReady bool                                `json:"state_ready"`
}

// DailyGapRow is one line of 「今天还差」, in the engine's order (the user's focus first).
type DailyGapRow struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Text    string `json:"text"`
	Status  string `json:"status"`
	Percent int    `json:"percent"`
	Warn    bool   `json:"warn"`
}

// DailyWeek is the one-line week score that links to the full analysis.
type DailyWeek struct {
	Score      *int     `json:"score"`
	LastWeek   *int     `json:"last_week"`
	Delta      *int     `json:"delta"`
	EnoughData bool     `json:"enough_data"`
	Habits     []string `json:"habits"`
}

const (
	maxDailyGapRows    = 3
	maxDailyWeekHabits = 2
)

// PetMood is how the pet feels, derived from what the user ate and drank.
type PetMood struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Reason string `json:"reason"`
	Icon   string `json:"icon"`
}

type DailyReport struct {
	Yesterday string             `json:"yesterday"`
	Today     string             `json:"today"`
	Facts     []string           `json:"facts"`
	Source    string             `json:"source"`
	Reward    *DailyReportReward `json:"reward,omitempty"`
}

// DailyReportReward is yesterday's review reward, now added when the pet tab is read
// instead of waiting for a claim tap.
type DailyReportReward struct {
	Exp        int  `json:"exp"`
	Credits    int  `json:"credits"`
	ClaimedNow bool `json:"claimed_now"`
}

type DailyWater struct {
	ML         int  `json:"ml"`
	GoalML     int  `json:"goal_ml"`
	Cups       int  `json:"cups"`
	GoalCups   int  `json:"goal_cups"`
	CupML      int  `json:"cup_ml"`
	Known      bool `json:"known"`
	IsTaskGoal bool `json:"is_task_goal"`
}

type DailyNextMeal struct {
	MealType        string `json:"meal_type"`
	Label           string `json:"label"`
	Advice          string `json:"advice"`
	StarterQuestion string `json:"starter_question"`
}

type PetMemory struct {
	Key    string `json:"key"`
	Text   string `json:"text"`
	Source string `json:"source"`
}

func (s *Service) Daily(ctx context.Context, userID, date string) (*Daily, error) {
	today := s.chinaToday()
	if strings.TrimSpace(date) == "" {
		date = today
	}
	day, err := parseChinaDate(date)
	if err != nil {
		return nil, err
	}
	yesterday := day.AddDate(0, 0, -1).Format("2006-01-02")

	pet, todayScore, err := s.preparePetDay(ctx, userID, date)
	if err != nil {
		return nil, err
	}
	todayState, yesterdayState := s.readNutritionStates(ctx, userID, date, yesterday)

	event, err := s.repo.GetEventByUserDateType(ctx, userID, yesterday, petdomain.EventTypeOfflineReview)
	if err != nil {
		return nil, err
	}
	reward, petChanged := s.autoClaimReview(ctx, userID, event)

	task, taskChanged, err := s.dailyTask(ctx, userID, pet, date, date == today, todayScore, todayState)
	if err != nil {
		return nil, err
	}
	if petChanged || taskChanged {
		if refreshed, err := s.repo.GetPetByUserID(ctx, userID); err == nil && refreshed != nil {
			pet = refreshed
		}
	}

	status := s.statusForPet(ctx, userID, pet.Name, date, todayScore.HabitScore, todayScore.ScoreDetails)
	water := dailyWater(todayState, todayScore.ScoreDetails)
	water.IsTaskGoal = task != nil && task.Kind == dailyTaskKindWater
	report := dailyReport(pet.Name, event, todayState, yesterdayState, todayScore.ScoreDetails)
	report.Reward = reward
	daily := &Daily{
		Date:       date,
		Pet:        s.profileFromPet(pet),
		Status:     status,
		Mood:       petMood(status, todayState, yesterdayState),
		Headline:   dailyHeadline(todayState, report),
		Gaps:       dailyGapRows(todayState),
		MealsToday: mealsToday(todayState, todayScore.ScoreDetails),
		Report:     report,
		Task:       task,
		Water:      water,
		NextMeal:   dailyNextMeal(todayState, s.nowInChina()),
		Week:       dailyWeek(todayState),
		Focus:      []healthdomain.NutritionFocusChoice{},
		Memories:   petMemories(todayState),
		StateReady: todayState != nil,
	}
	if todayState != nil && todayState.Focus != nil {
		daily.Focus = todayState.Focus
	}
	return daily, nil
}

// dailyHeadline is the pet's one line on the tab: the engine's headline, else the
// report's own sentences.
func dailyHeadline(today *healthdomain.DailyNutritionState, report DailyReport) string {
	if today != nil && strings.TrimSpace(today.Headline) != "" {
		return strings.TrimSpace(today.Headline)
	}
	return firstNonEmpty(report.Yesterday, report.Today)
}

// dailyGapRows lists what today still lacks, in the engine's order, then fills up to
// three lines with anything near or over its limit.
func dailyGapRows(state *healthdomain.DailyNutritionState) []DailyGapRow {
	rows := make([]DailyGapRow, 0, maxDailyGapRows)
	if state == nil {
		return rows
	}
	seen := map[string]struct{}{}
	add := func(row DailyGapRow, ok bool) {
		if !ok || len(rows) == maxDailyGapRows {
			return
		}
		if _, dup := seen[row.Key]; dup {
			return
		}
		seen[row.Key] = struct{}{}
		rows = append(rows, row)
	}
	for _, gap := range state.Gaps {
		reading := findReading(state.Today, gap.Key)
		if reading == nil {
			add(DailyGapRow{Key: gap.Key, Label: firstNonEmpty(gap.Label, gap.Key), Text: strings.TrimSpace(gap.Text)}, strings.TrimSpace(gap.Text) != "")
			continue
		}
		add(gapRowFromReading(*reading))
	}
	for _, reading := range state.Today {
		if reading.Status == healthdomain.NutrientStatusNearLimit || reading.Status == healthdomain.NutrientStatusOver {
			add(gapRowFromReading(reading))
		}
	}
	return rows
}

func gapRowFromReading(reading healthdomain.NutrientReading) (DailyGapRow, bool) {
	row := DailyGapRow{Key: reading.Key, Label: firstNonEmpty(reading.Label, reading.Key), Status: reading.Status}
	if reading.Value != nil && reading.Target > 0 {
		row.Percent = int(math.Round(math.Max(0, math.Min(1, *reading.Value/reading.Target)) * 100))
	}
	switch reading.Status {
	case healthdomain.NutrientStatusShort:
		if reading.Gap <= 0 {
			return row, false
		}
		row.Text = "差 " + formatAmount(reading.Gap, reading.Unit)
	case healthdomain.NutrientStatusNearLimit:
		row.Text, row.Warn = "快到上限", true
	case healthdomain.NutrientStatusOver:
		row.Warn = true
		row.Text = "超了"
		if reading.Value != nil && *reading.Value > reading.Target {
			row.Text = "超了 " + formatAmount(*reading.Value-reading.Target, reading.Unit)
		}
	default:
		return row, false
	}
	return row, true
}

func dailyWeek(state *healthdomain.DailyNutritionState) DailyWeek {
	week := DailyWeek{Habits: []string{}}
	if state == nil {
		return week
	}
	week.EnoughData = state.Coverage.EnoughData
	week.Score = state.Scores.Overall
	week.LastWeek = state.Scores.OverallLastWeek
	if week.Score != nil && week.LastWeek != nil {
		delta := *week.Score - *week.LastWeek
		week.Delta = &delta
	}
	for _, habit := range state.Week.Habits {
		if strings.TrimSpace(habit.Label) == "" || habit.Of <= 0 {
			continue
		}
		week.Habits = append(week.Habits, fmt.Sprintf("%s %d/%d 天", strings.TrimSpace(habit.Label), habit.Hit, habit.Of))
		if len(week.Habits) == maxDailyWeekHabits {
			break
		}
	}
	return week
}

func (s *Service) nowInChina() time.Time {
	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	return now.In(chinaTZ())
}

func (s *Service) chinaToday() string {
	return s.nowInChina().Format("2006-01-02")
}

// readNutritionStates reads today's and yesterday's state side by side. A failed read
// leaves that day nil and the pet falls back to its habit score; it never fails the tab.
func (s *Service) readNutritionStates(ctx context.Context, userID, today, yesterday string) (*healthdomain.DailyNutritionState, *healthdomain.DailyNutritionState) {
	if s.nutritionState == nil {
		return nil, nil
	}
	dates := []string{today, yesterday}
	states := make([]*healthdomain.DailyNutritionState, len(dates))
	var wg sync.WaitGroup
	for i, date := range dates {
		wg.Add(1)
		go func(i int, date string) {
			defer wg.Done()
			state, err := s.nutritionState.GetDailyNutritionState(ctx, userID, date)
			if err != nil {
				logger.Warn(ctx, "宠物读取每日营养状态失败",
					slog.String("user_id", userID),
					slog.String("date", date),
					logger.Err(err),
				)
				return
			}
			states[i] = state
		}(i, date)
	}
	wg.Wait()
	return states[0], states[1]
}

// autoClaimReview adds yesterday's review reward when the pet tab is opened. Claiming is
// idempotent, so repeated reads add it once.
func (s *Service) autoClaimReview(ctx context.Context, userID string, event *petdomain.UserPetEvent) (*DailyReportReward, bool) {
	if event == nil || (event.ExpReward <= 0 && event.CreditReward <= 0) {
		return nil, false
	}
	if event.IsClaimed {
		return &DailyReportReward{Exp: event.ExpReward, Credits: event.CreditReward}, false
	}
	result, err := s.ClaimEvent(ctx, userID, event.ID)
	if err != nil || result == nil {
		logger.Warn(ctx, "宠物日报自动领取失败",
			slog.String("user_id", userID),
			slog.String("event_id", event.ID),
			logger.Err(err),
		)
		return nil, false
	}
	return &DailyReportReward{Exp: result.ExpAwarded, Credits: result.CreditsAwarded, ClaimedNow: result.ExpAwarded > 0 || result.CreditsAwarded > 0}, true
}

func dailyReport(petName string, event *petdomain.UserPetEvent, today, yesterday *healthdomain.DailyNutritionState, todayDetails map[string]any) DailyReport {
	report := DailyReport{Facts: dailyFacts(yesterday, today)}
	switch {
	case yesterday != nil && yesterday.Coverage.TodayMeals > 0:
		report.Yesterday = firstNonEmpty(yesterday.Headline, joinFindings(yesterday.Findings, 2))
		if report.Yesterday == "" {
			report.Yesterday = fmt.Sprintf("昨天记了 %d 餐。", yesterday.Coverage.TodayMeals)
		}
		report.Source = "nutrition_state"
	case yesterday != nil:
		report.Yesterday = fmt.Sprintf("昨天没有记录，%s只能猜你吃了什么。", petName)
		report.Source = "nutrition_state"
	case event != nil:
		report.Yesterday = event.Message
		report.Source = "habit_review"
	}
	report.Today = todayAdvice(today, todayDetails)
	if report.Source == "" && today != nil {
		report.Source = "nutrition_state"
	}
	return report
}

func todayAdvice(state *healthdomain.DailyNutritionState, details map[string]any) string {
	if state == nil {
		return nextTask(details)
	}
	parts := make([]string, 0, 2)
	if gap := topGap(state.Gaps); gap != nil && strings.TrimSpace(gap.Text) != "" {
		parts = append(parts, "今天"+strings.TrimSpace(gap.Text))
	}
	if meal := state.NextMeal; meal != nil && strings.TrimSpace(meal.Advice) != "" {
		label := firstNonEmpty(meal.Label, "下一餐")
		parts = append(parts, label+"可以这样吃："+strings.TrimSpace(meal.Advice))
	}
	if len(parts) == 0 {
		if state.Coverage.TodayMeals == 0 {
			return "今天还没有记录，先记下第一餐。"
		}
		return strings.TrimSpace(state.Headline)
	}
	return strings.Join(parts, "。") + "。"
}

func dailyFacts(states ...*healthdomain.DailyNutritionState) []string {
	facts := make([]string, 0, maxDailyFacts)
	seen := map[string]struct{}{}
	for _, state := range states {
		if state == nil {
			continue
		}
		for _, finding := range state.Findings {
			text := strings.TrimSpace(finding.Text)
			if text == "" {
				continue
			}
			if _, ok := seen[text]; ok {
				continue
			}
			seen[text] = struct{}{}
			facts = append(facts, text)
			if len(facts) == maxDailyFacts {
				return facts
			}
		}
	}
	return facts
}

func joinFindings(findings []healthdomain.NutritionFinding, limit int) string {
	texts := make([]string, 0, limit)
	for _, finding := range findings {
		if text := strings.TrimSpace(finding.Text); text != "" {
			texts = append(texts, text)
		}
		if len(texts) == limit {
			break
		}
	}
	if len(texts) == 0 {
		return ""
	}
	return strings.Join(texts, "；") + "。"
}

// topGap is the engine's first gap; the engine already ranks the user's focus first.
func topGap(gaps []healthdomain.NutritionGap) *healthdomain.NutritionGap {
	if len(gaps) == 0 {
		return nil
	}
	return &gaps[0]
}

// petMood picks the strongest signal: a pet left alone gets sleepy; otherwise what went
// over a limit today or yesterday, then what fell short yesterday. Every reason quotes the
// state's own numbers.
func petMood(status PetStatus, today, yesterday *healthdomain.DailyNutritionState) PetMood {
	if status.InactivityDays >= 2 {
		return PetMood{Key: "sleepy", Label: "有点犯困", Reason: fmt.Sprintf("已经 %d 天没有记录了", status.InactivityDays), Icon: "moon"}
	}
	if mood, ok := overLimitMood(today, "今天"); ok {
		return mood
	}
	if mood, ok := overLimitMood(yesterday, "昨天"); ok {
		return mood
	}
	if mood, ok := shortfallMood(yesterday); ok {
		return mood
	}
	switch {
	case yesterday != nil && yesterday.Coverage.TodayMeals > 0:
		return PetMood{Key: "happy", Label: "心情不错", Reason: "昨天没有哪一项超标", Icon: "sun"}
	case today != nil && today.Coverage.TodayMeals > 0:
		return PetMood{Key: "happy", Label: "吃饱啦", Reason: fmt.Sprintf("今天已经记了 %d 餐", today.Coverage.TodayMeals), Icon: "sun"}
	case today != nil:
		return PetMood{Key: "hungry", Label: "肚子饿了", Reason: "今天还没有记录", Icon: "bowl"}
	}
	if status.MealState == "hungry" {
		return PetMood{Key: "hungry", Label: "肚子饿了", Reason: "今天还没有记录", Icon: "bowl"}
	}
	return PetMood{Key: "calm", Label: "状态平稳", Reason: "心情跟着你吃的和喝的变", Icon: "sun"}
}

var overLimitMoods = map[string]PetMood{
	"sodium":      {Key: "salty", Label: "有点咸", Icon: "salt"},
	"added_sugar": {Key: "sweet", Label: "甜得发腻", Icon: "candy"},
	"sat_fat":     {Key: "greasy", Label: "有点腻", Icon: "oil"},
	"energy":      {Key: "full", Label: "吃得有点撑", Icon: "bowl"},
}

func overLimitMood(state *healthdomain.DailyNutritionState, when string) (PetMood, bool) {
	if state == nil {
		return PetMood{}, false
	}
	var picked *healthdomain.NutrientReading
	pickedRatio := 0.0
	for i := range state.Today {
		reading := &state.Today[i]
		if _, ok := overLimitMoods[reading.Key]; !ok || reading.Status != healthdomain.NutrientStatusOver {
			continue
		}
		if reading.Value == nil || reading.Target <= 0 {
			continue
		}
		if ratio := *reading.Value / reading.Target; picked == nil || ratio > pickedRatio {
			picked, pickedRatio = reading, ratio
		}
	}
	if picked == nil {
		return PetMood{}, false
	}
	mood := overLimitMoods[picked.Key]
	mood.Reason = fmt.Sprintf("%s%s %s，超过 %s", when, picked.Label, formatAmount(*picked.Value, picked.Unit), formatAmount(picked.Target, picked.Unit))
	return mood, true
}

var shortfallMoods = []struct {
	key  string
	mood PetMood
}{
	{"water", PetMood{Key: "thirsty", Label: "今天有点渴", Icon: "drop"}},
	{"vegetables", PetMood{Key: "craving_greens", Label: "想吃点绿的", Icon: "leaf"}},
	{"fiber", PetMood{Key: "craving_greens", Label: "想吃点绿的", Icon: "leaf"}},
	{"protein", PetMood{Key: "craving_protein", Label: "想加个蛋", Icon: "egg"}},
}

func shortfallMood(state *healthdomain.DailyNutritionState) (PetMood, bool) {
	if state == nil || state.Coverage.TodayMeals == 0 {
		return PetMood{}, false
	}
	for _, candidate := range shortfallMoods {
		reading := findReading(state.Today, candidate.key)
		if reading == nil || reading.Status != healthdomain.NutrientStatusShort || reading.Value == nil {
			continue
		}
		mood := candidate.mood
		mood.Reason = fmt.Sprintf("昨天%s %s，目标 %s", reading.Label, formatAmount(*reading.Value, reading.Unit), formatAmount(reading.Target, reading.Unit))
		return mood, true
	}
	return PetMood{}, false
}

func dailyWater(state *healthdomain.DailyNutritionState, details map[string]any) DailyWater {
	water := DailyWater{GoalML: defaultWaterGoal, CupML: waterCupML}
	if state != nil {
		if reading := findReading(state.Today, "water"); reading != nil {
			if reading.Target > 0 {
				water.GoalML = int(reading.Target)
			}
			if reading.Value != nil {
				water.ML, water.Known = int(*reading.Value), true
			}
		}
		if !water.Known && state.Context.WaterMLToday != nil {
			water.ML, water.Known = int(*state.Context.WaterMLToday), true
		}
	}
	if !water.Known {
		if ml := intFromAny(details["water_ml"]); ml > 0 {
			water.ML, water.Known = ml, true
		}
	}
	water.Cups = water.ML / waterCupML
	water.GoalCups = (water.GoalML + waterCupML - 1) / waterCupML
	return water
}

func dailyNextMeal(state *healthdomain.DailyNutritionState, now time.Time) DailyNextMeal {
	if state != nil && state.NextMeal != nil && strings.TrimSpace(state.NextMeal.Label) != "" {
		meal := state.NextMeal
		return DailyNextMeal{
			MealType:        meal.MealType,
			Label:           meal.Label,
			Advice:          strings.TrimSpace(meal.Advice),
			StarterQuestion: "今天" + meal.Label + "吃什么？",
		}
	}
	mealType, label := mealForClock(now)
	return DailyNextMeal{MealType: mealType, Label: label, StarterQuestion: "今天" + label + "吃什么？"}
}

func mealForClock(now time.Time) (string, string) {
	minute := now.Hour()*60 + now.Minute()
	for _, rule := range mealPromptRules {
		if minute < rule.validEnd {
			return rule.mealType, rule.label
		}
	}
	return "evening_snack", "夜宵"
}

// petMemories is "宠物记得": the goal, the engine's notes about the user and their trends.
func petMemories(state *healthdomain.DailyNutritionState) []PetMemory {
	if state == nil {
		return []PetMemory{}
	}
	memories := make([]PetMemory, 0, maxPetMemories)
	seen := map[string]struct{}{}
	add := func(key, text, source string) {
		text = strings.TrimSpace(text)
		if text == "" || len(memories) == maxPetMemories {
			return
		}
		if _, ok := seen[text]; ok {
			return
		}
		seen[text] = struct{}{}
		memories = append(memories, PetMemory{Key: key, Text: text, Source: source})
	}
	if label := strings.TrimSpace(state.Plan.GoalLabel); label != "" {
		add("goal", label+"中", "plan")
	}
	if trend := state.Context.WeightTrend; trend != nil && trend.Days > 0 {
		add("weight_trend", fmt.Sprintf("%d 天体重 %+.1f 公斤", trend.Days, trend.KgChange), "weight")
	}
	if state.Context.TrainingToday {
		add("training_today", "今天有训练", "context")
	}
	for i, note := range state.Context.Notes {
		add(fmt.Sprintf("note_%d", i), note, "context")
	}
	return memories
}

func findReading(readings []healthdomain.NutrientReading, key string) *healthdomain.NutrientReading {
	for i := range readings {
		if readings[i].Key == key {
			return &readings[i]
		}
	}
	return nil
}

var amountUnits = map[string]string{"mg": "毫克", "g": "克", "ml": "毫升", "kcal": "千卡"}

// formatAmount prints a state number with its unit; it only rounds, never estimates.
func formatAmount(value float64, unit string) string {
	unit = strings.TrimSpace(unit)
	label := unit
	if mapped, ok := amountUnits[strings.ToLower(unit)]; ok {
		label = mapped
	}
	number := fmt.Sprintf("%.1f", value)
	switch strings.ToLower(unit) {
	case "mg", "ml", "kcal":
		number = fmt.Sprintf("%.0f", value)
	}
	number = strings.TrimSuffix(number, ".0")
	if label == "" {
		return number
	}
	return number + " " + label
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
