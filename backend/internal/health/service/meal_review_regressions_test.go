package service

import (
	"context"
	"testing"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Cases found in review (2026-10-18). Each sentence is one a real user may type.

func TestAskingToKeepAVenueIsNotRejectingIt(t *testing.T) {
	for _, question := range []string{"还是推荐桃李园吧", "一直推荐桃李园就行", "不用推荐桃李园以外的", "别推荐桃李园之外的食堂", "麦当劳餐厅不是外卖吗？我想点它"} {
		assert.Empty(t, mealRejectedVenues(question), question)
	}
	locked := CampusDietRecommendationConstraints{CanteenName: "桃李园"}
	applyMealVenueConstraints(&locked, "还是推荐桃李园吧")
	assert.Equal(t, "桃李园", locked.CanteenName)
	assert.Empty(t, locked.ExcludedCanteens)
}

func TestRejectedVenueNameIsTheVenueNotTheWholeClause(t *testing.T) {
	for question, want := range map[string]string{
		"我说过AI原点社区食堂不是外卖":   "AI原点社区食堂",
		"你推荐的AI原点社区食堂不是外卖":  "AI原点社区食堂",
		"我都说了AI原点社区食堂不是外卖":  "AI原点社区食堂",
		"你怎么又推荐AI原点社区食堂":    "AI原点社区食堂",
		"你还在推荐AI原点社区食堂，换一家": "AI原点社区食堂",
	} {
		got := mealRejectedVenues(question)
		require.Len(t, got, 1, question)
		assert.Equal(t, want, got[0], question)
	}
}

func TestOrdinaryQuestionsAfterARecommendationAreNotFeedback(t *testing.T) {
	for _, question := range []string{
		"我一直吃不胖怎么办", "我需要多吃蛋白质吗", "我总是晚上饿，吃夜宵会胖吗", "我最近一直在吃外卖，会不会长胖",
		"还是那个问题，最近总是胃胀", "你别管吃的了，帮我看看体重", "我不是很饿", "这个菜好吃吗",
	} {
		assert.False(t, mealFeedbackOnRecommendation(question), question)
	}
	for _, question := range []string{shotRefuse, shotComplain, shotInsist, "不是这个，换商家", "你怎么又推荐食堂", "我要的是外卖不是食堂", "别再推荐食堂了", "给我推荐点别的店"} {
		assert.True(t, mealFeedbackOnRecommendation(question), question)
	}
}

func TestAQuestionIsNeverAFreeAcknowledgement(t *testing.T) {
	for _, question := range []string{"就这个？", "吃这个？", "我吃这个?", "要这个？", "选第一个？", "嗯？", "哦?", "好吗", "好麻烦了", "就这个吗"} {
		assert.Empty(t, mealChatAcknowledgementKind(question), question)
	}
	assert.Equal(t, "greeting", mealChatAcknowledgementKind("在吗"))
	assert.Equal(t, "greeting", mealChatAcknowledgementKind("你好，在吗？"))
	assert.Equal(t, "thanks", mealChatAcknowledgementKind("谢谢😊"))
	assert.Equal(t, "thanks", mealChatAcknowledgementKind("好的　谢谢"))
	assert.Equal(t, "thanks", mealChatAcknowledgementKind("好的 谢谢"))
}

func TestTakeoutRequestFromACommunityIsNotLockedToItsCanteen(t *testing.T) {
	for _, question := range []string{"我在AI原点社区，想点外卖", "我现在在AI原点社区，推荐点外卖", "我在AI原点社区食堂，给我推荐外卖"} {
		c := resolveCampusDietAgentConstraints(nil, nil, question)
		assert.Equal(t, "takeout", c.Scene, question)
		assert.Empty(t, c.CanteenName, question)
	}
	// Saying where one is without asking for takeout still names the canteen to eat in.
	c := resolveCampusDietAgentConstraints(nil, nil, "我在AI原点社区食堂，中午吃什么")
	assert.Equal(t, "AI原点社区食堂", c.CanteenName)
}

func TestNotWantingTheCanteenIsNotACampusRequest(t *testing.T) {
	for _, question := range []string{"我不想去食堂，推荐附近的店", "我现在在家里去，不想去学校啊 给我推荐吃的"} {
		assert.Equal(t, "takeout", mealExplicitScene(question), question)
	}
}

func TestCanteenVenueRecognisesOtherCanteenWords(t *testing.T) {
	for _, name := range []string{"某某饭堂", "XX职工餐厅", "员工餐厅（二楼）", "学生餐厅", "教工餐厅", "AI原点社区餐厅", "AI原点社区（名称待确认）"} {
		assert.True(t, domain.IsCanteenVenue(DietRecommendationCandidate{MerchantName: name}), name)
	}
	for _, name := range []string{"一家被炒面耽误的炒饭店！(第8档口京食美食城店)", "和合谷（学清路店）", "餐厅"} {
		assert.False(t, domain.IsCanteenVenue(DietRecommendationCandidate{MerchantName: name}), name)
	}
}

func TestTrainingTimingIgnoresEverydayCompletedThings(t *testing.T) {
	for _, question := range []string{"我刚打完饭", "刚打完电话", "已经打完卡了", "刚打完游戏", "我才打完针", "刚旅游完回来", "等一下我要去练车", "我想去练习口语", "马上要考试了没时间运动", "下午要练字"} {
		timing, _ := mealTrainingTiming(question)
		assert.Empty(t, timing, question)
	}
	for question, want := range map[string]string{"刚打完球": "post", "游完泳了": "post", "跑完步了": "post", "我刚练完": "post", "练完腿了": "post", "等下去打球": "pre"} {
		timing, _ := mealTrainingTiming(question)
		assert.Equal(t, want, timing, question)
	}
}

func TestWorkoutTimingDoesNotCarryIntoAnotherMeal(t *testing.T) {
	active := &DietRecommendationResult{AgentConstraints: &CampusDietRecommendationConstraints{Version: mealRequirementVersion, Training: "pre", MealType: "lunch"}}
	assert.Equal(t, "pre", resolveCampusDietAgentConstraints(nil, active, "再便宜一点").Training)
	assert.Empty(t, resolveCampusDietAgentConstraints(nil, active, "晚饭吃什么").Training, "a plan to train before lunch says nothing about dinner")
	assert.Equal(t, "post", resolveCampusDietAgentConstraints(nil, active, "晚饭吃什么，我刚练完").Training)
}

func TestComboRolesOfRealDishNames(t *testing.T) {
	for _, title := range []string{"可乐鸡翅", "可乐排骨", "咖啡排骨"} {
		assert.Equal(t, mealRoleProtein, mealComboRoleOf(DietRecommendationCandidate{Title: title, Protein: 18, Calories: 300}), title)
	}
	for _, title := range []string{"鱼香茄子", "鸡毛菜", "清炒鸡毛菜", "蒸贝贝南瓜", "牛油果沙拉"} {
		assert.NotEqual(t, mealRoleProtein, mealComboRoleOf(DietRecommendationCandidate{Title: title, Protein: 3, Calories: 120}), title)
	}
	assert.Equal(t, mealRoleProtein, mealComboRoleOf(DietRecommendationCandidate{Title: "鱼香肉丝", Protein: 15, Calories: 260}))
}

func TestAssembledMealDoesNotClaimSupplyPeriodsAPartLacks(t *testing.T) {
	known := DietRecommendationCandidate{MealPeriods: []string{"lunch", "dinner"}}
	unknown := DietRecommendationCandidate{}
	assert.Empty(t, mealCommonPeriods([]DietRecommendationCandidate{known, unknown}))
	assert.Equal(t, []string{"lunch", "dinner"}, mealCommonPeriods([]DietRecommendationCandidate{known, known}))
}

// Coverage must describe what was really found: a merchant already offered in this
// conversation is not "no merchant in range", and nothing measured means no claim.
func TestCoverageAnswerDoesNotDenyMerchantsAlreadyOffered(t *testing.T) {
	state := newCampusDietAgentTestState("more", &DietRecommendationResult{Recommendations: []DietRecommendationOption{{SourceID: "shop-1", Title: "皮蛋瘦肉粥", MerchantName: "曼玲粥（五道口店）"}}})
	state.Location = &domain.DietLocation{Latitude: 39.99, Longitude: 116.33, CoordinateType: "gcj02"}
	state.Constraints.Scene = "takeout"
	state.SearchAttempted = true
	answer := mealHarnessEmptyResult(state, "needs_clarification").Answer
	assert.NotContains(t, answer, "没有收录", "nothing was measured, so nothing is claimed about the catalogue")

	canteen := shotMerchant("dup-1", shotCanteen, "香卤鸡腿饭", 0.4)
	stall := shotMerchant("stall-1", "AI原点社区食堂", "招牌卤肉饭", 0.4)
	stall.IsCampusFood, stall.CanteenName = true, "AI原点社区食堂"
	state.TakeoutCoverage = mealMeasureTakeoutCoverage(state, []DietRecommendationCandidate{canteen, stall})
	answer = mealHarnessEmptyResult(state, "needs_clarification").Answer
	assert.NotContains(t, answer, "没有收录可点单的校外商家")
	assert.Contains(t, answer, "曼玲粥（五道口店）", "the merchant already offered is named")
	assert.Equal(t, 1, countSubstring(answer, "AI原点社区食堂"), "one canteen is named once: %s", answer)
}

func countSubstring(s, sub string) int {
	n := 0
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			n++
		}
	}
	return n
}

func TestChatExposureDoesNotRecordStaples(t *testing.T) {
	repo := &memoryTestRepo{mockStatsRepo: &mockStatsRepo{candidates: comboRotationPool()}}
	state, result, svc := runWholeMealChatTurn(t, repo, comboRotationPool())
	svc.recordChatMealExposure(context.Background(), state, result)
	require.NotEmpty(t, repo.saved)
	staples := map[string]bool{}
	for _, option := range result.Recommendation.Recommendations {
		for _, c := range option.MealComponents {
			if mealComboRoleOf(c) == mealRoleStaple {
				staples[c.SourceID] = true
			}
		}
	}
	require.NotEmpty(t, staples, "the canned meals include rice")
	for _, row := range repo.saved {
		assert.False(t, staples[row.SourceID], "staples never rotate, so they are not written to the memory")
	}
}

// A chat opened from the home card must not mark the card's own dish as shown elsewhere,
// or the card would rotate away from what the user just picked.
func TestChatExposureDoesNotRecordTheHomeCardsOwnDish(t *testing.T) {
	repo := &memoryTestRepo{mockStatsRepo: &mockStatsRepo{candidates: comboRotationPool()}}
	state, result, svc := runWholeMealChatTurn(t, repo, comboRotationPool())
	var shown string
	for _, option := range result.Recommendation.Recommendations {
		for _, c := range option.MealComponents {
			if mealComboRoleOf(c) != mealRoleStaple {
				shown = c.SourceID
			}
		}
	}
	require.NotEmpty(t, shown)
	state.EntryContext = &PetChatEntryContext{Source: "home_next_meal", SelectedSourceID: "00000000-0000-0000-0000-000000000001"}
	result.Recommendation.Recommendations = append(result.Recommendation.Recommendations, DietRecommendationOption{Source: "public_food_library", SourceID: state.EntryContext.SelectedSourceID, Title: "铁板滑蛋牛肉饭"})
	svc.recordChatMealExposure(context.Background(), state, result)
	require.NotEmpty(t, repo.saved)
	for _, row := range repo.saved {
		assert.NotEqual(t, state.EntryContext.SelectedSourceID, row.SourceID)
	}
}

// Live run 2026-10-18: follow-ups that combine two requests, mention a workout, or ask a
// short question about the dishes fell out of the meal conversation.
func TestCompoundAndShortFollowUpsStayInTheMealConversation(t *testing.T) {
	repo := &mockStatsRepo{}
	svc := NewStatsService(repo, nil)
	repo.petChatMessages = append([]domain.PetChatMessage{{Role: "user", Content: "我在清华，中午吃什么", MessageType: "question"}},
		shotRecommendationMessages("清华大学桃李园", "番茄牛腩饭", "香辣爆肚面", "牛肉饼饭")...)
	for _, question := range []string{"便宜一点，20元以内", "我一会要去健身，再推荐一下", "有汤吗", "能打包吗", "这个菜辣吗", "有素的吗", "再推荐一下", "清淡一点，不要辣"} {
		assert.True(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: question, SessionID: "s"}), question)
	}
	for _, question := range []string{"我需要多吃蛋白质吗", "我吃肉会胖吗", "我想洗澡，热水还是冷水？", "最近睡得不好怎么办"} {
		assert.False(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: question, SessionID: "s"}), question)
	}
}

// Live run 2026-10-18: the model named dishes in its own words ("吉旺角茶餐厅的牛肉滑蛋饭套餐")
// that were not on the cards. A venue that is not among the selected options is "another choice".
func TestAnswerNamingAnotherVenueIsCaught(t *testing.T) {
	state := newCampusDietAgentTestState("more", nil)
	shown := shotMerchant("s1", "曼玲粥(五道口店·包子·馅饼·油条)", "肉粥超值套餐（自选4样）", 0.9)
	other := shotMerchant("s2", "吉旺角茶餐厅（五道口店）", "牛肉滑蛋饭+冻柠", 2.4)
	state.Candidates[shown.SourceID], state.Candidates[other.SourceID] = shown, other
	state.Constraints.ExcludedCanteens = []string{"AI原点社区食堂"}
	selected := []DietRecommendationCandidate{shown}
	assert.True(t, mealAnswerMentionsOtherChoice(state, "推荐吉旺角茶餐厅的牛肉滑蛋饭套餐", selected))
	assert.False(t, mealAnswerMentionsOtherChoice(state, "已为你排除AI原点社区食堂，推荐曼玲粥的肉粥套餐", selected))
}

// When the engine replaces the model's picks, the reply describes the engine's picks and
// never shows internal ranking wording.
func TestEngineChoiceAnswerDescribesTheCardsInPlainWords(t *testing.T) {
	a := shotMerchant("s1", "曼玲粥(五道口店)", "肉粥超值套餐", 0.9)
	b := comboDish("b", "香辣爆肚面", 560, 30, 70, 15, 16, "肉酱拌面")
	b.SchoolName, b.CanteenName = "清华大学", "桃李园"
	answer := mealEngineChoiceAnswer([]DietRecommendationCandidate{a, b})
	assert.Contains(t, answer, "肉粥超值套餐")
	assert.Contains(t, answer, "曼玲粥")
	assert.Contains(t, answer, "香辣爆肚面")
	assert.Contains(t, answer, "桃李园")
	assert.NotContains(t, answer, "先核对本餐条件")
	assert.NotContains(t, answer, "未知营养不按零计算")
}

// Live run 2026-10-18: "我就是需要附近商家的呀" turned a takeout conversation into "any" and a
// canteen dish came back. Asking for merchants is asking for takeout.
func TestAskingForNearbyMerchantsKeepsTakeout(t *testing.T) {
	for _, question := range []string{shotInsist, "我需要附近商家", "推荐附近的商家", "给我找几家附近的店"} {
		assert.Equal(t, "takeout", mealExplicitScene(question), question)
	}
	asked := resolveCampusDietAgentConstraints(nil, nil, shotAsk)
	active := &DietRecommendationResult{AgentConstraints: &asked}
	assert.Equal(t, "takeout", resolveCampusDietAgentConstraints(nil, active, shotInsist).Scene)
	assert.NotEqual(t, "takeout", mealExplicitScene("附近有什么吃的"), "nearby alone is still mixed")
	assert.NotEqual(t, "takeout", mealExplicitScene("商家和食堂都看看"), "both kinds asked for")
}

// The engine's reply acknowledges what the user just asked for.
func TestEngineChoiceAnswerAcknowledgesTheRequest(t *testing.T) {
	limit := 20.0
	state := newCampusDietAgentTestState("refine", nil)
	state.Constraints.Training, state.Constraints.MaxPrice = "pre", &limit
	state.Constraints.ExcludedCanteens = []string{"AI原点社区食堂"}
	a := comboDish("a", "鸡汤抄手面", 520, 26, 70, 12, 9, "川渝小吃")
	answer := mealEngineChoiceAnswerFor(state, []DietRecommendationCandidate{a})
	assert.Contains(t, answer, "一会要训练")
	assert.Contains(t, answer, "20元以内")
	assert.Contains(t, answer, "AI原点社区食堂")
	assert.Contains(t, answer, "鸡汤抄手面")
}
