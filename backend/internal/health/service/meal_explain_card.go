package service

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"food_link/backend/pkg/logger"
)

// "你为什么推荐这些？" asks about the card on screen. Trial 2026-11-13: the question went
// through the whole search loop, the model searched three times, timed out, and the fallback
// showed three new meals; "我在问你为什么推荐这些，不要再给我推荐了" got a fourth set. An
// explanation is now one model call without tools, from the card's own reasons, the user's
// day and what the user said in this conversation; no new meals. When the model is slow or
// down, the card's recorded reasons answer instead.

const mealExplainTimeout = 20 * time.Second

var (
	// "不要再给我推荐了" / "别推荐了": the user wants an answer, not more meals.
	mealStopRecommending = regexp.MustCompile(`(?:不要|别|不用|不需要)(?:再)?(?:给我)?(?:推荐|找|换)(?:了|啦|新的|别的)?`)
	// "我在问你…" / "我是问…": framing of the question, not a place ("我在北大") or a new wish.
	mealAskingFrame = regexp.MustCompile(`我(?:在|是|就是|只是)?问(?:你)?|我问的是`)
	// "你确定没有获取到位置？" asks about the user's own location, not where a dish is.
	mealAsksAboutOwnLocation = regexp.MustCompile(`(?:获取|拿|读|收)到?(?:了)?(?:我的)?(?:位置|定位)|(?:没|有没有)(?:获取|拿到|读到|开)?(?:我的)?定位|定位(?:了吗|到了吗|成功了吗|不了)|知道我在哪`)
)

const mealExplainPrompt = `你是用户的饮食伙伴。用户在追问刚才那张推荐卡片：为什么推荐这几份，或者这几份适不适合他现在的情况。
只解释卡片上这几份，不推荐新的菜，也不要说会再去找。要结合用户在对话里说过的情况（作息、睡眠、精力、训练、身体不适、之后的安排），说清楚这几份为什么合适、哪一份最合适、吃的时候注意什么（例如吃到七八分饱、少油少汤、配不配饮品）。
数字只能用给出的数据，不编造；不做医疗承诺。用2到4句自然口语。只输出JSON：{"reply":"回答"}`

// explainActiveMeals answers a question about the meals already on the card.
func (s *StatsService) explainActiveMeals(ctx context.Context, state *campusDietAgentRunState) *CampusDietAgentResult {
	options := state.ActiveResult.Recommendations
	_ = s.loadMealHarnessContext(ctx, state)
	answer, used := mealCardReasonsAnswer(options), false
	if words := s.mealExplainWords(ctx, state, options); words != "" {
		answer, used = words, true
	}
	recommendation := DietRecommendationResult{
		Scene: defaultIfEmpty(state.ActiveResult.Scene, "eat_out"), Title: "推荐理由", Summary: answer,
		Recommendations: []DietRecommendationOption{}, HarnessVersion: mealHarnessVersion,
		SearchScope: state.ActiveResult.SearchScope, AgentConstraints: &state.Constraints, ExplainsPrevious: true,
	}
	result := &CampusDietAgentResult{AgentRunID: state.RunID, Answer: answer, Recommendation: recommendation, ToolTrace: state.ToolTrace, ToolCount: state.ToolCount, AgentUsed: used}
	if !used {
		result.FallbackReason = "explained_from_card"
	}
	return result
}

// mealCardReasonsAnswer says what the card already records for each meal.
func mealCardReasonsAnswer(options []DietRecommendationOption) string {
	parts := []string{}
	for _, o := range options {
		reason := strings.TrimSpace(defaultIfEmpty(o.SelectionReason, o.Reason))
		if reason == "" {
			reason = "营养结构更接近你今天还差的部分"
		}
		parts = append(parts, o.Title+"："+trimStatsRunes(reason, 80))
		if len(parts) == 3 {
			break
		}
	}
	return "这几份是这样选的：" + strings.Join(parts, "；") + "。"
}

func (s *StatsService) mealExplainWords(ctx context.Context, state *campusDietAgentRunState, options []DietRecommendationOption) string {
	if s == nil || s.cfg == nil {
		return ""
	}
	llm := s.preferredTextLLM()
	if strings.TrimSpace(llm.APIKey) == "" {
		return ""
	}
	cards := []map[string]any{}
	for _, o := range options {
		cards = append(cards, map[string]any{
			"title": o.Title, "where": strings.TrimSpace(strings.Join(compactDietStrings(o.SchoolName, defaultIfEmpty(o.CanteenName, o.MerchantName)), " ")),
			"calories": o.Calories, "protein": o.Protein, "carbs": o.Carbs, "fat": o.Fat,
			"recorded_reason": trimStatsRunes(defaultIfEmpty(o.SelectionReason, o.Reason), 160),
		})
	}
	said := []string{}
	for _, m := range state.History {
		if normalizePetChatRole(m.Role) == "user" {
			said = append(said, trimStatsRunes(m.Content, 200))
		}
	}
	if len(said) > 6 {
		said = said[len(said)-6:]
	}
	payload, _ := json.Marshal(map[string]any{
		"question": state.Question, "user_said_before": said, "cards": cards,
		"today": map[string]any{"meal": state.MealContext.MealType, "eaten": state.MealContext.Current, "still_needed": state.MealContext.Remaining, "goal": state.MealContext.UserGoal},
	})
	callCtx, cancel := context.WithTimeout(ctx, mealExplainTimeout)
	defer cancel()
	completion, err := s.requestCampusDietAgentCompletion(callCtx, llm, []map[string]any{{"role": "system", "content": mealExplainPrompt}, {"role": "user", "content": string(payload)}}, nil, "none", false)
	if err != nil {
		logger.Warn(ctx, "推荐理由解释生成失败，改用卡片记录的理由", logger.UserID(state.UserID), logger.Err(err))
		return ""
	}
	words := strings.TrimSpace(mealEvidenceText(state, mealModelReplyText(completion.Message.Content)))
	if utf8.RuneCountInString(words) < 8 || strings.ContainsAny(words, "{}") {
		return ""
	}
	return words
}

// mealLocationsAnswer names where each meal is bought, the place once for the dishes sold
// there ("手擀面、鸡胸肉、小白菜：AI原点社区食堂 B1 一城一味窗口"), not the full address per dish.
func mealLocationsAnswer(candidates []DietRecommendationCandidate) string {
	order, titles := []string{}, map[string][]string{}
	for _, c := range candidates {
		place := mealCandidateLocation(c)
		if c.IsCampusFood && place != "" && strings.TrimSpace(c.WindowName) == "" {
			place += "（具体窗口尚未收录）"
		}
		place = defaultIfEmpty(place, "餐食库暂未记录具体位置")
		if _, ok := titles[place]; !ok {
			order = append(order, place)
		}
		if !slicesContainsString(titles[place], c.Title) {
			titles[place] = append(titles[place], c.Title)
		}
	}
	lines := make([]string, 0, len(order))
	for _, place := range order {
		lines = append(lines, strings.Join(titles[place], "、")+"："+place)
	}
	return "在这些地方买：\n" + strings.Join(lines, "；\n") + "。"
}

func slicesContainsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// mealExplainIntent says how a follow-up about the card should be read before the ordinary
// intent rules: an explanation, a retry after the user's location arrived, or neither.
func mealExplainIntent(question string, hasCard bool) string {
	compact := strings.ReplaceAll(strings.TrimSpace(question), " ", "")
	if mealAsksAboutOwnLocation.MatchString(compact) {
		return "initial"
	}
	if !hasCard || !(strings.Contains(compact, "为什么") || mealStopRecommending.MatchString(compact)) {
		return ""
	}
	rest := mealAskingFrame.ReplaceAllString(mealStopRecommending.ReplaceAllString(compact, ""), "")
	if !campusDietAgentHasNewSearchConstraints(rest) {
		return "explain"
	}
	return ""
}
