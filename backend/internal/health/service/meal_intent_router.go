package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"regexp"
	"strings"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/logger"
)

// The fast rules (campusDietAgentFoodQuestion, campusDietAgentContextualQuestion, …) only
// recognise wording they were written for. A turn they do not recognise, in a conversation
// about a meal or mentioning food at all, is read by the model instead: "待会儿打完羽毛球
// 先垫点啥", "这几个都太油了", "算了还是吃面吧". The model can only add a turn to the meal
// conversation, never take one away, so the price shown before sending is never exceeded:
// a meal turn costs at most what the ordinary chat costs.
const mealRouterTimeout = 3 * time.Second

var mealRouterFoodSignal = regexp.MustCompile(`吃|饭|餐|饿|食|外卖|菜|喝|面|粉|粥|点单|夜宵|宵夜|零食|奶茶|咖啡|水果|蛋白|热量|减脂|增肌|健身|训练|便宜|贵|预算|口味|辣|清淡|油|店|商家|食堂|附近|窗口|打包`)

const mealRouterPrompt = `你负责给宠物饮食助手判断用户这一句话交给谁回答。
meal：用户在要吃什么的推荐，或者在回应、调整、追问屏幕上的餐食推荐——例如换一批、换口味、预算、忌口、太油太辣、地点、外卖还是食堂、训练前后吃什么、问推荐的菜在哪里/多少钱/有没有汤/能不能打包、抱怨推荐得不对、选定其中一个并追问。
chat：其他一切——分析自己过去吃得怎么样、问营养知识、健康/运动/睡眠/情绪、闲聊，以及和吃饭无关的抱怨。
只输出JSON：{"route":"meal"} 或 {"route":"chat"}。`

// mealRouterSaysMeal asks the model whether an unrecognised turn belongs to the meal
// conversation. Any failure or timeout keeps the fast rules' answer (not a meal turn).
func (s *StatsService) mealRouterSaysMeal(ctx context.Context, userID, question string, history []domain.PetChatMessage, mealContext bool) bool {
	if s == nil || s.mealRouterOff || s.cfg == nil || !mealContext && !mealRouterFoodSignal.MatchString(question) {
		return false
	}
	llm := s.preferredTextLLM()
	if strings.TrimSpace(llm.APIKey) == "" {
		return false
	}
	payload, _ := json.Marshal(map[string]any{"recent_conversation": mealRouterConversation(history), "current_message": question})
	routeCtx, cancel := context.WithTimeout(ctx, mealRouterTimeout)
	defer cancel()
	started := time.Now()
	completion, err := s.requestCampusDietAgentCompletion(routeCtx, llm, []map[string]any{{"role": "system", "content": mealRouterPrompt}, {"role": "user", "content": string(payload)}}, nil, "none", false)
	if err != nil {
		logger.Warn(ctx, "伙伴对话模型分流失败，沿用规则结果", logger.UserID(userID), logger.Err(err))
		return false
	}
	var answer struct {
		Route string `json:"route"`
	}
	if json.Unmarshal([]byte(mealModelReplyText(completion.Message.Content)), &answer) != nil {
		return false
	}
	logger.Info(ctx, "伙伴对话模型分流", logger.UserID(userID), slog.String("route", answer.Route), slog.Int64("duration_ms", time.Since(started).Milliseconds()))
	return answer.Route == "meal"
}

// mealRouterConversation is the last few turns in a compact form: what the user said,
// which dishes were on screen, and the start of other answers.
func mealRouterConversation(history []domain.PetChatMessage) []string {
	if len(history) > 6 {
		history = history[len(history)-6:]
	}
	lines := make([]string, 0, len(history))
	for _, message := range history {
		if normalizePetChatRole(message.Role) == "user" {
			lines = append(lines, "用户："+trimStatsRunes(message.Content, 80))
			continue
		}
		if message.MessageType == "diet_recommendation" {
			if result, _ := activeCampusDietRecommendation([]domain.PetChatMessage{message}); result != nil {
				titles := []string{}
				for _, option := range result.Recommendations {
					titles = append(titles, option.Title)
				}
				lines = append(lines, "助手推荐了："+strings.Join(titles, "、"))
				continue
			}
		}
		lines = append(lines, "助手："+trimStatsRunes(message.Content, 60))
	}
	return lines
}

// mealTurnByAgent marks a stored user message the meal Agent answered, whatever its wording.
func mealTurnByAgent(message domain.PetChatMessage) bool {
	intent, _ := message.Meta["intent"].(string)
	return intent == "campus_diet_agent"
}
