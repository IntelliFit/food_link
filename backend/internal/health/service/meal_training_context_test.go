package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTrainingTimingIsReadFromWhatTheUserSays(t *testing.T) {
	for _, question := range []string{
		"我一会要健身，推荐点吃的", "等会去练腿，吃什么", "待会要去跑步", "晚上要打篮球，现在吃点什么", "健身前吃什么", "马上去游泳，吃点啥",
		"我一会儿去撸铁，给我推荐清华的餐食", "半小时后训练，来点吃的", "准备去健身，推荐点吃的", "我想去跑步，吃什么", "我要去打篮球了",
	} {
		constraints := CampusDietRecommendationConstraints{}
		applyCampusDietAgentQuestionConstraints(&constraints, question)
		assert.Equal(t, "pre", constraints.Training, question)
	}
	for _, question := range []string{
		"我刚练完，吃什么", "刚健身完推荐点吃的", "练完腿了吃什么", "跑完步了想吃点东西", "训练后吃什么", "刚运动完，饿了", "健身完了，来点吃的", "游泳后吃什么", "打完球了饿了", "跑步后吃点啥", "明天要去健身，我刚练完腿，吃什么",
	} {
		constraints := CampusDietRecommendationConstraints{}
		applyCampusDietAgentQuestionConstraints(&constraints, question)
		assert.Equal(t, "post", constraints.Training, question)
	}
	for _, question := range []string{
		"我昨天健身了", "我不健身", "健身房附近有什么吃的", "我喜欢运动", "推荐增肌餐", "今天练了腿", "我不想运动了", "今天吃什么", "我在清华读书", "明早要去健身，今晚吃什么", "周六要去练腿，今天随便吃点", "我想去买运动鞋，顺便吃点", "我想去健身房附近吃", "运动员食堂在哪",
	} {
		constraints := CampusDietRecommendationConstraints{}
		applyCampusDietAgentQuestionConstraints(&constraints, question)
		assert.Empty(t, constraints.Training, question)
	}
}

func TestTrainingContextCarriesOverAndCanBeChangedOrCleared(t *testing.T) {
	active := &DietRecommendationResult{AgentConstraints: &CampusDietRecommendationConstraints{Version: mealRequirementVersion, Training: "pre"}}
	assert.Equal(t, "pre", resolveCampusDietAgentConstraints(nil, active, "换一批").Training, "a later turn about the same meal keeps the plan to train")
	assert.Equal(t, "post", resolveCampusDietAgentConstraints(nil, active, "我练完了，再推荐一下").Training)
	assert.Empty(t, resolveCampusDietAgentConstraints(nil, active, "不去健身了，换点别的").Training)
	assert.Empty(t, resolveCampusDietAgentConstraints(nil, active, "今天不练了，吃什么").Training)
}

// Engineering heuristics for one meal's timing, not a prescription: before a
// session the meal leans to carbohydrate with little fat and no heavy portion;
// after it, protein and carbohydrate both count and a low-protein bowl does not.
func TestWorkoutTimingShiftsTheMacroBandOfThisMealOnly(t *testing.T) {
	targets := DietRecommendationMacro{Calories: 2000, Protein: 100, Carbs: 250, Fat: 65}
	fit := func(training string, c DietRecommendationCandidate) float64 {
		ctx := dietDecisionContext{EngineVersion: dietDecisionEngineVersion, MealType: "lunch", Targets: targets, Remaining: targets}
		ctx.Constraints.Training = training
		return v3MacroFit(ctx, c)
	}
	burger := DietRecommendationCandidate{Calories: 700, Protein: 30, Carbs: 45, Fat: 40}
	pasta := DietRecommendationCandidate{Calories: 560, Protein: 14, Carbs: 100, Fat: 6}
	chicken := DietRecommendationCandidate{Calories: 520, Protein: 40, Carbs: 60, Fat: 8}

	assert.Greater(t, fit("", burger), fit("", pasta), "by default the burger's macros fit better than the pasta's")
	assert.Greater(t, fit("pre", pasta), fit("pre", burger), "before training a carbohydrate meal with little fat beats a fatty one")
	assert.Less(t, fit("pre", burger), fit("", burger))
	assert.Greater(t, fit("pre", pasta), fit("", pasta))
	assert.Less(t, fit("post", pasta), fit("", pasta), "after training a low-protein bowl is not enough")
	assert.InDelta(t, fit("", chicken), fit("post", chicken), 0.5, "a protein-and-carbohydrate meal is fine either way")
	require.Equal(t, fit("", chicken), fit("", chicken))
}

func TestWorkoutTimingDoesNotChangeTheContextKeyOfOrdinaryMeals(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.EngineVersion = dietDecisionEngineVersion
	before := mealPreviewContextKey(state)
	state.Constraints.Training = "pre"
	assert.NotEqual(t, before, mealPreviewContextKey(state), "a training plan is part of what the answer depends on")
	state.Constraints.Training = ""
	assert.Equal(t, before, mealPreviewContextKey(state), "without a plan the stored keys stay exactly as they were")
}

// The compare tool must score like the ranking does: with the user's constraints and
// workout timing, not against a blank context.
func TestComparisonsScoreWithTheConstraintsOfThisMeal(t *testing.T) {
	burger := DietRecommendationCandidate{Source: "public_food_library", SourceID: "burger", Title: "汉堡", Calories: 700, Protein: 30, Carbs: 45, Fat: 40}
	pasta := DietRecommendationCandidate{Source: "public_food_library", SourceID: "pasta", Title: "意面", Calories: 560, Protein: 14, Carbs: 100, Fat: 6}
	scoreOf := func(state *campusDietAgentRunState) map[string]float64 {
		out := map[string]float64{}
		for _, row := range campusDietAgentComparisons([]DietRecommendationCandidate{burger, pasta}, state) {
			out[row["source_id"].(string)] = anyFloat(row["health_fit_score"])
		}
		return out
	}
	plain := newComboTestState()
	pre := newComboTestState()
	pre.Constraints.Training = "pre"
	assert.Greater(t, scoreOf(plain)["burger"], scoreOf(plain)["pasta"])
	assert.Greater(t, scoreOf(pre)["pasta"], scoreOf(pre)["burger"], "before training the compare tool prefers the carbohydrate meal, like the ranking")

	limit := 600.0
	capped := newComboTestState()
	capped.Constraints.MaxCalories = &limit
	for _, row := range campusDietAgentComparisons([]DietRecommendationCandidate{burger, pasta}, capped) {
		violations, _ := row["constraint_violations"].([]string)
		if row["source_id"] == "burger" {
			assert.NotEmpty(t, violations, "700 kcal is over the 600 kcal limit for this meal")
		} else {
			assert.Empty(t, violations)
		}
	}
}

// The model may set workout timing and the dining scene from the user's own words when the
// rules miss them; the quoted words must be in this turn and about exercise or place.
func TestModelUpdatesSetTrainingAndSceneFromTheUsersWords(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.Question = "待会儿要去打场羽毛球赛，我在家不想出门，先垫点什么"
	n, err := applyMealRequirementUpdates(state, `{"updates":[
		{"field":"training","action":"set","value":"pre","evidence":"待会儿要去打场羽毛球赛"},
		{"field":"scene","action":"set","value":"takeout","evidence":"我在家不想出门"}]}`)
	require.NoError(t, err)
	assert.Equal(t, 2, n)
	assert.Equal(t, "pre", state.Constraints.Training)
	assert.Equal(t, "takeout", state.Constraints.Scene)

	guessed := newCampusDietAgentTestState("initial", nil)
	guessed.Question = "我今天好累，吃点什么"
	n, err = applyMealRequirementUpdates(guessed, `{"updates":[
		{"field":"training","action":"set","value":"post","evidence":"我今天好累"},
		{"field":"scene","action":"set","value":"takeout","evidence":"昨天说过在家"}]}`)
	require.NoError(t, err)
	assert.Zero(t, n, "tiredness is not a workout, and words from another turn are not evidence")
	assert.Empty(t, guessed.Constraints.Training)
}
