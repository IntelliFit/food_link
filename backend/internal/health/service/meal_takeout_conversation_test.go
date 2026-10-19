package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A canned model that behaves like a cooperative one: it reads the context, searches
// nearby once per turn and picks the first options the search returned. Whatever it
// is shown is what it recommends, so the test checks what the harness lets through.
func screenshotModel(t *testing.T) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		messages, _ := body["messages"].([]any)
		var tools []string
		for _, raw := range messages {
			message, _ := raw.(map[string]any)
			switch message["role"] {
			case "user":
				tools = nil
			case "tool":
				content, _ := message["content"].(string)
				tools = append(tools, content)
			}
		}
		switch len(tools) {
		case 0:
			writeCampusDietAgentTestToolCall(t, w, "ctx", "get_meal_context", `{}`)
		case 1:
			writeCampusDietAgentTestToolCall(t, w, "search", "search_nearby_foods", `{}`)
		default:
			var output struct {
				Candidates []struct {
					SourceID string `json:"source_id"`
				} `json:"candidates"`
			}
			_ = json.Unmarshal([]byte(tools[len(tools)-1]), &output)
			selections := []map[string]any{}
			for _, c := range output.Candidates {
				if len(selections) == 3 {
					break
				}
				selections = append(selections, map[string]any{"source_id": c.SourceID, "reason": "离你近，可以直接点"})
			}
			writeCampusDietAgentTestFinal(t, w, map[string]any{"answer": "给你挑了几家附近可以点的。", "selections": selections})
		}
	}))
}

// The catalogue around the user's home, as it really is: the community canteen is
// stored twice (as a canteen with stalls named like shops, and as a placeholder
// "merchant"), and ordinary merchants sit a little further away.
func screenshotCatalogue() []DietRecommendationCandidate {
	near := func(km float64) *float64 { return &km }
	canteenStall := func(id, window, title string) DietRecommendationCandidate {
		c := shotMerchant(id, "AI原点社区食堂", title, 0.4)
		c.IsCampusFood, c.CanteenName, c.WindowName = true, "AI原点社区食堂", window
		return c
	}
	pool := []DietRecommendationCandidate{
		shotMerchant("dup-1", shotCanteen, "椒香拌面·西红柿鸡蛋拌面", 0.4),
		shotMerchant("dup-2", shotCanteen, "凉皮肉夹馍套餐", 0.4),
		shotMerchant("dup-3", shotCanteen, "香卤鸡腿饭", 0.4),
		shotMerchant("dup-4", shotCanteen, "招牌卤肉饭", 0.4),
		canteenStall("stall-1", "笑蜀面店·椒香拌面", "家乡小炒肉拌面"),
		canteenStall("stall-2", "悠悠凉皮", "凉皮牛筋面两掺"),
		canteenStall("stall-3", "太卤力卤肉饭", "招牌卤肉饭"),
	}
	for i, shop := range []struct{ name, dish string }{
		{"曼玲粥（五道口店）", "皮蛋瘦肉粥配鸡蛋饼套餐"}, {"鱼你在一起（财智大厦店）", "酸菜鱼米饭单人餐"}, {"和合谷（学清路店）", "鸡丝饭套餐"},
		{"老弄堂生煎（第3档口店）", "红烧牛肉面"}, {"吉旺角茶餐厅（五道口店）", "牛肉滑蛋饭"}, {"米村拌饭（中关村5号店）", "石锅牛肉拌饭"}, {"金牌淮南牛肉汤（中关村店）", "黄焖鸡米饭"},
	} {
		c := shotMerchant(fmt.Sprintf("shop-%d", i+1), shop.name, shop.dish, 0.9+float64(i)*0.3)
		c.DistanceKM = near(0.9 + float64(i)*0.3)
		pool = append(pool, c)
	}
	return pool
}

func isCanteenOption(option DietRecommendationOption) bool {
	return strings.Contains(option.MerchantName+option.CanteenName, "食堂") || option.IsCampusFood
}

// The whole conversation of the production screenshot, through the real chat entry
// point: every turn is answered by the meal Agent, no canteen is ever offered as
// takeout, and a refused venue never comes back.
func TestScreenshotConversationOffersMerchantsNotTheCanteen(t *testing.T) {
	server := screenshotModel(t)
	defer server.Close()
	repo := &mockStatsRepo{candidates: screenshotCatalogue()}
	svc := newCampusDietAgentTestService(repo, server.URL)
	home := &domain.DietLocation{Latitude: 39.9966, Longitude: 116.3361, AccuracyM: 20, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}
	entry := &PetChatEntryContext{Source: "home_next_meal", Date: time.Now().In(chinaTZ).Format("2006-01-02"), MealType: "lunch", MealLabel: "午餐"}

	sessionID := ""
	shown := map[string]bool{}
	for turn, question := range []string{shotAsk, shotRefuse, shotComplain, shotInsist} {
		input := PetChatInput{Question: question, Range: "week", Location: home, SessionID: sessionID, NewSession: sessionID == "", EntryContext: entry}
		normalized, err := svc.normalizePetChatInput(input)
		require.NoError(t, err)
		require.True(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", normalized), "turn %d stays with the meal Agent: %s", turn+1, question)

		result := runCampusDietAgentStreamTurn(t, svc, input)
		sessionID = defaultIfEmpty(result.Recommendation.SessionID, "session-diet")
		require.NotEmpty(t, result.Recommendation.Recommendations, "turn %d: %s", turn+1, result.Answer)
		for _, option := range result.Recommendation.Recommendations {
			assert.False(t, isCanteenOption(option), "turn %d offered a canteen as takeout: %s @ %s", turn+1, option.Title, option.MerchantName)
			if turn == 1 {
				assert.False(t, shown[option.SourceID], "\"继续推荐其他的\" repeats %s", option.Title)
			}
			shown[option.SourceID] = true
		}
	}
}

// When every merchant in range has been offered or ruled out, the answer says what
// the catalogue holds and what was excluded instead of claiming only campus data exists.
func TestScreenshotConversationExplainsCoverageWhenMerchantsRunOut(t *testing.T) {
	server := screenshotModel(t)
	defer server.Close()
	pool := []DietRecommendationCandidate{}
	for _, c := range screenshotCatalogue() {
		if !strings.HasPrefix(c.SourceID, "shop-") || c.SourceID == "shop-1" {
			pool = append(pool, c)
		}
	}
	repo := &mockStatsRepo{candidates: pool}
	svc := newCampusDietAgentTestService(repo, server.URL)
	home := &domain.DietLocation{Latitude: 39.9966, Longitude: 116.3361, AccuracyM: 20, CoordinateType: "gcj02", CapturedAt: time.Now().UnixMilli()}

	first := runCampusDietAgentStreamTurn(t, svc, PetChatInput{Question: shotAsk, Range: "week", Location: home, NewSession: true})
	require.Len(t, first.Recommendation.Recommendations, 1)
	assert.Equal(t, "shop-1", first.Recommendation.Recommendations[0].SourceID)

	second := runCampusDietAgentStreamTurn(t, svc, PetChatInput{Question: shotRefuse, Range: "week", Location: home, SessionID: "session-diet"})
	assert.Empty(t, second.Recommendation.Recommendations)
	assert.Contains(t, second.Answer, "这不代表当地没有商家")
	assert.Contains(t, second.Answer, "食堂，不算外卖")
	assert.NotContains(t, second.Answer, "只能看到校园")
}

// The screenshot's last reply came from the ordinary chat, which cannot see the meal
// catalogue and claimed it "only sees campus canteens". It is told not to.
func TestOrdinaryChatIsToldNotToDescribeTheMealCatalogue(t *testing.T) {
	prompt := buildPetChatPrompt(&statsComputation{StatsRange: "week"}, shotInsist, nil, 0)
	assert.Contains(t, prompt, "不要声称“只能看到校园食堂的数据”")
	assert.Contains(t, prompt, "推荐附近的外卖")
}
