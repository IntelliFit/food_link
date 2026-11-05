package service

import (
	"testing"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSingleItemRequestsAreRecognised(t *testing.T) {
	cases := map[string]string{
		"来杯奶茶": mealItemDrink, "想喝点什么": mealItemDrink, "来杯喝的": mealItemDrink, "有什么饮料推荐": mealItemDrink,
		"来点零食": mealItemSnack, "加餐吃什么": mealItemSnack, "先垫点什么": mealItemSnack,
		"再加个菜": mealItemSide, "来个小菜": mealItemSide, "推荐个凉菜": mealItemSide,
		"单点一个菜就行": mealItemDish, "炒个菜": mealItemDish,
	}
	for q, want := range cases {
		kind, ok := mealRequestedItemKind(q)
		assert.True(t, ok, q)
		assert.Equal(t, want, kind, q)
	}
	for _, q := range []string{"推荐一份午饭", "晚饭吃什么", "午饭配个饮料"} {
		kind, ok := mealRequestedItemKind(q)
		assert.True(t, ok, q)
		assert.Empty(t, kind, q)
	}
	for _, q := range []string{"睡前喝粥怎么样", "想喝点汤", "不要饮料", "清淡一点", "附近有什么好吃的"} {
		kind, _ := mealRequestedItemKind(q)
		assert.Empty(t, kind, q)
	}
}

func TestSingleItemRequestIsNotAWholeMeal(t *testing.T) {
	c := resolveCampusDietAgentConstraints(nil, nil, "来杯奶茶")
	assert.Equal(t, mealItemDrink, c.ItemKind)
	assert.False(t, c.CompleteMeal)
	history := []domain.PetChatMessage{{Role: "user", Content: "来杯奶茶"}}
	c = resolveCampusDietAgentConstraints(history, nil, "算了，推荐一份午饭")
	assert.Empty(t, c.ItemKind)
	assert.True(t, c.CompleteMeal)

	state := newComboTestState()
	state.Intent = "initial"
	state.Constraints.ItemKind, state.Constraints.CompleteMeal = mealItemDrink, false
	milkTea := campusDietAgentTestCandidate("tea", "原味奶茶", 280, 3)
	rice := campusDietAgentTestCandidate("bowl", "番茄牛腩饭", 620, 30)
	rice.Carbs = 80
	require.Empty(t, groundedMealExclusion(state, milkTea))
	assert.Equal(t, "item_kind_mismatch", groundedMealExclusion(state, rice))
	state.Constraints.ItemKind = mealItemSide
	greens := campusDietAgentTestCandidate("greens", "清炒时蔬", 120, 3)
	assert.Empty(t, groundedMealExclusion(state, greens))
	assert.Equal(t, "item_kind_mismatch", groundedMealExclusion(state, rice))

	// One item is sized as a small share of the day, not as lunch.
	ctx := dietDecisionContextFromCampusState(state)
	assert.Less(t, dietDecisionPortionRatio(ctx), dietDecisionMealRatio("lunch"))
}
