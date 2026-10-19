package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A conversation whose last message is a recommendation; no options means the
// Agent asked a question instead.
func historyEndingInRecommendation(answer string, options ...DietRecommendationOption) []domain.PetChatMessage {
	result := DietRecommendationResult{HarnessVersion: mealHarnessVersion, SearchScope: "school", Recommendations: options}
	return []domain.PetChatMessage{
		{Role: "user", Content: "推荐点吃的", MessageType: "question"},
		{Role: "assistant", Content: answer, MessageType: "diet_recommendation", Meta: map[string]any{"diet_recommendation": result}},
	}
}

func freeAcknowledgementExchange(question, reply string) []domain.PetChatMessage {
	meta := map[string]any{"billing_status": petChatFreeAcknowledgement}
	return []domain.PetChatMessage{
		{Role: "user", Content: question, MessageType: "question", Meta: meta},
		{Role: "assistant", Content: reply, MessageType: "analysis", Meta: meta},
	}
}

func sendAcknowledgement(t *testing.T, svc *StatsService, question string) (types []string, text string, meta *PetChatStreamMeta, err error) {
	t.Helper()
	chunks, err := svc.GeneratePetChatStream(context.Background(), "user-1", PetChatInput{Question: question, Range: "week", SessionID: "session-1"})
	if err != nil {
		return nil, "", nil, err
	}
	var out strings.Builder
	for chunk := range chunks {
		types = append(types, chunk.Type)
		out.WriteString(chunk.Text)
		if chunk.Meta != nil {
			meta = chunk.Meta
		}
	}
	return types, out.String(), meta, nil
}

func TestMealChatAcknowledgementKind(t *testing.T) {
	kinds := map[string]string{
		"谢谢，我知道了": "thanks", "谢谢你": "thanks", "多谢": "thanks",
		"你好呀": "greeting", "在吗": "greeting",
		"再见": "farewell", "晚安": "farewell",
		"你真棒": "praise", "不错": "praise",
		"就这个吧": "decision", "那我就选第二个": "decision", "好的，就这个吧": "decision",
		"我去吃饭了": "going", "那我先去吃了": "going", "好的，我去吃饭了": "going",
		"好的": "ack", "嗯嗯": "ack", "收到": "ack",
		// anything with content is not an acknowledgement
		"好的，预算再低一点": "", "谢谢，那换一批吧": "", "我最近蛋白质摄入够吗": "", "你是谁": "", "有汤吗": "",
		"我就是需要附近商家的呀": "", "你给我点呗": "", "换一批": "", "第二个在几楼": "",
	}
	for question, want := range kinds {
		assert.Equal(t, want, mealChatAcknowledgementKind(question), question)
	}
}

// Sending a thank-you to the metered pet chat would charge a credit for it, or
// refuse it for a user without diet records. Right after a recommendation it is
// answered at once, for free, without a model.
func TestAcknowledgementAfterRecommendationIsFreeAndNeedsNoModel(t *testing.T) {
	repo := &mockStatsRepo{} // no diet records: the ordinary chat would refuse
	repo.petChatMessages = historyEndingInRecommendation("搭配好了", DietRecommendationOption{SourceID: "food-a", Title: "牛肉饭"})
	var modelCalls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { atomic.AddInt32(&modelCalls, 1) }))
	defer server.Close()
	svc := newCampusDietAgentTestService(repo, server.URL)
	guard := &mockStatsCreditGuard{}
	svc.ConfigureCreditGuard(guard)
	before := len(repo.petChatMessages)

	types, text, meta, err := sendAcknowledgement(t, svc, "谢谢，我知道了")

	require.NoError(t, err)
	assert.Equal(t, []string{"start", "chunk", "done"}, types)
	assert.NotEmpty(t, strings.TrimSpace(text))
	require.NotNil(t, meta)
	assert.Zero(t, meta.CreditsCharged)
	assert.Equal(t, petChatFreeAcknowledgement, meta.BillingStatus)
	assert.Equal(t, "session-1", meta.SessionID)
	assert.Zero(t, atomic.LoadInt32(&modelCalls), "no model call")
	assert.Zero(t, guard.validateCalls, "no credit check")
	assert.Empty(t, guard.sourceKeys, "no charge")
	require.Len(t, repo.petChatMessages, before+2, "the exchange is kept in the conversation")
	assert.Equal(t, "谢谢，我知道了", repo.petChatMessages[before].Content)
	assert.Equal(t, strings.TrimSpace(text), repo.petChatMessages[before+1].Content)
	assert.True(t, petChatFreeAcknowledgementMessage(repo.petChatMessages[before]), "both messages carry the marker the meal context looks through")
	assert.True(t, petChatFreeAcknowledgementMessage(repo.petChatMessages[before+1]))
}

// A thank-you is not a change of topic: the recommendation is still the card the
// conversation is about, so a second thank-you stays free and "换一批" still goes
// to the meal Agent instead of the ordinary chat.
func TestAcknowledgementDoesNotEndTheMealConversation(t *testing.T) {
	repo := &mockStatsRepo{}
	repo.petChatMessages = append(historyEndingInRecommendation("搭配好了", DietRecommendationOption{SourceID: "food-a", Title: "牛肉饭"}),
		freeAcknowledgementExchange("谢谢", "不客气～")...)
	svc := NewStatsService(repo, nil)

	active, _ := activeCampusDietRecommendation(repo.petChatMessages)
	require.NotNil(t, active, "the recommendation is still the active one")
	assert.True(t, mealConversationContinues(repo.petChatMessages), "the conversation about the meal goes on past the thank-you")
	assert.True(t, svc.shouldUseCampusDietAgent(context.Background(), "user-1", PetChatInput{Question: "换一批", SessionID: "session-1"}),
		"the follow-up after a thank-you still belongs to the meal Agent")

	_, _, meta, err := sendAcknowledgement(t, svc, "好的，就这个吧")
	require.NoError(t, err)
	require.NotNil(t, meta)
	assert.Equal(t, petChatFreeAcknowledgement, meta.BillingStatus, "back-to-back acknowledgements stay free")
}

// Other chat between the recommendation and the message ends the meal
// conversation: a "好的" there answers the ordinary chat, not the card. The
// ordinary chat refuses a user without records, which shows nothing was answered
// for free.
func TestAcknowledgementAfterOtherChatStaysInTheOrdinaryChat(t *testing.T) {
	for _, question := range []string{"好的", "谢谢", "好的，就这个吧"} {
		repo := &mockStatsRepo{}
		repo.petChatMessages = append(historyEndingInRecommendation("搭配好了", DietRecommendationOption{SourceID: "food-a"}),
			domain.PetChatMessage{Role: "user", Content: "我最近睡得不好", MessageType: "question"},
			domain.PetChatMessage{Role: "assistant", MessageType: "analysis", Content: "睡前少吃重口味。需要我帮你安排一份睡前加餐清单吗？"})
		_, _, _, err := sendAcknowledgement(t, NewStatsService(repo, nil), question)
		require.Error(t, err, question)
		assert.Contains(t, err.Error(), "先记录一餐", question)
	}
}

func TestAcknowledgementWithoutAnOfferedMealStaysInTheOrdinaryChat(t *testing.T) {
	cases := map[string][]domain.PetChatMessage{
		"recommendation was a question": historyEndingInRecommendation("你想吃辣的吗"),
		"no recommendation at all":      {{Role: "user", Content: "你好", MessageType: "question"}, {Role: "assistant", Content: "你好呀", MessageType: "analysis"}},
	}
	for name, history := range cases {
		repo := &mockStatsRepo{petChatMessages: history}
		_, _, _, err := sendAcknowledgement(t, NewStatsService(repo, nil), "谢谢")
		require.Error(t, err, name)
		assert.Contains(t, err.Error(), "先记录一餐", name)
	}

	// The first message of a conversation, or one with a picture, is never free.
	repo := &mockStatsRepo{}
	repo.petChatMessages = historyEndingInRecommendation("搭配好了", DietRecommendationOption{SourceID: "food-a"})
	svc := NewStatsService(repo, nil)
	for _, input := range []PetChatInput{
		{Question: "谢谢", Range: "week", NewSession: true},
		{Question: "谢谢", Range: "week"},
		{Question: "谢谢", Range: "week", SessionID: "session-1", ImageURLs: []string{"https://example.com/a.jpg"}},
	} {
		_, ok := svc.petChatAcknowledgementReply(context.Background(), "user-1", input)
		assert.False(t, ok, "%+v", input)
	}
}

// "好的" right after the Agent asked something most likely answers it, so it is
// not swallowed by the canned reply. A thank-you or a decision never is a reply to
// a question, so they stay free.
func TestBareAgreementAfterAQuestionIsNotSwallowed(t *testing.T) {
	repo := &mockStatsRepo{}
	repo.petChatMessages = historyEndingInRecommendation("搭配好了，需要换成清淡一点的吗？", DietRecommendationOption{SourceID: "food-a"})
	svc := NewStatsService(repo, nil)

	_, ok := svc.petChatAcknowledgementReply(context.Background(), "user-1", PetChatInput{Question: "好的", Range: "week", SessionID: "session-1"})
	assert.False(t, ok)
	reply, ok := svc.petChatAcknowledgementReply(context.Background(), "user-1", PetChatInput{Question: "谢谢", Range: "week", SessionID: "session-1"})
	assert.True(t, ok)
	assert.NotEmpty(t, reply)
	_, ok = svc.petChatAcknowledgementReply(context.Background(), "user-1", PetChatInput{Question: "就这个吧", Range: "week", SessionID: "session-1"})
	assert.True(t, ok)

	repo.petChatMessages = historyEndingInRecommendation("搭配好了", DietRecommendationOption{SourceID: "food-a"})
	_, ok = svc.petChatAcknowledgementReply(context.Background(), "user-1", PetChatInput{Question: "好的", Range: "week", SessionID: "session-1"})
	assert.True(t, ok, "without a question to answer it is a plain acknowledgement")
}

// A message that carries content is never an acknowledgement, whatever it starts with.
func TestMessagesWithContentAreNotAcknowledged(t *testing.T) {
	repo := &mockStatsRepo{}
	repo.petChatMessages = historyEndingInRecommendation("搭配好了", DietRecommendationOption{SourceID: "food-a"})
	svc := NewStatsService(repo, nil)
	for _, question := range []string{"好的，预算再低一点", "谢谢，那换一批吧", "嗯，第二个在几楼", "我就是需要附近商家的呀，你给我点呗", "不对，我要外卖"} {
		_, ok := svc.petChatAcknowledgementReply(context.Background(), "user-1", PetChatInput{Question: question, Range: "week", SessionID: "session-1"})
		assert.False(t, ok, question)
	}
}
