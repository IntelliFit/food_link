package service

import (
	"fmt"
	"regexp"
)

// The meal Agent answers in two steps, like the home meal card: the options this turn's
// own search finds go to the user right away, picked by the rules, and the model's choice
// replaces them when it is ready. A slow or failing model channel then costs the user
// nothing but the explanation.

// mealPreferenceWords are requests only the model turns into conditions (set_meal_preferences).
// A search before that would ignore them, so such questions skip the early options.
var mealPreferenceWords = regexp.MustCompile(`不吃|不要|不能有|不含|忌口|避开|过敏|想吃|想喝|清淡|少油|少辣|不辣|吃素|素食|口味|换一|换个|换成|改成`)

func mealQuestionNeedsModelPreferences(question string) bool {
	return mealPreferenceWords.MatchString(question)
}

const mealProvisionalReason = "先按你这餐的条件挑出来的，还在细看。"

// emitProvisionalMeals sends the rule-picked options of the search just run. Nothing is
// saved or charged for them; the turn's final diet_result replaces them.
func emitProvisionalMeals(state *campusDietAgentRunState) {
	if state.Provisional == nil {
		return
	}
	limit := mealStateOptionLimit(state)
	selections := make([]campusDietAgentFinalSelection, 0, limit)
	for _, candidate := range mealFreshFeasibleChoices(state) {
		if len(selections) >= limit {
			break
		}
		selections = append(selections, campusDietAgentFinalSelection{SourceID: candidate.SourceID, Reason: mealProvisionalReason})
	}
	if len(selections) == 0 {
		return
	}
	result, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: selections}, false, "provisional")
	if err != nil || len(result.Recommendation.Recommendations) == 0 {
		return
	}
	count := len(result.Recommendation.Recommendations)
	result.Provisional = true
	result.Answer = fmt.Sprintf("先按你这餐的条件挑了 %d 份，我再比一比哪份最合适…", count)
	result.Recommendation.Summary = result.Answer
	state.emitProgress(fmt.Sprintf("挑了 %d 个，正在比…", count), "", "running", count)
	state.Provisional(result)
}
