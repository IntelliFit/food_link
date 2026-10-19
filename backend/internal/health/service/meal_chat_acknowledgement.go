package service

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"food_link/backend/internal/billing"
	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/logger"
)

// A pure acknowledgement right after a recommendation ("谢谢", "就这个吧", "我去吃了")
// needs no model. The metered pet chat would charge a credit for a thank-you, or
// refuse it for a user without diet records, and a model without the card at hand
// tends to make something up. Right after a recommendation these turns are answered
// at once from a fixed reply and cost nothing.

const petChatFreeAcknowledgement = "free_acknowledgement"

var (
	// Before matching, keep only Chinese characters, ASCII letters and digits, so emoji,
	// full-width spaces and any punctuation are ignored; the mini program strips exactly
	// the same characters (pet-chat/meal-routing.ts).
	mealChatNotKept = regexp.MustCompile(`[^\x{3400}-\x{9fff}A-Za-z0-9]+`)
	// A whole message made of acknowledgements and greetings only.
	mealSmallTalkPattern = regexp.MustCompile(`^你?(?:谢谢|多谢|感谢|好的|好吧|好哒|好嘞|好|嗯|哦|行|收到|明白|懂了|我知道了|知道了|了解|你好|您好|嗨|哈喽|在吗|早安|晚安|再见|拜拜|哈哈|嘿嘿|厉害|不错|真棒|太棒了|赞|辛苦了|辛苦啦)+(?:呀|啊|啦|哈|吧|哦|呢|哒|你)*$`)
	// "就这个吧" / "那我就选第二个": a choice was made, nothing new is asked.
	mealDecisionPattern = regexp.MustCompile(`^(?:好的|好吧|好|行|嗯嗯|嗯)?(?:那)?(?:我)?(?:就|选|要|吃|点)(?:吃|选|要|点)?(?:这个|这份|这道|这家|那个|那份|那道|它|第[一二三四五六七八九十\d]+(?:个|份|道|家))(?:吧|了|啦|好了|就行|就好|可以)*$`)
	// "我去吃饭了" / "那我先去吃了": the user is off to eat, nothing is asked.
	mealGoingToEatPattern = regexp.MustCompile(`^(?:好的|好吧|好|行|嗯嗯|嗯)?(?:那)?我(?:先)?(?:就)?(?:去|要去)?吃(?:饭|了|这个|这份|这道|它)(?:了|吧|啦|咯)?$`)

	mealThanks   = regexp.MustCompile(`谢|辛苦`)
	mealFarewell = regexp.MustCompile(`再见|拜拜|晚安`)
	mealGreeting = regexp.MustCompile(`你好|您好|嗨|哈喽|在吗|早安`)
	mealPraise   = regexp.MustCompile(`厉害|不错|真棒|太棒了|赞`)
)

var mealAcknowledgementReplies = map[string]string{
	"thanks":   "不客气～吃得开心！想换一份、改条件，或者看看最近的饮食，随时问我。",
	"greeting": "我在～想换一份推荐、改个条件，或者看看最近的饮食，都可以直接说。",
	"farewell": "好的，下次见～",
	"praise":   "谢谢夸奖～有想调整的条件，随时告诉我。",
	"decision": "好的，就这份～需要核对价格、位置，或者换一份，随时告诉我。",
	"going":    "好的～吃得开心！吃完想记录这一餐，也可以告诉我。",
	"ack":      "好的～还有想调整的条件，直接告诉我就行。",
}

func mealChatCompact(question string) string {
	return mealChatNotKept.ReplaceAllString(question, "")
}

// mealChatAcknowledgementKind names the kind of acknowledgement a message is, or
// "" when it carries anything else. A question ("就这个？", "好吗") is never one;
// only "在吗" is a greeting.
func mealChatAcknowledgementKind(question string) string {
	compact := mealChatCompact(question)
	asks := strings.ContainsAny(question, "?？") || strings.HasSuffix(compact, "吗") || strings.HasSuffix(compact, "么") || strings.HasSuffix(compact, "嘛")
	if asks && !strings.HasSuffix(compact, "在吗") {
		return ""
	}
	switch {
	case mealDecisionPattern.MatchString(compact):
		return "decision"
	case mealGoingToEatPattern.MatchString(compact):
		return "going"
	case !mealSmallTalkPattern.MatchString(compact):
		return ""
	case mealThanks.MatchString(compact):
		return "thanks"
	case mealFarewell.MatchString(compact):
		return "farewell"
	case mealGreeting.MatchString(compact):
		return "greeting"
	case mealPraise.MatchString(compact):
		return "praise"
	}
	return "ack"
}

// petChatFreeAcknowledgementMessage marks the two stored messages of a free reply.
// The meal context looks straight through them: a thank-you is not a change of topic.
func petChatFreeAcknowledgementMessage(message domain.PetChatMessage) bool {
	status, _ := message.Meta["billing_status"].(string)
	return status == petChatFreeAcknowledgement
}

// lastAssistantAsksQuestion is true when the latest real answer ended on a question.
// A bare "好的" then most likely answers it, so it is not just an acknowledgement.
func lastAssistantAsksQuestion(history []domain.PetChatMessage) bool {
	for i := len(history) - 1; i >= 0; i-- {
		message := history[i]
		if normalizePetChatRole(message.Role) != "assistant" || petChatFreeAcknowledgementMessage(message) {
			continue
		}
		content := strings.TrimSpace(message.Content)
		return strings.HasSuffix(content, "？") || strings.HasSuffix(content, "?")
	}
	return false
}

// petChatAcknowledgementReply answers an acknowledgement while the conversation's
// meal recommendation is still the thing being talked about and still has options.
// After a clarifying question, after other chat, or in a conversation without a
// recommendation, the ordinary routing answers.
func (s *StatsService) petChatAcknowledgementReply(ctx context.Context, userID string, input PetChatInput) (string, bool) {
	sessionID := strings.TrimSpace(input.SessionID)
	if s == nil || s.repo == nil || len(input.ImageURLs) > 0 || sessionID == "" || input.NewSession {
		return "", false
	}
	kind := mealChatAcknowledgementKind(normalizePetChatQuestion(input.Question))
	if kind == "" {
		return "", false
	}
	history, err := s.repo.GetPetChatSessionMessages(ctx, userID, sessionID, 16)
	if err != nil {
		return "", false
	}
	if recommendation, _ := activeCampusDietRecommendation(history); recommendation == nil || len(recommendation.Recommendations) == 0 {
		return "", false
	}
	if kind == "ack" && lastAssistantAsksQuestion(history) {
		return "", false
	}
	return mealAcknowledgementReplies[kind], true
}

func (s *StatsService) streamPetChatAcknowledgement(ctx context.Context, userID string, input PetChatInput, reply string) (<-chan PetChatStreamChunk, error) {
	question := normalizePetChatQuestion(input.Question)
	comp, err := s.buildStatsComputation(ctx, userID, input.Range, 2000, 0)
	if err != nil {
		return nil, err
	}
	session, err := s.resolvePetChatSession(ctx, userID, input, comp, question)
	if err != nil {
		return nil, err
	}
	if history, err := s.repo.GetPetChatSessionMessages(ctx, userID, session.ID, 16); err == nil {
		if active, _ := activeCampusDietRecommendation(history); active != nil {
			reply = s.mealAcknowledgementWords(ctx, userID, question, active, reply)
		}
	}
	chunks := make(chan PetChatStreamChunk, 3)
	go func() {
		defer close(chunks)
		chunks <- PetChatStreamChunk{Type: "start"}
		chunks <- PetChatStreamChunk{Type: "chunk", Text: reply}
		userMessageID, assistantMessageID := s.persistPetChatExchange(ctx, userID, session.ID, comp.StatsRange, question, reply, 0, nil, nil, petChatFreeAcknowledgement, nil)
		chunks <- newPetChatDoneChunk(session.ID, userMessageID, assistantMessageID, comp, 0, petChatFreeAcknowledgement, nil, billing.PricingResult{})
	}()
	return chunks, nil
}

const mealAcknowledgementTimeout = 4 * time.Second

var mealAcknowledgementUnsafe = regexp.MustCompile(`[0-9０-９]|元|千卡|大卡|kcal|卡路里|治疗|保证|一定能`)

const mealAcknowledgementPrompt = `你是用户的宠物饮食伙伴。用户刚收到一组餐食推荐，然后回了一句话。
用一句自然、口语化的中文回应，不超过40个字：
- 用户选定了其中一份（如“就这个”“第二个”“要牛腩那个”），说出是哪一份，可以提一句在哪里买；不确定是哪一份就简短问一句。
- 道谢、道别、打招呼或单纯说“好的”，就自然回应，可以顺带说一句需要再换随时说。
不要推荐新的菜，不要写数字、价格、营养数值，不做健康承诺。只输出JSON：{"reply":"这句话"}`

// mealAcknowledgementWords lets the model answer a thank-you or a choice in context
// ("好，那就番茄牛腩饭，在桃李园一楼"). It costs no credits; the fixed reply is used when
// the model is unavailable, slow, or writes something a fixed reply would not (numbers,
// prices, promises, a long text).
func (s *StatsService) mealAcknowledgementWords(ctx context.Context, userID, question string, active *DietRecommendationResult, fallback string) string {
	if s == nil || s.mealRouterOff || s.cfg == nil {
		return fallback
	}
	llm := s.preferredTextLLM()
	if strings.TrimSpace(llm.APIKey) == "" {
		return fallback
	}
	options := []string{}
	for i, option := range active.Recommendations {
		venue := strings.TrimSpace(strings.Join(compactDietStrings(option.CanteenName, option.WindowName), " "))
		if venue == "" {
			venue = option.MerchantName
		}
		options = append(options, fmt.Sprintf("第%d份「%s」%s", i+1, option.Title, venue))
	}
	payload, _ := json.Marshal(map[string]any{"recommendations": options, "user_reply": question})
	wordsCtx, cancel := context.WithTimeout(ctx, mealAcknowledgementTimeout)
	defer cancel()
	completion, err := s.requestCampusDietAgentCompletion(wordsCtx, llm, []map[string]any{{"role": "system", "content": mealAcknowledgementPrompt}, {"role": "user", "content": string(payload)}}, nil, "none", false)
	if err != nil {
		logger.Warn(ctx, "确认回复生成失败，使用固定回复", logger.UserID(userID), logger.Err(err))
		return fallback
	}
	words := mealModelReplyText(completion.Message.Content)
	if words == "" || utf8.RuneCountInString(words) > 60 || strings.ContainsAny(words, "\n{}") || mealAcknowledgementUnsafe.MatchString(words) {
		return fallback
	}
	return words
}

// mealModelReplyText reads a short reply however the provider wrapped it: {"reply": "…"},
// a chat-message list [{"content": "…"}], or plain text.
func mealModelReplyText(content string) string {
	text := strings.TrimSpace(campusDietAgentFencePattern.ReplaceAllString(content, ""))
	for range 2 {
		var object struct {
			Reply   string `json:"reply"`
			Content string `json:"content"`
		}
		var list []struct {
			Content string `json:"content"`
		}
		switch {
		case json.Unmarshal([]byte(text), &object) == nil && (object.Reply != "" || object.Content != ""):
			text = strings.TrimSpace(defaultIfEmpty(object.Reply, object.Content))
		case json.Unmarshal([]byte(text), &list) == nil && len(list) > 0:
			text = strings.TrimSpace(list[0].Content)
		default:
			return strings.Trim(text, "\"“”'")
		}
	}
	return strings.Trim(text, "\"“”'")
}
