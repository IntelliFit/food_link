package service

import (
	"context"
	"errors"
	"testing"
	"time"

	healthdomain "food_link/backend/internal/health/domain"
	"food_link/backend/internal/pet/repo"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeNutritionStateReader struct {
	states map[string]*healthdomain.DailyNutritionState
	err    error
	calls  map[string]int
}

func (f *fakeNutritionStateReader) GetDailyNutritionState(_ context.Context, _ string, date string) (*healthdomain.DailyNutritionState, error) {
	if f.calls == nil {
		f.calls = map[string]int{}
	}
	f.calls[date]++
	if f.err != nil {
		return nil, f.err
	}
	return f.states[date], nil
}

func floatPtr(v float64) *float64 { return &v }

func newDailyTestService(fake *fakePetRepo, reader NutritionStateReader) *Service {
	svc := NewService(fake)
	svc.now = func() time.Time { return time.Date(2026, 11, 4, 11, 0, 0, 0, chinaTZ()) }
	if reader != nil {
		svc.ConfigureNutritionStateReader(reader)
	}
	return svc
}

func newDailyTestRepo() *fakePetRepo {
	fake := newFakePetRepo()
	fake.profile = &repo.UserProfile{ID: "user-1"}
	return fake
}

func fiberShortState(fiber float64, meals int) *healthdomain.DailyNutritionState {
	return &healthdomain.DailyNutritionState{
		Date:     "2026-11-04",
		Coverage: healthdomain.NutritionCoverage{RecordedDays: 6, TodayMeals: meals, EnoughData: true},
		Plan:     healthdomain.NutritionPlanSummary{Goal: "fat_loss", GoalLabel: "减脂"},
		Today: []healthdomain.NutrientReading{
			{Key: "protein", Label: "蛋白质", Unit: "g", Value: floatPtr(52), Target: 95, Kind: "min", Status: healthdomain.NutrientStatusShort, Gap: 43},
			{Key: "fiber", Label: "膳食纤维", Unit: "g", Value: floatPtr(fiber), Target: 25, Kind: "min", Status: healthdomain.NutrientStatusShort, Gap: 25 - fiber},
		},
		// The engine ranks the user's focus first; severity alone would pick protein.
		Gaps: []healthdomain.NutritionGap{
			{Key: "fiber", Label: "膳食纤维", Text: "纤维还差 14g", Severity: 0.3},
			{Key: "protein", Label: "蛋白质", Text: "蛋白质还差 43g", Severity: 0.9},
		},
		NextMeal: &healthdomain.NutritionNextMeal{MealType: "lunch", Label: "午餐", Advice: "一份深色蔬菜 + 鱼或豆腐"},
		Context:  healthdomain.NutritionContext{Notes: []string{"周三、周五练腿", "不吃香菜"}, WeightTrend: &healthdomain.NutritionWeightTrend{KgChange: -0.6, Days: 14}},
		Headline: "这周蔬菜跟上了，盐还偏多：6 天里有 4 天钠超过 2000 毫克。",
	}
}

func TestDailyTaskTargetsTopGapAndCompletesOnceAfterRecord(t *testing.T) {
	fake := newDailyTestRepo()
	reader := &fakeNutritionStateReader{states: map[string]*healthdomain.DailyNutritionState{
		"2026-11-04": fiberShortState(11, 1),
	}}
	svc := newDailyTestService(fake, reader)

	first, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	require.NotNil(t, first.Task)
	assert.Equal(t, "2026-11-04", first.Date)
	assert.Equal(t, "fiber", first.Task.Key)
	assert.Equal(t, dailyTaskKindFill, first.Task.Kind)
	assert.Equal(t, "纤维还差 14g", first.Task.Reason)
	assert.Equal(t, 6.0, first.Task.Goal)
	assert.Equal(t, 0.0, first.Task.Progress)
	assert.False(t, first.Task.Done)
	assert.Equal(t, dailyTaskExpReward, first.Task.ExpReward)
	expBefore := first.Pet.Experience

	reader.states["2026-11-04"] = fiberShortState(14, 2)
	partial, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	assert.Equal(t, 3.0, partial.Task.Progress)
	assert.False(t, partial.Task.Done)
	assert.Equal(t, expBefore, partial.Pet.Experience)

	reader.states["2026-11-04"] = fiberShortState(18, 3)
	done, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	assert.Equal(t, "fiber", done.Task.Key, "the day's task stays the same after the gaps move")
	assert.True(t, done.Task.Done)
	assert.True(t, done.Task.JustDone)
	assert.Equal(t, 6.0, done.Task.Progress)
	assert.Equal(t, expBefore+dailyTaskExpReward, done.Pet.Experience)

	again, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	assert.True(t, again.Task.Done)
	assert.False(t, again.Task.JustDone)
	assert.Equal(t, expBefore+dailyTaskExpReward, again.Pet.Experience)
	assert.Equal(t, 1, fake.startTaskCalls)
}

func TestDailyRecalculatedScoreKeepsStoredTask(t *testing.T) {
	fake := newDailyTestRepo()
	reader := &fakeNutritionStateReader{states: map[string]*healthdomain.DailyNutritionState{
		"2026-11-04": fiberShortState(11, 1),
	}}
	svc := newDailyTestService(fake, reader)

	_, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	// Summary recalculates the habit details of the same day.
	_, err = svc.Summary(context.Background(), "user-1", "2026-11-04")
	require.NoError(t, err)

	stored, ok := storedTaskFromDetails(fake.dailyScores["2026-11-04"].ScoreDetails)
	require.True(t, ok)
	assert.Equal(t, "fiber", stored.Key)
	assert.Equal(t, 11.0, stored.Baseline)
}

func TestDailyWaterTaskCountsCups(t *testing.T) {
	fake := newDailyTestRepo()
	state := func(ml float64) *healthdomain.DailyNutritionState {
		return &healthdomain.DailyNutritionState{
			Coverage: healthdomain.NutritionCoverage{TodayMeals: 1},
			Today: []healthdomain.NutrientReading{
				{Key: "water", Label: "喝水", Unit: "ml", Value: floatPtr(ml), Target: 1500, Kind: "min", Status: healthdomain.NutrientStatusShort, Gap: 1500 - ml},
			},
			Gaps: []healthdomain.NutritionGap{{Key: "water", Label: "喝水", Text: "水还差 1000 毫升", Severity: 0.7}},
		}
	}
	reader := &fakeNutritionStateReader{states: map[string]*healthdomain.DailyNutritionState{"2026-11-04": state(500)}}
	svc := newDailyTestService(fake, reader)

	first, err := svc.Daily(context.Background(), "user-1", "2026-11-04")
	require.NoError(t, err)
	require.NotNil(t, first.Task)
	assert.Equal(t, "喝够 6 杯水", first.Task.Title)
	assert.Equal(t, dailyTaskActionWater, first.Task.Action)
	assert.Equal(t, 2.0, first.Task.Progress)
	assert.Equal(t, 6.0, first.Task.Goal)
	assert.True(t, first.Water.IsTaskGoal)
	assert.Equal(t, 2, first.Water.Cups)
	assert.Equal(t, 6, first.Water.GoalCups)

	reader.states["2026-11-04"] = state(1500)
	done, err := svc.Daily(context.Background(), "user-1", "2026-11-04")
	require.NoError(t, err)
	assert.True(t, done.Task.Done)
	assert.True(t, done.Task.JustDone)
}

func TestDailyLightTaskJudgesTheNewMealsOnAverage(t *testing.T) {
	fake := newDailyTestRepo()
	state := func(sodium float64, meals, unknown int) *healthdomain.DailyNutritionState {
		return &healthdomain.DailyNutritionState{
			Coverage: healthdomain.NutritionCoverage{TodayMeals: meals},
			Today: []healthdomain.NutrientReading{
				{Key: "sodium", Label: "钠", Unit: "mg", Value: floatPtr(sodium), Target: 2000, Kind: "max", Status: healthdomain.NutrientStatusOver, UnknownMeals: unknown},
			},
			Gaps: []healthdomain.NutritionGap{{Key: "sodium", Label: "钠", Text: "钠已经 2100 毫克", Severity: 0.8}},
		}
	}
	reader := &fakeNutritionStateReader{states: map[string]*healthdomain.DailyNutritionState{"2026-11-04": state(2100, 2, 0)}}
	svc := newDailyTestService(fake, reader)

	first, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	assert.Equal(t, dailyTaskKindLight, first.Task.Kind)
	assert.Equal(t, "下一餐清淡点，汤和酱汁少一点", first.Task.Title)
	assert.Equal(t, "有点咸", first.Mood.Label)
	assert.Equal(t, "今天钠 2100 毫克，超过 2000 毫克", first.Mood.Reason)

	// A meal without sodium data cannot pass.
	reader.states["2026-11-04"] = state(2100, 3, 1)
	unknown, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	assert.False(t, unknown.Task.Done)

	// A salty meal keeps the task open.
	reader.states["2026-11-04"] = state(3300, 4, 1)
	heavy, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	assert.False(t, heavy.Task.Done)

	// A light meal afterwards brings the new meals' average under the limit.
	reader.states["2026-11-04"] = state(3600, 5, 1)
	light, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	assert.True(t, light.Task.Done)
	assert.True(t, light.Task.JustDone)
}

func TestDailyFallsBackToRecordTaskWithoutNutritionState(t *testing.T) {
	fake := newDailyTestRepo()
	svc := newDailyTestService(fake, &fakeNutritionStateReader{err: errors.New("engine down")})

	first, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	assert.False(t, first.StateReady)
	require.NotNil(t, first.Task)
	assert.Equal(t, "record_meal", first.Task.Key)
	assert.Equal(t, "记录今天的第一餐", first.Task.Title)
	assert.Equal(t, "记录一餐，唤醒今日成长", first.Report.Today)
	assert.Empty(t, first.Memories)
	assert.Equal(t, "lunch", first.NextMeal.MealType)
	assert.Equal(t, "今天午餐吃什么？", first.NextMeal.StarterQuestion)

	recordTime := time.Date(2026, 11, 4, 12, 0, 0, 0, chinaTZ())
	fake.foodByDate["2026-11-04"] = []repo.FoodRecord{{MealType: "lunch", TotalCalories: 600, TotalProtein: 30, RecordTime: &recordTime}}
	done, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	assert.True(t, done.Task.Done)
	assert.True(t, done.Task.JustDone)
}

func TestDailyDoesNotStartTasksForPastDays(t *testing.T) {
	fake := newDailyTestRepo()
	svc := newDailyTestService(fake, &fakeNutritionStateReader{})

	daily, err := svc.Daily(context.Background(), "user-1", "2026-11-01")
	require.NoError(t, err)
	assert.Nil(t, daily.Task)
	assert.Equal(t, 0, fake.startTaskCalls)
}

func TestDailyAddsYesterdaysReviewRewardOnce(t *testing.T) {
	fake := newDailyTestRepo()
	fake.foodByDate["2026-11-03"] = []repo.FoodRecord{
		{MealType: "breakfast", TotalCalories: 500, TotalProtein: 30},
		{MealType: "lunch", TotalCalories: 700, TotalProtein: 35},
		{MealType: "dinner", TotalCalories: 600, TotalProtein: 25},
	}
	fake.waterByDate["2026-11-03"] = 1800
	svc := newDailyTestService(fake, nil)

	first, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	require.NotNil(t, first.Report.Reward)
	assert.True(t, first.Report.Reward.ClaimedNow)
	assert.Equal(t, 1, first.Report.Reward.Credits)
	assert.Positive(t, first.Report.Reward.Exp)
	assert.Equal(t, "habit_review", first.Report.Source)
	assert.Contains(t, first.Report.Yesterday, first.Pet.Name)
	assert.Equal(t, 1, fake.balance)

	second, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)
	require.NotNil(t, second.Report.Reward)
	assert.False(t, second.Report.Reward.ClaimedNow)
	assert.Equal(t, first.Pet.Experience, second.Pet.Experience)
	assert.Equal(t, 1, fake.balance)
}

func TestDailyReportQuotesTheStateWithoutNewNumbers(t *testing.T) {
	yesterday := &healthdomain.DailyNutritionState{
		Coverage: healthdomain.NutritionCoverage{TodayMeals: 3},
		Headline: "三餐都记了，蛋白质够了，钠到了 2600 毫克。",
		Findings: []healthdomain.NutritionFinding{{Key: "sodium_over", Kind: "over", Text: "钠 2600 毫克，超过 2000 毫克"}},
	}
	today := fiberShortState(11, 1)
	today.Findings = []healthdomain.NutritionFinding{{Key: "fiber_short", Kind: "short", Text: "这周纤维 6 天里 3 天不到一半"}}

	report := dailyReport("小麦", nil, today, yesterday, nil)

	assert.Equal(t, "三餐都记了，蛋白质够了，钠到了 2600 毫克。", report.Yesterday)
	assert.Equal(t, "今天纤维还差 14g。午餐可以这样吃：一份深色蔬菜 + 鱼或豆腐。", report.Today)
	assert.Equal(t, []string{"钠 2600 毫克，超过 2000 毫克", "这周纤维 6 天里 3 天不到一半"}, report.Facts)
	assert.Equal(t, "nutrition_state", report.Source)

	empty := dailyReport("小麦", nil, today, &healthdomain.DailyNutritionState{}, nil)
	assert.Equal(t, "昨天没有记录，小麦只能猜你吃了什么。", empty.Yesterday)
}

func TestPetMoodFollowsWhatWasEatenAndDrunk(t *testing.T) {
	salty := &healthdomain.DailyNutritionState{
		Coverage: healthdomain.NutritionCoverage{TodayMeals: 3},
		Today: []healthdomain.NutrientReading{
			{Key: "sodium", Label: "钠", Unit: "mg", Value: floatPtr(2600), Target: 2000, Kind: "max", Status: healthdomain.NutrientStatusOver},
			{Key: "water", Label: "喝水", Unit: "ml", Value: floatPtr(800), Target: 1500, Kind: "min", Status: healthdomain.NutrientStatusShort},
		},
	}
	mood := petMood(PetStatus{}, &healthdomain.DailyNutritionState{}, salty)
	assert.Equal(t, "salty", mood.Key)
	assert.Equal(t, "昨天钠 2600 毫克，超过 2000 毫克", mood.Reason)

	thirsty := &healthdomain.DailyNutritionState{
		Coverage: healthdomain.NutritionCoverage{TodayMeals: 3},
		Today: []healthdomain.NutrientReading{
			{Key: "water", Label: "喝水", Unit: "ml", Value: floatPtr(800), Target: 1500, Kind: "min", Status: healthdomain.NutrientStatusShort},
		},
	}
	mood = petMood(PetStatus{}, nil, thirsty)
	assert.Equal(t, "今天有点渴", mood.Label)
	assert.Equal(t, "昨天喝水 800 毫升，目标 1500 毫升", mood.Reason)

	mood = petMood(PetStatus{InactivityDays: 3}, nil, salty)
	assert.Equal(t, "sleepy", mood.Key)

	mood = petMood(PetStatus{}, &healthdomain.DailyNutritionState{}, nil)
	assert.Equal(t, "hungry", mood.Key)
}

func TestPetMemoriesComeFromPlanAndContext(t *testing.T) {
	memories := petMemories(fiberShortState(11, 1))

	texts := make([]string, 0, len(memories))
	for _, memory := range memories {
		texts = append(texts, memory.Text)
	}
	assert.Equal(t, []string{"减脂中", "14 天体重 -0.6 公斤", "周三、周五练腿", "不吃香菜"}, texts)
}

func TestDailyTabFieldsFollowTheEngineOrderAndFocus(t *testing.T) {
	fake := newDailyTestRepo()
	state := fiberShortState(11, 2)
	state.Today = append(state.Today,
		healthdomain.NutrientReading{Key: "sodium", Label: "钠", Unit: "mg", Value: floatPtr(1900), Target: 2000, Kind: "max", Status: healthdomain.NutrientStatusNearLimit},
		healthdomain.NutrientReading{Key: "added_sugar", Label: "添加糖", Unit: "g", Value: floatPtr(60), Target: 50, Kind: "max", Status: healthdomain.NutrientStatusOver},
	)
	overall, lastWeek := 64, 58
	state.Scores = healthdomain.NutritionScores{Overall: &overall, OverallLastWeek: &lastWeek}
	state.Week = healthdomain.NutritionWeek{Habits: []healthdomain.NutritionHabit{
		{Key: "vegetables", Label: "蔬菜够量", Hit: 5, Of: 6},
		{Key: "sodium", Label: "钠没超", Hit: 2, Of: 6},
		{Key: "fruit", Label: "水果", Hit: 1, Of: 6},
	}}
	state.Focus = []healthdomain.NutritionFocusChoice{{Key: "hypertension", Title: "控血压"}}
	reader := &fakeNutritionStateReader{states: map[string]*healthdomain.DailyNutritionState{"2026-11-04": state}}
	svc := newDailyTestService(fake, reader)

	daily, err := svc.Daily(context.Background(), "user-1", "")
	require.NoError(t, err)

	assert.Equal(t, "这周蔬菜跟上了，盐还偏多：6 天里有 4 天钠超过 2000 毫克。", daily.Headline)
	assert.Equal(t, 2, daily.MealsToday)
	require.Len(t, daily.Gaps, 3)
	assert.Equal(t, DailyGapRow{Key: "fiber", Label: "膳食纤维", Text: "差 14 克", Status: healthdomain.NutrientStatusShort, Percent: 44}, daily.Gaps[0])
	assert.Equal(t, DailyGapRow{Key: "protein", Label: "蛋白质", Text: "差 43 克", Status: healthdomain.NutrientStatusShort, Percent: 55}, daily.Gaps[1])
	assert.Equal(t, DailyGapRow{Key: "sodium", Label: "钠", Text: "快到上限", Status: healthdomain.NutrientStatusNearLimit, Percent: 95, Warn: true}, daily.Gaps[2])
	assert.Equal(t, "fiber", daily.Task.Key)
	require.NotNil(t, daily.Week.Score)
	require.NotNil(t, daily.Week.Delta)
	assert.Equal(t, 64, *daily.Week.Score)
	assert.Equal(t, 6, *daily.Week.Delta)
	assert.Equal(t, []string{"蔬菜够量 5/6 天", "钠没超 2/6 天"}, daily.Week.Habits)
	assert.Equal(t, []healthdomain.NutritionFocusChoice{{Key: "hypertension", Title: "控血压"}}, daily.Focus)
}

func TestDailyGapRowsShowOverLimitsAndSkipUnknowns(t *testing.T) {
	rows := dailyGapRows(&healthdomain.DailyNutritionState{
		Today: []healthdomain.NutrientReading{
			{Key: "added_sugar", Label: "添加糖", Unit: "g", Value: nil, Target: 50, Kind: "max", Status: healthdomain.NutrientStatusUnknown},
			{Key: "sodium", Label: "钠", Unit: "mg", Value: floatPtr(2600), Target: 2000, Kind: "max", Status: healthdomain.NutrientStatusOver},
		},
		Gaps: []healthdomain.NutritionGap{{Key: "vegetables", Label: "蔬菜", Text: "蔬菜还差约 200 克"}},
	})

	assert.Equal(t, []DailyGapRow{
		{Key: "vegetables", Label: "蔬菜", Text: "蔬菜还差约 200 克"},
		{Key: "sodium", Label: "钠", Text: "超了 600 毫克", Status: healthdomain.NutrientStatusOver, Percent: 100, Warn: true},
	}, rows)
	assert.Empty(t, dailyGapRows(nil))
}
