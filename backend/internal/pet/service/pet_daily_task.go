package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	healthdomain "food_link/backend/internal/health/domain"
	petdomain "food_link/backend/internal/pet/domain"
	"food_link/backend/internal/pet/repo"
	"food_link/backend/pkg/logger"
)

// The pet's daily task aims at the first gap of the day's nutrition state. It is picked
// on the first pet read of the day, stored on that day's score row with a baseline, and
// completes by itself once later records close the gap: no claim tap. The experience is
// added once per day by repo.CompleteDailyTask.

const (
	dailyTaskExpReward = 20

	dailyTaskKindFill   = "fill"   // reach an amount more than the baseline (protein, fiber, ...)
	dailyTaskKindLight  = "light"  // record a meal that adds little of something over its limit
	dailyTaskKindWater  = "water"  // reach the day's water goal
	dailyTaskKindRecord = "record" // record one more meal

	dailyTaskActionRecord = "record"
	dailyTaskActionWater  = "water"
)

type DailyTask struct {
	Key       string  `json:"key"`
	Kind      string  `json:"kind"`
	Title     string  `json:"title"`
	Reason    string  `json:"reason"`
	Unit      string  `json:"unit"`
	Progress  float64 `json:"progress"`
	Goal      float64 `json:"goal"`
	Done      bool    `json:"done"`
	JustDone  bool    `json:"just_done"`
	ExpReward int     `json:"exp_reward"`
	DoneAt    string  `json:"done_at,omitempty"`
	Action    string  `json:"action"`
}

// storedDailyTask is the JSON kept under score_details.daily_task.
type storedDailyTask struct {
	Key             string  `json:"key"`
	Kind            string  `json:"kind"`
	Title           string  `json:"title"`
	Reason          string  `json:"reason"`
	Unit            string  `json:"unit"`
	Goal            float64 `json:"goal"`
	GoalML          int     `json:"goal_ml,omitempty"`
	Baseline        float64 `json:"baseline"`
	BaselineMeals   int     `json:"baseline_meals"`
	BaselineUnknown int     `json:"baseline_unknown"`
	ExpReward       int     `json:"exp_reward"`
	Action          string  `json:"action"`
	CreatedAt       string  `json:"created_at"`
	Done            bool    `json:"done"`
	DoneAt          string  `json:"done_at,omitempty"`
}

type dailyTaskTemplate struct {
	kind  string
	title string
	unit  string
	// portion is the amount one meal should add (fill) or may add at most (light).
	portion float64
}

var dailyTaskTemplates = map[string]dailyTaskTemplate{
	"vegetables":  {kind: dailyTaskKindFill, title: "午饭或晚饭加一份深色蔬菜", unit: "份", portion: 1},
	"fiber":       {kind: dailyTaskKindFill, title: "加一份蔬菜、豆类或粗粮", unit: "g", portion: 6},
	"protein":     {kind: dailyTaskKindFill, title: "下一餐加一份鱼、蛋、豆腐或瘦肉", unit: "g", portion: 20},
	"potassium":   {kind: dailyTaskKindFill, title: "加一份深色蔬菜或一个水果", unit: "mg", portion: 600},
	"calcium":     {kind: dailyTaskKindFill, title: "喝一杯奶或加一份豆腐", unit: "mg", portion: 250},
	"water":       {kind: dailyTaskKindWater, title: "喝够 %d 杯水", unit: "杯"},
	"sodium":      {kind: dailyTaskKindLight, title: "下一餐清淡点，汤和酱汁少一点", unit: "mg", portion: 800},
	"added_sugar": {kind: dailyTaskKindLight, title: "下一餐不配含糖饮料和甜点", unit: "g", portion: 5},
	"sat_fat":     {kind: dailyTaskKindLight, title: "下一餐少点油炸和肥肉", unit: "g", portion: 6},
	"energy":      {kind: dailyTaskKindLight, title: "下一餐吃到七分饱", unit: "kcal", portion: 600},
}

// dailyTask returns the day's task, creating it on today's first read and completing it
// when the current state shows the gap closed. changed reports that experience was added.
func (s *Service) dailyTask(ctx context.Context, userID string, pet *petdomain.UserPet, date string, isToday bool, score *petdomain.UserPetDailyScore, state *healthdomain.DailyNutritionState) (*DailyTask, bool, error) {
	if score == nil || pet == nil {
		return nil, false, nil
	}
	stored, ok := storedTaskFromDetails(score.ScoreDetails)
	if !ok {
		if !isToday {
			return nil, false, nil
		}
		created := newDailyTask(state, score.ScoreDetails, s.nowInChina())
		payload, err := taskPayload(created)
		if err != nil {
			return nil, false, err
		}
		applied, err := s.repo.StartDailyTask(ctx, userID, date, payload)
		if err != nil {
			return nil, false, err
		}
		if applied {
			stored = created
		} else {
			// Another read stored the day's task first; use that one.
			current, err := s.repo.GetDailyScore(ctx, userID, date)
			if err != nil {
				return nil, false, err
			}
			if current == nil {
				return nil, false, nil
			}
			if stored, ok = storedTaskFromDetails(current.ScoreDetails); !ok {
				return nil, false, nil
			}
		}
	}

	view := evaluateDailyTask(stored, state, score.ScoreDetails)
	if view.Done || !isToday || !taskGoalReached(stored, state, score.ScoreDetails) {
		return &view, false, nil
	}
	doneAt := s.nowInChina().Format(time.RFC3339)
	_, awarded, err := s.repo.CompleteDailyTask(ctx, userID, pet.ID, date, map[string]any{
		"done":        true,
		"done_at":     doneAt,
		"exp_awarded": stored.ExpReward,
	}, stored.ExpReward)
	if err != nil {
		return nil, false, err
	}
	view.Done = true
	view.DoneAt = doneAt
	view.Progress = view.Goal
	view.JustDone = awarded
	if awarded {
		logger.Info(ctx, "宠物每日任务自动完成",
			slog.String("user_id", userID),
			slog.String("date", date),
			slog.String("task_key", stored.Key),
			slog.Int("exp_reward", stored.ExpReward),
		)
	}
	return &view, awarded, nil
}

// newDailyTask aims at the first gap, in the engine's order, that the next record can
// close. The engine puts the user's focus first (血压 → 钠 …), so the task follows it.
func newDailyTask(state *healthdomain.DailyNutritionState, details map[string]any, now time.Time) storedDailyTask {
	createdAt := now.Format(time.RFC3339)
	if state != nil {
		for _, gap := range state.Gaps {
			if task, ok := taskForGap(gap, state); ok {
				task.CreatedAt = createdAt
				return task
			}
		}
	}
	meals := mealsToday(state, details)
	title := "记录今天的第一餐"
	if meals > 0 {
		title = "把下一餐也记下来"
	}
	return storedDailyTask{
		Key:           "record_meal",
		Kind:          dailyTaskKindRecord,
		Title:         title,
		Reason:        "记下来，我才知道今天还差什么",
		Unit:          "餐",
		Goal:          1,
		BaselineMeals: meals,
		ExpReward:     dailyTaskExpReward,
		Action:        dailyTaskActionRecord,
		CreatedAt:     createdAt,
	}
}

func taskForGap(gap healthdomain.NutritionGap, state *healthdomain.DailyNutritionState) (storedDailyTask, bool) {
	template, ok := dailyTaskTemplates[gap.Key]
	if !ok {
		return storedDailyTask{}, false
	}
	reading := findReading(state.Today, gap.Key)
	task := storedDailyTask{
		Key:           gap.Key,
		Kind:          template.kind,
		Title:         template.title,
		Reason:        strings.TrimSpace(gap.Text),
		Unit:          template.unit,
		BaselineMeals: state.Coverage.TodayMeals,
		ExpReward:     dailyTaskExpReward,
		Action:        dailyTaskActionRecord,
	}
	switch template.kind {
	case dailyTaskKindWater:
		goalML := defaultWaterGoal
		if reading != nil && reading.Target > 0 {
			goalML = int(reading.Target)
		}
		cups := (goalML + waterCupML - 1) / waterCupML
		task.Title = fmt.Sprintf(template.title, cups)
		task.Goal = float64(cups)
		task.GoalML = goalML
		task.Action = dailyTaskActionWater
		return task, true
	case dailyTaskKindFill:
		if reading == nil || reading.Status != healthdomain.NutrientStatusShort {
			return storedDailyTask{}, false
		}
		need := template.portion
		if reading.Gap > 0 && reading.Gap < need {
			need = reading.Gap
		}
		task.Goal = roundTaskAmount(need, template.unit)
		task.Baseline = valueOrZero(reading.Value)
		task.BaselineUnknown = reading.UnknownMeals
		return task, task.Goal > 0
	case dailyTaskKindLight:
		if reading == nil || (reading.Status != healthdomain.NutrientStatusOver && reading.Status != healthdomain.NutrientStatusNearLimit) {
			return storedDailyTask{}, false
		}
		task.Goal = 1
		task.Unit = "餐"
		task.Baseline = valueOrZero(reading.Value)
		task.BaselineUnknown = reading.UnknownMeals
		return task, true
	}
	return storedDailyTask{}, false
}

// evaluateDailyTask is the task as the user sees it now; it never awards anything.
func evaluateDailyTask(task storedDailyTask, state *healthdomain.DailyNutritionState, details map[string]any) DailyTask {
	view := DailyTask{
		Key:       task.Key,
		Kind:      task.Kind,
		Title:     task.Title,
		Reason:    task.Reason,
		Unit:      task.Unit,
		Goal:      task.Goal,
		Done:      task.Done,
		ExpReward: task.ExpReward,
		DoneAt:    task.DoneAt,
		Action:    task.Action,
	}
	if task.Done {
		view.Progress = task.Goal
		return view
	}
	view.Progress = math.Min(taskProgress(task, state, details), task.Goal)
	return view
}

func taskProgress(task storedDailyTask, state *healthdomain.DailyNutritionState, details map[string]any) float64 {
	switch task.Kind {
	case dailyTaskKindWater:
		water := dailyWater(state, details)
		return float64(water.ML / waterCupML)
	case dailyTaskKindFill:
		if state == nil {
			return 0
		}
		reading := findReading(state.Today, task.Key)
		if reading == nil {
			return 0
		}
		if reading.Status == healthdomain.NutrientStatusOK {
			return task.Goal
		}
		if reading.Value == nil {
			return 0
		}
		return math.Max(0, roundTaskAmount(*reading.Value-task.Baseline, task.Unit))
	case dailyTaskKindLight:
		if lightMealRecorded(task, state) {
			return 1
		}
		return 0
	default:
		if mealsToday(state, details) > task.BaselineMeals {
			return 1
		}
		return 0
	}
}

func taskGoalReached(task storedDailyTask, state *healthdomain.DailyNutritionState, details map[string]any) bool {
	if task.Kind == dailyTaskKindWater {
		water := dailyWater(state, details)
		goal := task.GoalML
		if goal <= 0 {
			goal = int(task.Goal) * waterCupML
		}
		return water.Known && water.ML >= goal
	}
	return task.Goal > 0 && taskProgress(task, state, details) >= task.Goal
}

// lightMealRecorded: the meals recorded since the task began added, on average, at most
// the template's portion of the over-limit nutrient. Only the day's totals are known, so
// a heavy meal followed by a light one can still pass; meals without data for the
// nutrient are left out, and none with data means not yet.
func lightMealRecorded(task storedDailyTask, state *healthdomain.DailyNutritionState) bool {
	if state == nil {
		return false
	}
	reading := findReading(state.Today, task.Key)
	if reading == nil || reading.Value == nil {
		return false
	}
	newMeals := state.Coverage.TodayMeals - task.BaselineMeals
	knownMeals := newMeals - max(0, reading.UnknownMeals-task.BaselineUnknown)
	if knownMeals <= 0 {
		return false
	}
	added := *reading.Value - task.Baseline
	return added/float64(knownMeals) <= dailyTaskTemplates[task.Key].portion
}

func mealsToday(state *healthdomain.DailyNutritionState, details map[string]any) int {
	if state != nil {
		return state.Coverage.TodayMeals
	}
	return intFromAny(details["record_count"])
}

func storedTaskFromDetails(details map[string]any) (storedDailyTask, bool) {
	raw, ok := details[repo.DailyTaskDetailsKey]
	if !ok || raw == nil {
		return storedDailyTask{}, false
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return storedDailyTask{}, false
	}
	var task storedDailyTask
	if err := json.Unmarshal(encoded, &task); err != nil || task.Key == "" {
		return storedDailyTask{}, false
	}
	return task, true
}

func taskPayload(task storedDailyTask) (map[string]any, error) {
	encoded, err := json.Marshal(task)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{}
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func roundTaskAmount(value float64, unit string) float64 {
	switch strings.ToLower(unit) {
	case "mg", "ml", "kcal":
		return math.Round(value)
	}
	return math.Round(value*10) / 10
}

func valueOrZero(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}
