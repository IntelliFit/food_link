package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A model that only answers the router: {"route": route}, after an optional delay.
func routerTestService(t *testing.T, repo *mockStatsRepo, route string, delay time.Duration) (*StatsService, *int32) {
	t.Helper()
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(delay)
		writeCampusDietAgentTestResponse(t, w, map[string]any{"choices": []map[string]any{{"message": map[string]any{"role": "assistant", "content": `{"route":"` + route + `"}`}}}})
	}))
	t.Cleanup(server.Close)
	cfg := &config.Config{}
	cfg.External.DashScopeAPIKey, cfg.External.DashScopeBaseURL = "test-key", server.URL
	svc := NewStatsService(repo, nil, cfg)
	svc.client = &http.Client{}
	return svc, &calls
}

func withCardOnScreen() *mockStatsRepo {
	return &mockStatsRepo{petChatMessages: append([]domain.PetChatMessage{{Role: "user", Content: "我在清华，中午吃什么", MessageType: "question", Meta: map[string]any{"intent": "campus_diet_agent"}}},
		shotRecommendationMessages("清华大学桃李园", "番茄牛腩饭", "香辣爆肚面", "牛肉饼饭")...)}
}

func TestModelRoutesWordingTheRulesDoNotKnow(t *testing.T) {
	ask := func(svc *StatsService, q string) bool {
		return svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: q, SessionID: "s"})
	}
	svc, calls := routerTestService(t, withCardOnScreen(), "meal", 0)
	assert.True(t, ask(svc, "这几个都太油了"), "the model reads it as feedback on the dishes")
	assert.EqualValues(t, 1, *calls)

	assert.True(t, ask(svc, "换一批"), "the rules already know this one")
	assert.True(t, ask(svc, "我想洗澡，热水还是冷水？") == false, "an explicit other topic never reaches the model")
	assert.EqualValues(t, 1, *calls, "no model call for either")

	chat, chatCalls := routerTestService(t, withCardOnScreen(), "chat", 0)
	assert.False(t, ask(chat, "这几个都太油了"))
	assert.EqualValues(t, 1, *chatCalls)
}

func TestModelRouterIsOnlyAskedWhenFoodCouldBeMeant(t *testing.T) {
	svc, calls := routerTestService(t, &mockStatsRepo{}, "meal", 0)
	assert.False(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: "今天天气不错", NewSession: true}))
	assert.EqualValues(t, 0, *calls, "no meal context and nothing about food: no model call")
	assert.True(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: "饿了，整点啥好", NewSession: true}))
	assert.EqualValues(t, 1, *calls)
}

func TestModelRouterFailureKeepsTheRules(t *testing.T) {
	slow, _ := routerTestService(t, withCardOnScreen(), "meal", mealRouterTimeout+time.Second)
	started := time.Now()
	assert.False(t, slow.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: "这几个都太油了", SessionID: "s"}))
	assert.Less(t, time.Since(started), mealRouterTimeout+800*time.Millisecond, "the router never holds a turn longer than its budget")

	garbled, _ := routerTestService(t, withCardOnScreen(), "maybe", 0)
	assert.False(t, garbled.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: "这几个都太油了", SessionID: "s"}))
}

// A turn the model routed to the meal Agent keeps the card active afterwards, whatever its wording.
func TestModelRoutedTurnKeepsTheMealConversation(t *testing.T) {
	history := append(withCardOnScreen().petChatMessages,
		domain.PetChatMessage{Role: "user", Content: "这几个都太油了", MessageType: "question", Meta: map[string]any{"intent": "campus_diet_agent"}})
	history = append(history, shotRecommendationMessages("清华大学清芬园", "清汤牛肉面")...)
	active, _ := activeCampusDietRecommendation(history)
	require.NotNil(t, active)
	assert.Equal(t, "清汤牛肉面", active.Recommendations[0].Title)
	assert.True(t, mealConversationContinues(history))
}

// A model that answers every request with the same text.
func wordingTestService(t *testing.T, repo *mockStatsRepo, text string) (*StatsService, *int32) {
	t.Helper()
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		writeCampusDietAgentTestResponse(t, w, map[string]any{"choices": []map[string]any{{"message": map[string]any{"role": "assistant", "content": text}}}})
	}))
	t.Cleanup(server.Close)
	cfg := &config.Config{}
	cfg.External.DashScopeAPIKey, cfg.External.DashScopeBaseURL = "test-key", server.URL
	svc := NewStatsService(repo, nil, cfg)
	svc.client = &http.Client{}
	return svc, &calls
}

func acknowledgementReply(t *testing.T, svc *StatsService, question string) (string, *PetChatStreamMeta) {
	t.Helper()
	chunks, err := svc.GeneratePetChatStream(context.Background(), "user-1", PetChatInput{Question: question, Range: "week", SessionID: "session-1"})
	require.NoError(t, err)
	text, meta := "", (*PetChatStreamMeta)(nil)
	for chunk := range chunks {
		text += chunk.Text
		if chunk.Meta != nil {
			meta = chunk.Meta
		}
	}
	return text, meta
}

// "就这个吧" is answered in context by the model, still free of charge.
func TestAcknowledgementIsWordedByTheModelInContext(t *testing.T) {
	repo := withCardOnScreen()
	svc, calls := wordingTestService(t, repo, "好嘞，那就番茄牛腩饭，去桃李园买就行～")
	guard := &mockStatsCreditGuard{}
	svc.ConfigureCreditGuard(guard)
	text, meta := acknowledgementReply(t, svc, "就这个吧")
	assert.Equal(t, "好嘞，那就番茄牛腩饭，去桃李园买就行～", text)
	require.NotNil(t, meta)
	assert.Equal(t, petChatFreeAcknowledgement, meta.BillingStatus)
	assert.Zero(t, meta.CreditsCharged)
	assert.Zero(t, guard.validateCalls)
	assert.EqualValues(t, 1, *calls)
}

// Numbers, prices or a long text are not trusted in a free reply: the fixed reply is used.
func TestAcknowledgementFallsBackToTheFixedReply(t *testing.T) {
	for _, words := range []string{"好的，番茄牛腩饭只要15元，热量520千卡", "", strings.Repeat("好的", 40)} {
		svc, _ := wordingTestService(t, withCardOnScreen(), words)
		text, _ := acknowledgementReply(t, svc, "就这个吧")
		assert.Equal(t, mealAcknowledgementReplies["decision"], text, words)
	}
}

func TestModelReplyTextReadsTheUsualWrappers(t *testing.T) {
	for raw, want := range map[string]string{
		`{"reply":"好嘞，就选鸡汤豌杂面～"}`:                                   "好嘞，就选鸡汤豌杂面～",
		`[{"content": "不客气呀～", "role": "assistant"}]`:               "不客气呀～",
		`[{"content": "{\"reply\":\"好的～\"}", "role": "assistant"}]`: "好的～",
		"```json\n{\"reply\":\"行～\"}\n```":                          "行～",
		"好的，吃得开心～":                                                  "好的，吃得开心～",
	} {
		assert.Equal(t, want, mealModelReplyText(raw), raw)
	}
}
