package service

import (
	"context"
	"testing"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The production screenshot of 2026-10-17: a user at home asks for takeout. The
// catalogue holds ~100 ordinary merchants with a few dishes each, and one placeholder
// "merchant" that is really a community canteen. The conversation was:
//
//  1. 我现在在家里去，不想去学校啊 给我能不能给我推荐一些外卖啊?      -> canteen dishes offered
//  2. AI原点社区食堂不是外卖啊 食堂这个食堂不是外卖 继续推荐其他的     -> the same canteen again
//  3. 我都说了AI原点社区食堂不是外卖，你还在继续推荐这个AI原点社区食堂，你是傻逼吗?  -> ordinary chat
//  4. 我就是需要附近商家的呀，你给我点呗，你给我推荐呗              -> ordinary chat, "no takeout data"
const (
	shotAsk      = "我现在在家里去，不想去学校啊 给我能不能给我推荐一些外卖啊?"
	shotRefuse   = "AI原点社区食堂不是外卖啊 食堂这个食堂不是外卖 继续推荐其他的"
	shotComplain = "我都说了AI原点社区食堂不是外卖，你还在继续推荐这个AI原点社区食堂，你是傻逼吗?"
	shotInsist   = "我就是需要附近商家的呀，你给我点呗，你给我推荐呗"
	shotCanteen  = "AI原点社区食堂（名称待确认）"
)

func shotMerchant(id, merchant, title string, km float64) DietRecommendationCandidate {
	c := campusDietAgentTestCandidate(id, title, 520, 28)
	c.IsCampusFood, c.SchoolID, c.SchoolName, c.CanteenName, c.WindowName, c.Floor = false, "", "", "", "", ""
	c.MerchantName, c.Address = merchant, merchant+"路1号"
	c.Carbs, c.Price, c.PriceUnit = 60, 22, "元/份"
	c.DistanceKM = &km
	return c
}

func shotCatalogue() (canteen []DietRecommendationCandidate, shops []DietRecommendationCandidate) {
	canteen = []DietRecommendationCandidate{
		shotMerchant("c1", shotCanteen, "椒香拌面·西红柿蛋拌面", 0.4),
		shotMerchant("c2", shotCanteen, "凉皮肉夹馍套餐", 0.4),
		shotMerchant("c3", shotCanteen, "香卤鸡腿饭", 0.4),
		shotMerchant("c4", shotCanteen, "招牌卤肉饭", 0.4),
	}
	shops = []DietRecommendationCandidate{
		shotMerchant("s1", "庆丰包子铺（农大南路店）", "猪肉大葱包套餐", 1.8),
		shotMerchant("s2", "米村拌饭（中关村5号店）", "石锅牛肉拌饭", 2.6),
		shotMerchant("s3", "和合谷（学清路店）", "鸡丝饭套餐", 3.1),
	}
	return canteen, shops
}

func shotRecommendationMessages(venue string, titles ...string) []domain.PetChatMessage {
	options := []DietRecommendationOption{}
	for i, title := range titles {
		options = append(options, DietRecommendationOption{Title: title, Source: "public_food_library", SourceID: venue + string(rune('a'+i)), MerchantName: venue})
	}
	result := DietRecommendationResult{HarnessVersion: mealHarnessVersion, SearchScope: "nearby", Recommendations: options}
	return []domain.PetChatMessage{{Role: "assistant", MessageType: "diet_recommendation", Meta: map[string]any{"diet_recommendation": result}}}
}

func TestTakeoutNeverOffersACanteenAsADeliveryMerchant(t *testing.T) {
	state := newCampusDietAgentTestState("initial", nil)
	state.School = domain.DietRecommendationSchool{}
	state.Location = &domain.DietLocation{Latitude: 39.99, Longitude: 116.32, CoordinateType: "gcj02"}
	state.Constraints = resolveCampusDietAgentConstraints(nil, nil, shotAsk)
	require.Equal(t, "takeout", state.Constraints.Scene)

	canteen, shops := shotCatalogue()
	ranked := mealHarnessRank(state, append(append([]DietRecommendationCandidate{}, canteen...), shops...))
	require.NotEmpty(t, ranked)
	for _, c := range ranked {
		assert.NotEqual(t, shotCanteen, c.MerchantName, "a canteen is somewhere to eat, not a takeout merchant: %s", c.Title)
	}
	assert.Len(t, ranked, len(shops))

	// An explicitly named venue is the user's own choice and is never filtered as "not takeout".
	state.Constraints.CanteenName = "AI原点社区食堂"
	state.Constraints.Scene = "any"
	assert.NotEmpty(t, mealHarnessRank(state, canteen))
}

func TestRejectingTheCanteenKeepsTakeoutAndExcludesThatVenue(t *testing.T) {
	asked := resolveCampusDietAgentConstraints(nil, nil, shotAsk)
	first := shotRecommendationMessages(shotCanteen, "椒香拌面·西红柿蛋拌面", "凉皮肉夹馍套餐", "香卤鸡腿饭")
	active, _ := activeCampusDietRecommendation(first)
	require.NotNil(t, active)
	active.AgentConstraints = &asked

	refused := resolveCampusDietAgentConstraints(nil, active, shotRefuse)
	assert.Equal(t, "takeout", refused.Scene, "the user is still after takeout")
	assert.Empty(t, refused.CanteenName, "rejecting a canteen is not choosing it")
	require.NotEmpty(t, refused.ExcludedCanteens)
	assert.True(t, domain.MatchesDiningVenue(refused.ExcludedCanteens[0], DietRecommendationCandidate{MerchantName: shotCanteen}), "the rejected venue is excluded: %v", refused.ExcludedCanteens)

	active.AgentConstraints = &refused
	complained := resolveCampusDietAgentConstraints(nil, active, shotComplain)
	assert.Equal(t, "takeout", complained.Scene)
	assert.Len(t, complained.ExcludedCanteens, 1, "naming it again does not duplicate it")

	// Excluded venues stay excluded when the next request is only a different phrasing.
	active.AgentConstraints = &complained
	insisted := resolveCampusDietAgentConstraints(nil, active, shotInsist)
	assert.Equal(t, "takeout", insisted.Scene)
	assert.Len(t, insisted.ExcludedCanteens, 1)

	canteen, shops := shotCatalogue()
	state := newCampusDietAgentTestState("more", active)
	state.School = domain.DietRecommendationSchool{}
	state.Location = &domain.DietLocation{Latitude: 39.99, Longitude: 116.32, CoordinateType: "gcj02"}
	state.Constraints = insisted
	for _, c := range mealHarnessRank(state, append(append([]DietRecommendationCandidate{}, canteen...), shops...)) {
		assert.NotEqual(t, shotCanteen, c.MerchantName)
	}
}

func TestComplaintsAndShortDemandsAfterARecommendationStayWithTheMealAgent(t *testing.T) {
	repo := &mockStatsRepo{}
	svc := NewStatsService(repo, nil)
	repo.petChatMessages = append(
		[]domain.PetChatMessage{{Role: "user", Content: shotAsk, MessageType: "question"}},
		shotRecommendationMessages(shotCanteen, "椒香拌面·西红柿蛋拌面", "凉皮肉夹馍套餐", "香卤鸡腿饭")...)
	for _, question := range []string{shotRefuse, shotComplain, shotInsist, "不是这个，换商家", "你怎么又推荐食堂", "我要的是外卖不是食堂"} {
		assert.True(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: question, SessionID: "s"}), question)
		repo.petChatMessages = append(repo.petChatMessages,
			domain.PetChatMessage{Role: "user", Content: question, MessageType: "question"})
		repo.petChatMessages = append(repo.petChatMessages, shotRecommendationMessages(shotCanteen, "x")...)
	}
	// What really is another topic still leaves the meal conversation.
	for _, question := range []string{"我想洗澡，热水还是冷水？", "不一定是饮食，其他的通用建议也可以", "你是傻逼吗"} {
		assert.False(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: question, SessionID: "s"}), question)
	}
}

func TestRejectedVenueWordingOnlyRejectsWhatTheUserTurnedDown(t *testing.T) {
	for question, want := range map[string][]string{
		shotRefuse:          {"AI原点社区食堂"},
		shotComplain:        {"AI原点社区食堂"},
		"别再推荐AI原点社区食堂了":     {"AI原点社区食堂"},
		"我不去清华大学桃李食堂":       {"清华大学桃李食堂"},
		"庆丰包子铺不是外卖商家":       nil, // 商家 is a category here, not a venue name; the name is too generic
		"不要只推荐AI原点社区食堂":     nil, // "do not offer ONLY it" is not a rejection
		"不要推荐其他食堂":          nil,
		"不是让你推荐其他食堂":        nil,
		"我不去学校食堂吃饭":         nil, // a category, handled as "no campus"
		"你还在推荐食堂":           nil,
		"今天想吃食堂":            nil,
		"AI原点社区食堂不是外卖，其他都行": {"AI原点社区食堂"},
	} {
		got := mealRejectedVenues(question)
		if len(want) == 0 {
			assert.Empty(t, got, question)
			continue
		}
		assert.Equal(t, want, got, question)
	}
}

func TestOtherMerchantWordingAsksForAnotherVenue(t *testing.T) {
	for _, question := range []string{"不是这个，换商家", "换一家店", "换个商家", "推荐其他商家", "给我别的店", "换个餐馆"} {
		assert.True(t, mealRequestsOtherVenue(question), question)
	}
	for _, question := range []string{"不要换商家", "不用换个商家", "不是让你推荐其他商家"} {
		assert.False(t, mealRequestsOtherVenue(question), question)
	}
}

func shotTakeoutState() *campusDietAgentRunState {
	state := newCampusDietAgentTestState("initial", nil)
	state.School = domain.DietRecommendationSchool{}
	state.Location = &domain.DietLocation{Latitude: 39.99, Longitude: 116.32, CoordinateType: "gcj02"}
	state.MealContextLoaded = true
	state.Constraints = resolveCampusDietAgentConstraints(nil, nil, shotAsk)
	return state
}

func TestTakeoutSearchOffersOnlyRealMerchantsAndCountsWhatItSaw(t *testing.T) {
	canteen, shops := shotCatalogue()
	repo := &mockStatsRepo{candidates: append(append([]DietRecommendationCandidate{}, canteen...), shops...)}
	state := shotTakeoutState()
	out, err := NewStatsService(repo, nil).executeCampusDietSearchTool(context.Background(), state, `{}`, "search_nearby_foods")
	require.NoError(t, err)
	cards, _ := out["candidates"].([]map[string]any)
	require.NotEmpty(t, cards)
	for _, card := range cards {
		assert.NotEqual(t, shotCanteen, card["merchant"], "a canteen is not takeout: %v", card["name"])
	}
	assert.Equal(t, 3, state.TakeoutCoverage.Merchants)
	assert.Equal(t, len(shops), state.TakeoutCoverage.Dishes)
	assert.Equal(t, []string{"AI原点社区食堂"}, state.TakeoutCoverage.Canteens, "what was left out is remembered (by its clean name) so it can be said")
}

func TestTakeoutWithOnlyACanteenNearbySaysSoInsteadOfOfferingIt(t *testing.T) {
	canteen, _ := shotCatalogue()
	far := shotMerchant("far", "庆丰包子铺（农大南路店）", "猪肉大葱包套餐", 9.5) // beyond the 5 km default radius
	repo := &mockStatsRepo{candidates: append(append([]DietRecommendationCandidate{}, canteen...), far)}
	state := shotTakeoutState()
	out, err := NewStatsService(repo, nil).executeCampusDietSearchTool(context.Background(), state, `{}`, "search_nearby_foods")
	require.NoError(t, err)
	assert.EqualValues(t, 0, out["returned"])
	assert.Zero(t, state.TakeoutCoverage.Merchants)

	empty := mealHarnessEmptyResult(state, "needs_clarification")
	assert.Empty(t, empty.Recommendation.Recommendations)
	assert.Contains(t, empty.Answer, "食堂", "it names what it left out")
	assert.Contains(t, empty.Answer, "外卖平台", "it says plainly that no delivery platform is connected")
	assert.Contains(t, empty.Answer, "没有", "and that nothing nearby fits")
	assert.NotContains(t, empty.Answer, "你愿意提供一个具体店名或换个地点吗？", "the generic ask is replaced by the concrete facts")
}

// The model explains an empty takeout result in its own words when they are grounded; a
// false claim about the data, or asking for a location that is known, keeps the fixed text.
func TestModelExplainsAnEmptyTakeoutResultWhenGrounded(t *testing.T) {
	state := shotTakeoutState()
	state.SearchAttempted = true
	state.TakeoutCoverage = mealMeasureTakeoutCoverage(state, nil)
	words := mealModelEmptyAnswer(state, "附近收录的商家都已经推荐过了，AI原点社区食堂是食堂，已按你的要求排除。要不要放宽距离再找找？")
	assert.Contains(t, words, "都已经推荐过了")
	assert.Contains(t, words, "这不代表当地没有商家", "the data disclaimer is always there for takeout")
	for _, bad := range []string{"我这边只能看到校园食堂的数据。", "缺少地点，请问你在哪里？", "好的，已经帮你点了曼玲粥。", "嗯"} {
		assert.Empty(t, mealModelEmptyAnswer(state, bad), bad)
	}
	facts := mealTakeoutCoverageFacts(state)
	require.NotNil(t, facts)
	assert.Contains(t, facts["note"], "不能替用户下单")
}
