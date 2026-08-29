package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"food_link/backend/internal/billing"
	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/logger"

	"github.com/google/uuid"
	"log/slog"
)

const (
	campusDietAgentModel             = "qwen3.6-flash"
	campusDietAgentMaxRounds         = 4
	campusDietAgentMaxToolCalls      = 6
	campusDietAgentDefaultResultSize = 5
	campusDietAgentSearchLimit       = 20
	campusDietAgentModelTimeout      = 26 * time.Second
	campusDietAgentFallbackTimeout   = 3 * time.Second
)

type CampusDietAgentProgress struct {
	AgentRunID  string `json:"agent_run_id"`
	Step        int    `json:"step"`
	Label       string `json:"label"`
	ToolName    string `json:"tool_name,omitempty"`
	Status      string `json:"status"`
	ResultCount int    `json:"result_count,omitempty"`
}

type CampusDietAgentToolTrace struct {
	ToolName    string `json:"tool_name"`
	Status      string `json:"status"`
	ResultCount int    `json:"result_count,omitempty"`
	DurationMS  int64  `json:"duration_ms"`
}

type CampusDietAgentEvidence struct {
	SourceID         string  `json:"source_id"`
	FoodName         string  `json:"food_name"`
	Calories         float64 `json:"calories"`
	Protein          float64 `json:"protein"`
	Carbs            float64 `json:"carbs"`
	Fat              float64 `json:"fat"`
	NutritionBasis   string  `json:"nutrition_basis"`
	WeightMethod     string  `json:"weight_method,omitempty"`
	WeightConfidence float64 `json:"weight_confidence,omitempty"`
	UncertaintyLevel string  `json:"uncertainty_level,omitempty"`
}

type CampusDietAgentResult struct {
	AgentRunID     string                     `json:"agent_run_id"`
	Answer         string                     `json:"answer"`
	Recommendation DietRecommendationResult   `json:"recommendation"`
	Evidence       []CampusDietAgentEvidence  `json:"evidence"`
	ToolTrace      []CampusDietAgentToolTrace `json:"tool_trace"`
	AgentUsed      bool                       `json:"agent_used"`
	ToolCount      int                        `json:"tool_count"`
	FallbackReason string                     `json:"fallback_reason,omitempty"`
	Usage          billing.TokenUsage         `json:"-"`
}

type campusDietAgentMealContext struct {
	Date            string                  `json:"date"`
	MealType        string                  `json:"meal_type"`
	UserGoal        string                  `json:"user_goal"`
	CalorieTarget   float64                 `json:"calorie_target"`
	Current         DietRecommendationMacro `json:"current"`
	Remaining       DietRecommendationMacro `json:"remaining"`
	Allergies       []string                `json:"allergies,omitempty"`
	DietPreferences []string                `json:"diet_preferences,omitempty"`
}

type campusDietAgentRunState struct {
	RunID             string
	UserID            string
	Question          string
	Intent            string
	School            domain.DietRecommendationSchool
	CampusID          string
	CampusName        string
	MealContext       campusDietAgentMealContext
	Constraints       CampusDietRecommendationConstraints
	ActiveResult      *DietRecommendationResult
	ActiveSourceIDs   []string
	ExcludedSourceIDs []string
	Candidates        map[string]DietRecommendationCandidate
	LastSearch        []DietRecommendationCandidate
	SearchTotal       int64
	ToolTrace         []CampusDietAgentToolTrace
	ToolCount         int
	ProgressStep      int
	MealContextLoaded bool
	Progress          func(CampusDietAgentProgress)
}

type campusDietAgentToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type campusDietAgentCompletion struct {
	Message struct {
		Role      string                    `json:"role"`
		Content   string                    `json:"content"`
		ToolCalls []campusDietAgentToolCall `json:"tool_calls"`
	} `json:"message"`
	Usage billing.TokenUsage
}

type campusDietAgentFinalSelection struct {
	SourceID string `json:"source_id"`
	Reason   string `json:"reason"`
	Tip      string `json:"tip"`
}

type campusDietAgentFinal struct {
	Answer     string                          `json:"answer"`
	Selections []campusDietAgentFinalSelection `json:"selections"`
}

var (
	campusDietAgentFencePattern               = regexp.MustCompile("(?s)```(?:json)?\\s*|```")
	campusDietAgentCaloriePattern             = regexp.MustCompile(`(?i)(\d{2,4}(?:\.\d+)?)\s*(?:千卡|大卡|卡路里|kcal|卡)\s*(?:以内|以下|之内)?`)
	campusDietAgentBareCaloriePattern         = regexp.MustCompile(`(\d{3,4}(?:\.\d+)?)\s*(?:以内|以下|之内)`)
	campusDietAgentPricePattern               = regexp.MustCompile(`(?i)(?:[¥￥]\s*)?(\d{1,4}(?:\.\d+)?)\s*(?:元|块)(?:钱)?\s*(?:以内|以下|之内|左右)?`)
	campusDietAgentBudgetPattern              = regexp.MustCompile(`(?:预算|最多|不超过|控制在)\s*(?:[¥￥]\s*)?(\d{1,4}(?:\.\d+)?)`)
	campusDietAgentDigitPattern               = regexp.MustCompile(`[0-9０-９]`)
	campusDietAgentChineseNumericClaimPattern = regexp.MustCompile(`[零一二三四五六七八九十百千万两]+\s*(?:千卡|大卡|卡路里|卡|克|元|楼)`)
)

func (s *StatsService) shouldUseCampusDietAgent(ctx context.Context, userID string, input PetChatInput) bool {
	question := normalizePetChatQuestion(input.Question)
	if question == "" || s == nil || s.repo == nil {
		return false
	}
	var history []domain.PetChatMessage
	if strings.TrimSpace(input.SessionID) != "" && !input.NewSession {
		history, _ = s.repo.GetPetChatSessionMessages(ctx, userID, input.SessionID, 16)
	}
	active, _ := activeCampusDietRecommendation(history)
	if campusDietAgentExplicitTopicSwitch(question) {
		return false
	}
	if active != nil && campusDietAgentContextualQuestion(question) {
		return true
	}
	if !campusDietAgentFoodQuestion(question) {
		return false
	}
	school, _, _ := s.resolveDietRecommendationSchool(ctx, userID, DietRecommendationInput{
		Question: question, SessionID: input.SessionID,
	})
	return school != nil
}

func campusDietAgentExplicitTopicSwitch(question string) bool {
	normalized := strings.ReplaceAll(strings.TrimSpace(question), " ", "")
	return regexp.MustCompile(`训练|运动|跑步|力量|睡眠|作息|喝水|补剂|体检|体重趋势`).MatchString(normalized) &&
		!regexp.MustCompile(`吃|菜|餐|食堂|饮食|热量|蛋白|碳水|脂肪`).MatchString(normalized)
}

func campusDietAgentFoodQuestion(question string) bool {
	normalized := strings.ReplaceAll(strings.TrimSpace(question), " ", "")
	return regexp.MustCompile(`吃什么|推荐.*(?:菜|餐|食物)|食堂|校园餐|减脂餐|增肌餐|\d+卡|热量|卡路里|蛋白|碳水|脂肪|菜品`).MatchString(normalized)
}

func campusDietAgentContextualQuestion(question string) bool {
	normalized := strings.ReplaceAll(strings.TrimSpace(question), " ", "")
	return campusDietAgentFoodQuestion(normalized) || regexp.MustCompile(`这(?:几|三|五|\d+)个|这些|刚才|前面|上面|你推荐的|还有|其他|换一批|再来|解释|为什么|各自|分别|哪里|在哪`).MatchString(normalized)
}

func campusDietAgentIntent(question string, active *DietRecommendationResult) string {
	normalized := strings.ReplaceAll(strings.TrimSpace(question), " ", "")
	switch {
	case regexp.MustCompile(`还有|其他|换一批|再来|再推荐|更多|别的`).MatchString(normalized):
		return "more"
	case regexp.MustCompile(`在哪|在哪里|哪里|哪个食堂|位置|几楼|楼层|窗口|档口`).MatchString(normalized):
		return "location"
	case regexp.MustCompile(`哪个|哪道|更适合|比较|对比|优先`).MatchString(normalized) && active != nil:
		return "compare"
	case active != nil && campusDietAgentHasNewSearchConstraints(normalized):
		return "refine"
	case regexp.MustCompile(`各自|分别|热量|卡路里|多少卡|蛋白|碳水|脂肪|营养|价格`).MatchString(normalized) && active != nil:
		return "facts"
	case regexp.MustCompile(`解释|为什么|怎么选|搭配逻辑`).MatchString(normalized) && active != nil:
		return "explain"
	default:
		return "initial"
	}
}

func campusDietAgentHasNewSearchConstraints(question string) bool {
	if campusDietAgentExplicitCalorieLimit(question) != nil || campusDietAgentExplicitPriceLimit(question) != nil {
		return true
	}
	return regexp.MustCompile(`太贵|贵了|便宜|实惠|预算|减脂|减肥|增肌|高蛋白|低脂|清淡|少油|不要|换成|改成`).MatchString(question)
}

func campusDietAgentIsSearchIntent(intent string) bool {
	return intent == "initial" || intent == "refine" || intent == "more"
}

func resolveCampusDietAgentConstraints(messages []domain.PetChatMessage, active *DietRecommendationResult, question string) CampusDietRecommendationConstraints {
	constraints := CampusDietRecommendationConstraints{}
	if active != nil && active.AgentConstraints != nil {
		constraints = *active.AgentConstraints
	} else {
		for _, message := range messages {
			if normalizePetChatRole(message.Role) == "user" {
				applyCampusDietAgentQuestionConstraints(&constraints, message.Content)
			}
		}
	}
	applyCampusDietAgentQuestionConstraints(&constraints, question)
	return constraints
}

func applyCampusDietAgentQuestionConstraints(constraints *CampusDietRecommendationConstraints, question string) {
	if constraints == nil {
		return
	}
	normalized := strings.ReplaceAll(strings.TrimSpace(question), " ", "")
	if regexp.MustCompile(`价格不限|预算不限|不考虑价格`).MatchString(normalized) {
		constraints.MaxPrice = nil
		constraints.SortBy = ""
	}
	if regexp.MustCompile(`热量不限|不限制热量|不考虑热量`).MatchString(normalized) {
		constraints.MaxCalories = nil
	}
	if goal := campusDietAgentExplicitGoal(normalized); goal != "" {
		constraints.Goal = goal
	}
	if limit := campusDietAgentExplicitCalorieLimit(normalized); limit != nil {
		constraints.MaxCalories = limit
	}
	priceLimit := campusDietAgentExplicitPriceLimit(normalized)
	if priceLimit != nil {
		limit := priceLimit
		constraints.MaxPrice = limit
	}
	if priceLimit != nil {
		constraints.SortBy = campusDietAgentSortForGoal(constraints.Goal)
	} else if regexp.MustCompile(`太贵|贵了|便宜|实惠|预算`).MatchString(normalized) {
		constraints.SortBy = "lowest_price"
	} else if regexp.MustCompile(`减脂|减肥|高蛋白|低脂`).MatchString(normalized) {
		constraints.SortBy = "protein_density"
	} else if regexp.MustCompile(`增肌|补蛋白`).MatchString(normalized) {
		constraints.SortBy = "highest_protein"
	}
}

func campusDietAgentSortForGoal(goal string) string {
	switch strings.ToLower(strings.TrimSpace(goal)) {
	case "muscle_gain", "增肌":
		return "highest_protein"
	case "fat_loss", "减脂", "减肥":
		return "protein_density"
	default:
		return "best_match"
	}
}

func activeCampusDietRecommendation(messages []domain.PetChatMessage) (*DietRecommendationResult, []string) {
	var latest *DietRecommendationResult
	allIDs := make([]string, 0, 12)
	seen := map[string]bool{}
	for _, message := range messages {
		if message.MessageType != "diet_recommendation" || len(message.Meta) == 0 {
			continue
		}
		raw, ok := message.Meta["diet_recommendation"]
		if !ok || raw == nil {
			continue
		}
		encoded, err := json.Marshal(raw)
		if err != nil {
			continue
		}
		var result DietRecommendationResult
		if err := json.Unmarshal(encoded, &result); err != nil || result.ResolvedSchool == nil {
			continue
		}
		copyResult := result
		latest = &copyResult
		for _, option := range result.Recommendations {
			id := strings.TrimSpace(option.SourceID)
			if id != "" && !seen[id] {
				seen[id] = true
				allIDs = append(allIDs, id)
			}
		}
	}
	return latest, allIDs
}

func (s *StatsService) GenerateCampusDietAgentStream(ctx context.Context, userID string, input PetChatInput) (<-chan PetChatStreamChunk, error) {
	question := normalizePetChatQuestion(input.Question)
	if question == "" {
		return nil, fmt.Errorf("question required")
	}
	comp, err := s.buildStatsComputation(ctx, userID, input.Range, 2000, 0)
	if err != nil {
		return nil, err
	}
	comp.PetCompanion = s.resolvePetChatCompanion(ctx, userID)
	session, err := s.resolvePetChatSession(ctx, userID, input, comp, question)
	if err != nil {
		return nil, err
	}
	history, err := s.repo.GetPetChatSessionMessages(ctx, userID, session.ID, 20)
	if err != nil {
		history = nil
	}
	active, allIDs := activeCampusDietRecommendation(history)
	school, campusID, campusName := s.resolveDietRecommendationSchool(ctx, userID, DietRecommendationInput{
		Question: question, SessionID: session.ID,
	})
	if active != nil && active.ResolvedSchool != nil && (school == nil || strings.TrimSpace(school.ID) == "") {
		school = active.ResolvedSchool
		campusID = active.CampusID
		campusName = active.CampusName
	}
	if school == nil || strings.TrimSpace(school.ID) == "" {
		return nil, fmt.Errorf("未识别到校园")
	}

	chunkChan := make(chan PetChatStreamChunk, 40)
	go func() {
		defer close(chunkChan)
		chunkChan <- PetChatStreamChunk{Type: "start"}
		startedAt := time.Now()
		runID := uuid.NewString()
		state := &campusDietAgentRunState{
			RunID: runID, UserID: userID, Question: question,
			Intent: campusDietAgentIntent(question, active), School: *school,
			Constraints: resolveCampusDietAgentConstraints(history, active, question),
			CampusID:    campusID, CampusName: campusName, ActiveResult: active,
			ActiveSourceIDs:   recommendationSourceIDsFromResult(active),
			ExcludedSourceIDs: allIDs, Candidates: map[string]DietRecommendationCandidate{},
			Progress: func(progress CampusDietAgentProgress) {
				chunkChan <- PetChatStreamChunk{Type: "progress", Progress: &progress}
			},
		}
		state.emitProgress("正在准备校园餐查询", "", "running", 0)
		agentCtx, cancel := context.WithTimeout(ctx, campusDietAgentModelTimeout)
		defer cancel()
		result := s.runCampusDietAgent(agentCtx, state)
		creditsCharged, billingStatus, actualPricing := s.chargeCampusDietAgent(ctx, userID, session.ID, result)
		result.Recommendation.SessionID = session.ID
		userMessageID, assistantMessageID := s.persistCampusDietAgentExchange(ctx, userID, session.ID, comp.StatsRange, question, result, creditsCharged, actualPricing, billingStatus)
		result.Recommendation.UserMessageID = userMessageID
		result.Recommendation.AssistantMessageID = assistantMessageID
		chunkChan <- PetChatStreamChunk{Type: "diet_result", DietResult: result}
		chunkChan <- PetChatStreamChunk{Type: "chunk", Text: result.Answer}
		logger.Info(ctx, "校园餐宠物Agent流式生成完成",
			logger.UserID(userID),
			slog.String("session_id", session.ID),
			slog.String("agent_run_id", runID),
			slog.String("school_id", school.ID),
			slog.Bool("agent_used", result.AgentUsed),
			slog.Int("tool_count", result.ToolCount),
			slog.Int("recommendation_count", len(result.Recommendation.Recommendations)),
			slog.Int64("total_duration_ms", time.Since(startedAt).Milliseconds()),
		)
		chunkChan <- newPetChatDoneChunk(session.ID, userMessageID, assistantMessageID, comp, creditsCharged, billingStatus, actualPricing, s.campusDietAgentEstimatedPricing())
	}()
	return chunkChan, nil
}

func (s *StatsService) runCampusDietAgent(ctx context.Context, state *campusDietAgentRunState) *CampusDietAgentResult {
	llm := s.preferredTextLLM()
	llm.Model = campusDietAgentModel
	if strings.TrimSpace(llm.APIKey) == "" || llm.Provider != "qwen" {
		return s.campusDietAgentFallback(ctx, state, "model_unavailable")
	}

	messages := campusDietAgentInitialMessages(state)
	tools := campusDietAgentToolDefinitions()
	var usage billing.TokenUsage
	var final campusDietAgentFinal
	for round := 0; round < campusDietAgentMaxRounds; round++ {
		var choice any = "auto"
		if !state.MealContextLoaded {
			choice = map[string]any{"type": "function", "function": map[string]any{"name": "get_meal_context"}}
		} else if len(state.Candidates) == 0 {
			choice = "required"
		} else if round == campusDietAgentMaxRounds-1 {
			// The last model turn is reserved for the user-facing answer. Qwen may
			// otherwise keep calling compare/details even though all evidence is
			// already available, which incorrectly turns a valid run into fallback.
			choice = "none"
		}
		modelStarted := time.Now()
		completion, err := s.requestCampusDietAgentCompletion(ctx, llm, messages, tools, choice)
		if err != nil {
			logger.Warn(ctx, "校园餐Agent模型调用失败，转为数据库兜底",
				logger.UserID(state.UserID), slog.String("agent_run_id", state.RunID),
				slog.String("model", llm.Model), slog.Int("round", round+1), logger.Err(err))
			return s.campusDietAgentFallback(ctx, state, "model_request_failed")
		}
		logger.Info(ctx, "校园餐Agent模型轮次完成",
			logger.UserID(state.UserID), slog.String("agent_run_id", state.RunID),
			slog.String("model", llm.Model), slog.Int("round", round+1),
			slog.Int("tool_call_count", len(completion.Message.ToolCalls)),
			slog.Int64("duration_ms", time.Since(modelStarted).Milliseconds()))
		usage = addCampusDietAgentUsage(usage, completion.Usage)
		if len(completion.Message.ToolCalls) > 0 {
			assistantMessage := map[string]any{"role": "assistant", "content": completion.Message.Content, "tool_calls": completion.Message.ToolCalls}
			messages = append(messages, assistantMessage)
			for _, call := range completion.Message.ToolCalls {
				if state.ToolCount >= campusDietAgentMaxToolCalls {
					return s.campusDietAgentFallback(ctx, state, "tool_call_limit")
				}
				toolOutput, toolErr := s.executeCampusDietAgentTool(ctx, state, call)
				if toolErr != nil {
					toolOutput = map[string]any{"error": "tool_failed"}
				}
				encoded, _ := json.Marshal(toolOutput)
				messages = append(messages, map[string]any{
					"role": "tool", "tool_call_id": call.ID, "name": call.Function.Name, "content": string(encoded),
				})
			}
			continue
		}
		if len(state.Candidates) == 0 {
			return s.campusDietAgentFallback(ctx, state, "model_skipped_data_tools")
		}
		content := strings.TrimSpace(campusDietAgentFencePattern.ReplaceAllString(completion.Message.Content, ""))
		if err := json.Unmarshal([]byte(content), &final); err != nil {
			return s.campusDietAgentFallback(ctx, state, "invalid_final_json")
		}
		break
	}
	result, err := buildCampusDietAgentResult(state, final, true, "")
	if err != nil {
		selectionIDs := make([]string, 0, len(final.Selections))
		for _, selection := range final.Selections {
			selectionIDs = append(selectionIDs, strings.TrimSpace(selection.SourceID))
		}
		logger.Warn(ctx, "校园餐Agent最终选择校验失败",
			logger.UserID(state.UserID), slog.String("agent_run_id", state.RunID),
			slog.Int("selection_count", len(final.Selections)), slog.Any("source_ids", selectionIDs), logger.Err(err))
		return s.campusDietAgentFallback(ctx, state, "invalid_model_selection")
	}
	result.Usage = usage
	return result
}

func campusDietAgentInitialMessages(state *campusDietAgentRunState) []map[string]any {
	activeJSON := "[]"
	if state.ActiveResult != nil {
		items := make([]map[string]any, 0, len(state.ActiveResult.Recommendations))
		for _, option := range state.ActiveResult.Recommendations {
			items = append(items, map[string]any{"source_id": option.SourceID, "name": option.Title})
		}
		encoded, _ := json.Marshal(items)
		activeJSON = string(encoded)
	}
	constraintsJSON, _ := json.Marshal(state.Constraints)
	system := fmt.Sprintf(`你是食探校园餐Agent。当前学校是%s，当前任务类型是%s。
你必须先调用提供的只读工具获取真实数据，不能依靠记忆猜菜名、热量、价格或位置。
首次推荐、按新预算/热量/目标重新筛选或换一批时，必须调用 search_campus_foods；工具返回至少5条时必须选择恰好5道，不足5条则全部选择。解释、查询原菜热量/位置、比较追问必须调用 get_campus_food_details 或 compare_campus_foods，并只引用上一轮ID。
本轮明确的减脂、增肌、热量、价格和食堂要求优先于长期档案目标。
最终只输出JSON：{"answer":"简洁回答，不虚构数字","selections":[{"source_id":"真实ID","reason":"具体原因","tip":"可选提示"}]}。
当前已合并的硬约束：%s
当前上一轮菜品：%s`, state.School.Name, state.Intent, string(constraintsJSON), activeJSON)
	return []map[string]any{
		{"role": "system", "content": system},
		{"role": "user", "content": state.Question},
	}
}

func campusDietAgentToolDefinitions() []map[string]any {
	return []map[string]any{
		campusDietAgentToolDefinition("get_meal_context", "读取当前用户今天的热量、三大营养素缺口、目标和忌口。", map[string]any{"type": "object", "properties": map[string]any{}}),
		campusDietAgentToolDefinition("search_campus_foods", "在当前学校真实已发布校园菜品中按条件检索，学校身份由服务端锁定。", map[string]any{
			"type": "object", "properties": map[string]any{
				"keyword":      map[string]any{"type": "string"},
				"canteen_name": map[string]any{"type": "string"},
				"max_calories": map[string]any{"type": "number"},
				"min_protein":  map[string]any{"type": "number"},
				"max_fat":      map[string]any{"type": "number"},
				"max_price":    map[string]any{"type": "number"},
				"sort_by":      map[string]any{"type": "string", "enum": []string{"best_match", "lowest_calories", "highest_protein", "protein_density", "lowest_price"}},
				"limit":        map[string]any{"type": "integer", "minimum": 1, "maximum": 20},
				"offset":       map[string]any{"type": "integer", "minimum": 0},
			},
		}),
		campusDietAgentToolDefinition("get_campus_food_details", "按当前学校的真实source_id核对营养、份量、价格和食堂位置。", map[string]any{
			"type": "object", "properties": map[string]any{"source_ids": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "maxItems": 10}}, "required": []string{"source_ids"},
		}),
		campusDietAgentToolDefinition("compare_campus_foods", "对真实菜品做服务端精确比较，返回热量差、蛋白质密度、蛋白质每元和目标匹配分。", map[string]any{
			"type": "object", "properties": map[string]any{"source_ids": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "maxItems": 10}}, "required": []string{"source_ids"},
		}),
	}
}

func campusDietAgentToolDefinition(name, description string, parameters map[string]any) map[string]any {
	return map[string]any{"type": "function", "function": map[string]any{"name": name, "description": description, "parameters": parameters}}
}

func (s *StatsService) requestCampusDietAgentCompletion(ctx context.Context, llm textLLMRuntimeConfig, messages, tools []map[string]any, toolChoice any) (campusDietAgentCompletion, error) {
	body := map[string]any{
		"model": campusDietAgentModel, "messages": messages, "tools": tools,
		"tool_choice": toolChoice, "parallel_tool_calls": true,
		"enable_thinking": false, "temperature": 0.2, "max_tokens": 1000, "stream": false,
	}
	encoded, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(llm.BaseURL, "/")+"/chat/completions", bytes.NewReader(encoded))
	if err != nil {
		return campusDietAgentCompletion{}, err
	}
	req.Header.Set("Authorization", "Bearer "+llm.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return campusDietAgentCompletion{}, err
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return campusDietAgentCompletion{}, fmt.Errorf("campus diet agent model status %d", resp.StatusCode)
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Role      string                    `json:"role"`
				Content   string                    `json:"content"`
				ToolCalls []campusDietAgentToolCall `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens          int `json:"prompt_tokens"`
			CompletionTokens      int `json:"completion_tokens"`
			TotalTokens           int `json:"total_tokens"`
			PromptCacheHitTokens  int `json:"prompt_cache_hit_tokens"`
			PromptCacheMissTokens int `json:"prompt_cache_miss_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(responseBody, &parsed); err != nil || len(parsed.Choices) == 0 {
		return campusDietAgentCompletion{}, fmt.Errorf("invalid campus diet agent response")
	}
	result := campusDietAgentCompletion{}
	result.Message = parsed.Choices[0].Message
	result.Usage = billing.TokenUsage{
		InputTokens: parsed.Usage.PromptTokens, OutputTokens: parsed.Usage.CompletionTokens,
		TotalTokens: parsed.Usage.TotalTokens, CachedInputTokens: parsed.Usage.PromptCacheHitTokens,
		CacheMissInputTokens: parsed.Usage.PromptCacheMissTokens,
	}
	return result, nil
}

func (s *StatsService) executeCampusDietAgentTool(ctx context.Context, state *campusDietAgentRunState, call campusDietAgentToolCall) (map[string]any, error) {
	startedAt := time.Now()
	name := strings.TrimSpace(call.Function.Name)
	state.emitProgress(campusDietAgentProgressLabel(name, false), name, "running", 0)
	var output map[string]any
	var err error
	switch name {
	case "get_meal_context":
		state.MealContext = s.buildCampusDietAgentMealContext(ctx, state.UserID, state.Question)
		if state.Constraints.Goal != "" {
			state.MealContext.UserGoal = state.Constraints.Goal
		}
		state.MealContextLoaded = true
		output = map[string]any{"meal_context": state.MealContext}
	case "search_campus_foods":
		if state.ActiveResult != nil && !campusDietAgentIsSearchIntent(state.Intent) {
			err = fmt.Errorf("follow-up questions must query the active source_ids")
		} else {
			output, err = s.executeCampusDietSearchTool(ctx, state, call.Function.Arguments)
		}
	case "get_campus_food_details":
		output, err = s.executeCampusDietDetailsTool(ctx, state, call.Function.Arguments, false)
	case "compare_campus_foods":
		output, err = s.executeCampusDietDetailsTool(ctx, state, call.Function.Arguments, true)
	default:
		err = fmt.Errorf("unsupported tool %s", name)
	}
	resultCount := campusDietAgentOutputCount(output)
	status := "success"
	if err != nil {
		status = "failed"
	}
	state.recordTool(name, status, resultCount, time.Since(startedAt).Milliseconds())
	state.emitProgress(campusDietAgentProgressLabel(name, true), name, status, resultCount)
	return output, err
}

func (s *StatsService) executeCampusDietSearchTool(ctx context.Context, state *campusDietAgentRunState, rawArguments string) (map[string]any, error) {
	var args struct {
		Keyword     string   `json:"keyword"`
		CanteenName string   `json:"canteen_name"`
		MaxCalories *float64 `json:"max_calories"`
		MinProtein  *float64 `json:"min_protein"`
		MaxFat      *float64 `json:"max_fat"`
		MaxPrice    *float64 `json:"max_price"`
		SortBy      string   `json:"sort_by"`
		Limit       int      `json:"limit"`
		Offset      int      `json:"offset"`
	}
	if err := json.Unmarshal([]byte(defaultIfEmpty(rawArguments, "{}")), &args); err != nil {
		return nil, err
	}
	if args.Limit <= 0 || args.Limit > campusDietAgentSearchLimit {
		args.Limit = campusDietAgentSearchLimit
	}
	target := campusDietAgentMealCalorieTarget(state.MealContext)
	maxCalories := state.Constraints.MaxCalories
	if maxCalories == nil {
		maxCalories = sanitizeCampusDietPositive(args.MaxCalories, 3000)
	}
	if maxCalories == nil {
		maxCalories = campusDietAgentDefaultCalorieLimit(state.MealContext)
	}
	maxPrice := state.Constraints.MaxPrice
	if maxPrice == nil {
		maxPrice = sanitizeCampusDietPositive(args.MaxPrice, 1000)
	}
	minProtein := state.Constraints.MinProtein
	if minProtein == nil {
		minProtein = sanitizeCampusDietPositive(args.MinProtein, 300)
	}
	maxFat := state.Constraints.MaxFat
	if maxFat == nil {
		maxFat = sanitizeCampusDietPositive(args.MaxFat, 300)
	}
	sortBy := strings.TrimSpace(state.Constraints.SortBy)
	if sortBy == "" {
		sortBy = strings.TrimSpace(args.SortBy)
	}
	if sortBy == "" {
		sortBy = campusDietAgentDefaultSort(state.Question, state.MealContext.UserGoal)
	}
	filter := domain.CampusDietSearchFilter{
		SchoolID: state.School.ID, CampusID: state.CampusID,
		Keyword: args.Keyword, CanteenName: args.CanteenName,
		MaxCalories: maxCalories, MinProtein: minProtein, MaxFat: maxFat, MaxPrice: maxPrice,
		TargetCalories: &target, SortBy: sortBy, Limit: args.Limit, Offset: args.Offset,
	}
	if state.Intent == "more" {
		filter.ExcludeSourceIDs = state.ExcludedSourceIDs
	} else if state.Intent == "refine" {
		filter.ExcludeSourceIDs = state.ActiveSourceIDs
	}
	candidates, total, err := s.repo.SearchCampusDietCandidates(ctx, filter)
	if err != nil {
		return nil, err
	}
	if state.Intent == "refine" && len(candidates) < campusDietAgentDefaultResultSize && len(state.ActiveSourceIDs) > 0 {
		refillFilter := filter
		refillFilter.ExcludeSourceIDs = nil
		refill, refillTotal, refillErr := s.repo.SearchCampusDietCandidates(ctx, refillFilter)
		if refillErr != nil {
			return nil, refillErr
		}
		candidates = mergeCampusDietCandidates(candidates, refill, args.Limit)
		total = refillTotal
	}
	state.Candidates = make(map[string]DietRecommendationCandidate, len(candidates))
	state.LastSearch = candidates
	state.SearchTotal = total
	state.Constraints.MaxCalories = maxCalories
	state.Constraints.MaxPrice = maxPrice
	state.Constraints.MinProtein = minProtein
	state.Constraints.MaxFat = maxFat
	state.Constraints.SortBy = sortBy
	if state.School.Name == "" && len(candidates) > 0 {
		state.School.Name = candidates[0].SchoolName
	}
	for _, candidate := range candidates {
		state.Candidates[candidate.SourceID] = candidate
	}
	return map[string]any{
		"school": state.School.Name, "total_matches": total,
		"returned": len(candidates), "candidates": campusDietAgentToolCandidates(candidates, false),
	}, nil
}

func mergeCampusDietCandidates(primary, refill []DietRecommendationCandidate, limit int) []DietRecommendationCandidate {
	if limit <= 0 || limit > campusDietAgentSearchLimit {
		limit = campusDietAgentSearchLimit
	}
	out := make([]DietRecommendationCandidate, 0, limit)
	seen := make(map[string]bool, limit)
	for _, group := range [][]DietRecommendationCandidate{primary, refill} {
		for _, candidate := range group {
			if candidate.SourceID == "" || seen[candidate.SourceID] {
				continue
			}
			seen[candidate.SourceID] = true
			out = append(out, candidate)
			if len(out) >= limit {
				return out
			}
		}
	}
	return out
}

func (s *StatsService) executeCampusDietDetailsTool(ctx context.Context, state *campusDietAgentRunState, rawArguments string, compare bool) (map[string]any, error) {
	var args struct {
		SourceIDs []string `json:"source_ids"`
	}
	if err := json.Unmarshal([]byte(defaultIfEmpty(rawArguments, "{}")), &args); err != nil {
		return nil, err
	}
	ids := normalizeDietRecommendationSourceIDs(args.SourceIDs)
	if len(ids) == 0 && state.ActiveResult != nil {
		ids = state.ActiveSourceIDs
	}
	if len(ids) > 10 {
		ids = ids[:10]
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("source_ids required")
	}
	if state.ActiveResult != nil && state.Intent != "initial" && state.Intent != "more" {
		allowed := make(map[string]bool, len(state.ActiveSourceIDs))
		for _, id := range state.ActiveSourceIDs {
			allowed[id] = true
		}
		for _, id := range ids {
			if !allowed[id] {
				return nil, fmt.Errorf("source_id is outside the active recommendation")
			}
		}
	}
	candidates, _, err := s.repo.SearchCampusDietCandidates(ctx, domain.CampusDietSearchFilter{
		SchoolID: state.School.ID, CampusID: state.CampusID, IncludeSourceIDs: ids, Limit: len(ids),
	})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]DietRecommendationCandidate, len(candidates))
	for _, candidate := range candidates {
		byID[candidate.SourceID] = candidate
		state.Candidates[candidate.SourceID] = candidate
	}
	if state.School.Name == "" && len(candidates) > 0 {
		state.School.Name = candidates[0].SchoolName
	}
	ordered := make([]DietRecommendationCandidate, 0, len(candidates))
	for _, id := range ids {
		if candidate, ok := byID[id]; ok {
			ordered = append(ordered, candidate)
		}
	}
	if compare {
		return map[string]any{"returned": len(ordered), "comparisons": campusDietAgentComparisons(ordered, state.MealContext)}, nil
	}
	return map[string]any{"returned": len(ordered), "foods": campusDietAgentToolCandidates(ordered, true)}, nil
}

func campusDietAgentToolCandidates(candidates []DietRecommendationCandidate, detailed bool) []map[string]any {
	out := make([]map[string]any, 0, len(candidates))
	for _, candidate := range candidates {
		item := map[string]any{
			"source_id": candidate.SourceID, "name": candidate.Title,
			"calories": candidate.Calories, "protein": candidate.Protein,
			"carbs": candidate.Carbs, "fat": candidate.Fat,
			"price": candidate.Price, "price_unit": candidate.PriceUnit,
			"canteen": candidate.CanteenName, "floor": candidate.Floor, "window": candidate.WindowName,
			"nutrition_basis": candidate.NutritionBasis,
		}
		if detailed {
			item["description"] = candidate.Description
			item["items"] = candidate.Items
			item["weight_method"] = candidate.WeightMethod
			item["weight_confidence"] = candidate.WeightConfidence
			item["uncertainty_level"] = candidate.UncertaintyLevel
		}
		out = append(out, item)
	}
	return out
}

func campusDietAgentComparisons(candidates []DietRecommendationCandidate, mealContext campusDietAgentMealContext) []map[string]any {
	target := campusDietAgentMealCalorieTarget(mealContext)
	lowestCalories := 0.0
	for index, candidate := range candidates {
		if index == 0 || candidate.Calories < lowestCalories {
			lowestCalories = candidate.Calories
		}
	}
	out := make([]map[string]any, 0, len(candidates))
	for _, candidate := range candidates {
		proteinDensity := candidate.Protein / math.Max(candidate.Calories, 1) * 100
		proteinPerYuan := 0.0
		if candidate.Price > 0 {
			proteinPerYuan = candidate.Protein / candidate.Price
		}
		score := 1000 - math.Abs(candidate.Calories-target)*1.2 + candidate.Protein*8 - candidate.Fat*2
		out = append(out, map[string]any{
			"source_id": candidate.SourceID, "name": candidate.Title,
			"calories":                       candidate.Calories,
			"calorie_delta_to_meal_target":   roundDietNumber(candidate.Calories - target),
			"calorie_difference_from_lowest": roundDietNumber(candidate.Calories - lowestCalories),
			"protein_per_100_kcal":           roundDietNumber(proteinDensity),
			"protein_per_yuan":               roundDietNumber(proteinPerYuan), "goal_match_score": roundDietNumber(score),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		return anyFloat(out[i]["goal_match_score"]) > anyFloat(out[j]["goal_match_score"])
	})
	return out
}

func (s *StatsService) campusDietAgentFallback(ctx context.Context, state *campusDietAgentRunState, reason string) *CampusDietAgentResult {
	logger.Warn(ctx, "校园餐Agent使用数据库兜底",
		logger.UserID(state.UserID), slog.String("agent_run_id", state.RunID),
		slog.String("reason", reason), slog.String("intent", state.Intent))
	fallbackCtx := ctx
	cancel := func() {}
	if ctx.Err() == context.DeadlineExceeded {
		fallbackCtx, cancel = context.WithTimeout(context.Background(), campusDietAgentFallbackTimeout)
	}
	defer cancel()
	if !state.MealContextLoaded {
		_, _ = s.executeCampusDietAgentTool(fallbackCtx, state, newCampusDietAgentToolCall("fallback-meal-context", "get_meal_context", "{}"))
	}
	if len(state.Candidates) == 0 {
		if state.ActiveResult != nil && len(state.ActiveSourceIDs) > 0 && !campusDietAgentIsSearchIntent(state.Intent) {
			arguments, _ := json.Marshal(map[string]any{"source_ids": state.ActiveSourceIDs})
			toolName := "get_campus_food_details"
			if state.Intent == "compare" {
				toolName = "compare_campus_foods"
			}
			_, _ = s.executeCampusDietAgentTool(fallbackCtx, state, newCampusDietAgentToolCall("fallback-details", toolName, string(arguments)))
		} else {
			arguments, _ := json.Marshal(map[string]any{
				"max_calories": state.Constraints.MaxCalories,
				"max_price":    state.Constraints.MaxPrice,
				"min_protein":  state.Constraints.MinProtein,
				"max_fat":      state.Constraints.MaxFat,
				"sort_by":      state.Constraints.SortBy,
				"limit":        campusDietAgentSearchLimit,
			})
			_, _ = s.executeCampusDietAgentTool(fallbackCtx, state, newCampusDietAgentToolCall("fallback-search", "search_campus_foods", string(arguments)))
		}
	}
	selections := make([]campusDietAgentFinalSelection, 0, campusDietAgentDefaultResultSize)
	selectionCandidates := state.LastSearch
	if state.ActiveResult != nil && !campusDietAgentIsSearchIntent(state.Intent) {
		selectionCandidates = candidatesForCampusDietIDs(state.ActiveSourceIDs, state.Candidates)
	}
	for _, candidate := range selectionCandidates {
		if len(selections) >= campusDietAgentDefaultResultSize {
			break
		}
		selections = append(selections, campusDietAgentFinalSelection{
			SourceID: candidate.SourceID,
			Reason:   "AI 解读暂不可用；这是按真实校园库营养条件筛出的候选。",
		})
	}
	result, err := buildCampusDietAgentResult(state, campusDietAgentFinal{Selections: selections}, false, reason)
	if err != nil {
		result = &CampusDietAgentResult{
			AgentRunID: state.RunID, Answer: "AI 解读暂不可用，校园库里暂时也没有找到符合当前条件的菜品。",
			Recommendation: DietRecommendationResult{
				Scene: "eat_out", Title: "暂时没有匹配菜品", Summary: "校园库没有返回可用候选。",
				Recommendations: []DietRecommendationOption{}, GeneratedBy: "campus_agent_database_fallback",
				ResolvedSchool: &state.School, CampusID: state.CampusID, CampusName: state.CampusName,
			},
			AgentUsed: false, FallbackReason: reason, ToolTrace: state.ToolTrace, ToolCount: state.ToolCount,
		}
	}
	return result
}

func buildCampusDietAgentResult(state *campusDietAgentRunState, final campusDietAgentFinal, agentUsed bool, fallbackReason string) (*CampusDietAgentResult, error) {
	selectedIDs := make([]string, 0, len(final.Selections))
	reasons := map[string]campusDietAgentFinalSelection{}
	for _, selection := range final.Selections {
		id := strings.TrimSpace(selection.SourceID)
		if id == "" {
			continue
		}
		if _, ok := state.Candidates[id]; !ok {
			return nil, fmt.Errorf("model selected unknown source_id")
		}
		if _, exists := reasons[id]; exists {
			continue
		}
		reasons[id] = selection
		selectedIDs = append(selectedIDs, id)
	}
	if len(selectedIDs) == 0 && state.ActiveResult != nil && !campusDietAgentIsSearchIntent(state.Intent) {
		for _, id := range state.ActiveSourceIDs {
			if _, ok := state.Candidates[id]; ok {
				selectedIDs = append(selectedIDs, id)
			}
		}
	}
	if state.ActiveResult != nil && !campusDietAgentIsSearchIntent(state.Intent) {
		selectedIDs = selectedIDs[:0]
		for _, id := range state.ActiveSourceIDs {
			if _, ok := state.Candidates[id]; ok {
				selectedIDs = append(selectedIDs, id)
			}
		}
	}
	if len(selectedIDs) == 0 {
		return nil, fmt.Errorf("no valid selections")
	}
	if campusDietAgentIsSearchIntent(state.Intent) {
		expected := campusDietAgentDefaultResultSize
		if len(state.LastSearch) < expected {
			expected = len(state.LastSearch)
		}
		if agentUsed && len(selectedIDs) != expected {
			return nil, fmt.Errorf("model returned %d/%d selections", len(selectedIDs), expected)
		}
	}
	if len(selectedIDs) > campusDietAgentDefaultResultSize {
		selectedIDs = selectedIDs[:campusDietAgentDefaultResultSize]
	}
	candidates := candidatesForCampusDietIDs(selectedIDs, state.Candidates)
	options := make([]DietRecommendationOption, 0, len(candidates))
	evidence := make([]CampusDietAgentEvidence, 0, len(candidates))
	for _, candidate := range candidates {
		selection := reasons[candidate.SourceID]
		selection.Reason = campusDietAgentQualitativeAnswer(selection.Reason)
		selection.Tip = campusDietAgentQualitativeAnswer(selection.Tip)
		option := campusDietRecommendationOption(candidate, selection.Reason, selection.Tip)
		options = append(options, option)
		evidence = append(evidence, CampusDietAgentEvidence{
			SourceID: candidate.SourceID, FoodName: candidate.Title,
			Calories: candidate.Calories, Protein: candidate.Protein, Carbs: candidate.Carbs, Fat: candidate.Fat,
			NutritionBasis: candidate.NutritionBasis, WeightMethod: candidate.WeightMethod,
			WeightConfidence: candidate.WeightConfidence, UncertaintyLevel: candidate.UncertaintyLevel,
		})
	}
	answer := campusDietAgentEvidenceBoundAnswer(state, candidates, reasons, agentUsed)
	exact := campusDietAgentExactAnswer(state.Intent, candidates)
	if exact != "" {
		answer = exact
		if !agentUsed {
			answer = "AI 解读暂不可用；" + answer
		}
	}
	if answer == "" {
		constraints := campusDietAgentConstraintLabel(state.Constraints)
		if agentUsed {
			answer = fmt.Sprintf("我调用校园餐工具核对了%s的真实菜品，下面这 %d 道更符合你这次的要求。", state.School.Name, len(options))
		} else {
			if constraints != "" {
				answer = fmt.Sprintf("AI 解读暂不可用；我仍按%s重新查询%s校园库，筛出 %d 道。", constraints, state.School.Name, len(options))
			} else {
				answer = fmt.Sprintf("AI 解读暂不可用；我先按%s校园库里的真实营养数据筛出 %d 道。", state.School.Name, len(options))
			}
		}
	}
	title := "校园餐 Agent 推荐"
	if state.Intent == "more" {
		title = "校园餐 Agent 换一批"
	} else if state.Intent == "refine" {
		title = "校园餐 Agent 按新条件筛选"
	} else if state.Intent != "initial" {
		title = "校园餐 Agent 核对结果"
	}
	generatedBy := campusDietAgentModel
	if !agentUsed {
		generatedBy = "campus_agent_database_fallback"
	}
	recommendation := DietRecommendationResult{
		Scene: "eat_out", Title: title, Summary: answer,
		CalorieRemaining: state.MealContext.Remaining.Calories,
		MacroGaps:        state.MealContext.Remaining, Recommendations: options,
		GeneratedBy: generatedBy, ResolvedSchool: &state.School,
		CampusID: state.CampusID, CampusName: state.CampusName,
		AIUsed: agentUsed, CandidateCount: int(state.SearchTotal), AIRerankCount: len(state.Candidates),
		AgentConstraints: &state.Constraints,
	}
	return &CampusDietAgentResult{
		AgentRunID: state.RunID, Answer: answer, Recommendation: recommendation,
		Evidence: evidence, ToolTrace: state.ToolTrace, AgentUsed: agentUsed,
		ToolCount: state.ToolCount, FallbackReason: fallbackReason,
	}, nil
}

func newCampusDietAgentToolCall(id, name, arguments string) campusDietAgentToolCall {
	call := campusDietAgentToolCall{ID: id, Type: "function"}
	call.Function.Name = name
	call.Function.Arguments = arguments
	return call
}

func campusDietAgentEvidenceBoundAnswer(state *campusDietAgentRunState, candidates []DietRecommendationCandidate, reasons map[string]campusDietAgentFinalSelection, agentUsed bool) string {
	if !agentUsed {
		return ""
	}
	switch state.Intent {
	case "explain":
		parts := make([]string, 0, len(candidates))
		for _, candidate := range candidates {
			reason := campusDietAgentQualitativeAnswer(reasons[candidate.SourceID].Reason)
			if reason == "" {
				reason = "营养结构更接近你这次的目标"
			}
			parts = append(parts, candidate.Title+"："+reason)
		}
		return "我调用详情工具逐个核对后，推荐逻辑是：\n" + strings.Join(parts, "；") + "。"
	case "compare":
		if len(candidates) == 0 {
			return ""
		}
		best := candidates[0]
		bestScore := campusDietAgentGoalMatchScore(best, state.MealContext)
		for _, candidate := range candidates[1:] {
			if score := campusDietAgentGoalMatchScore(candidate, state.MealContext); score > bestScore {
				best = candidate
				bestScore = score
			}
		}
		return fmt.Sprintf("我调用比较工具按热量、蛋白质密度和本餐目标重新计算后，%s在这批菜里更匹配当前目标；具体库内数值以卡片为准。", best.Title)
	case "more":
		constraints := campusDietAgentConstraintLabel(state.Constraints)
		if constraints != "" {
			return fmt.Sprintf("我保持%s，并排除本次对话里出现过的菜，再从%s核对出 %d 道新选择。", constraints, state.School.Name, len(candidates))
		}
		return fmt.Sprintf("我已经排除本次对话里出现过的菜，再调用校园餐工具从%s核对出 %d 道新选择。", state.School.Name, len(candidates))
	case "refine":
		constraints := campusDietAgentConstraintLabel(state.Constraints)
		if constraints != "" {
			return fmt.Sprintf("我已按%s重新查询%s校园库，并核对出 %d 道。", constraints, state.School.Name, len(candidates))
		}
		return fmt.Sprintf("我已把你刚补充的条件合并进去，重新查询%s校园库并核对出 %d 道。", state.School.Name, len(candidates))
	default:
		return fmt.Sprintf("我调用了今日目标和校园菜品工具，从%s真实校园库中核对出 %d 道更符合这次要求的菜。", state.School.Name, len(candidates))
	}
}

func campusDietAgentConstraintLabel(constraints CampusDietRecommendationConstraints) string {
	parts := make([]string, 0, 4)
	if constraints.MaxPrice != nil {
		parts = append(parts, formatCampusDietNumber(*constraints.MaxPrice)+" 元以内")
	}
	if constraints.MaxCalories != nil {
		parts = append(parts, formatCampusDietNumber(*constraints.MaxCalories)+" kcal 以内")
	}
	switch constraints.Goal {
	case "muscle_gain":
		parts = append(parts, "增肌优先")
	case "fat_loss":
		parts = append(parts, "减脂优先")
	case "maintain":
		parts = append(parts, "维持目标")
	}
	return strings.Join(parts, "、")
}

func campusDietAgentGoalMatchScore(candidate DietRecommendationCandidate, mealContext campusDietAgentMealContext) float64 {
	target := campusDietAgentMealCalorieTarget(mealContext)
	return 1000 - math.Abs(candidate.Calories-target)*1.2 + candidate.Protein*8 - candidate.Fat*2
}

func (s *StatsService) buildCampusDietAgentMealContext(ctx context.Context, userID, question string) campusDietAgentMealContext {
	now := time.Now().In(chinaTZ)
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaTZ)
	records, _ := s.repo.GetFoodRecordsForDateRange(ctx, userID, start.UTC(), start.Add(24*time.Hour).UTC())
	profile, _ := s.repo.GetUserProfile(ctx, userID)
	context := campusDietAgentMealContext{Date: now.Format("2006-01-02"), MealType: inferCampusDietMealType(question, now)}
	for _, record := range records {
		context.Current.Calories += record.TotalCalories
		context.Current.Protein += record.TotalProtein
		context.Current.Carbs += record.TotalCarbs
		context.Current.Fat += record.TotalFat
	}
	context.CalorieTarget = 2000
	proteinTarget, carbsTarget, fatTarget := 100.0, 240.0, 60.0
	if profile != nil {
		if profile.TDEE != nil && *profile.TDEE > 0 {
			context.CalorieTarget = *profile.TDEE
		}
		if profile.DietGoal != nil {
			context.UserGoal = strings.TrimSpace(*profile.DietGoal)
		}
		health := profile.HealthCondition
		if targets := mapFromAny(health["dashboard_targets"]); len(targets) > 0 {
			context.CalorieTarget = positiveMapFloat(targets, []string{"calorie_target", "calories"}, context.CalorieTarget)
			proteinTarget = positiveMapFloat(targets, []string{"protein_target", "protein"}, proteinTarget)
			carbsTarget = positiveMapFloat(targets, []string{"carbs_target", "carbs"}, carbsTarget)
			fatTarget = positiveMapFloat(targets, []string{"fat_target", "fat"}, fatTarget)
		}
		context.Allergies = stringSliceFromCampusDietAny(health["allergies"])
		context.DietPreferences = stringSliceFromCampusDietAny(health["diet_preference"])
	}
	context.UserGoal = explicitCampusDietGoal(question, context.UserGoal)
	context.Remaining = DietRecommendationMacro{
		Calories: roundDietNumber(math.Max(0, context.CalorieTarget-context.Current.Calories)),
		Protein:  roundDietNumber(math.Max(0, proteinTarget-context.Current.Protein)),
		Carbs:    roundDietNumber(math.Max(0, carbsTarget-context.Current.Carbs)),
		Fat:      roundDietNumber(math.Max(0, fatTarget-context.Current.Fat)),
	}
	return context
}

func (s *StatsService) chargeCampusDietAgent(ctx context.Context, userID, sessionID string, result *CampusDietAgentResult) (int, string, *billing.PricingResult) {
	if result == nil || !result.AgentUsed {
		return 0, "free_database_fallback", nil
	}
	pricing := billing.PriceTokenUsage(billing.PricingInput{Model: campusDietAgentModel, Usage: result.Usage}, s.aiUsagePricingConfig())
	pricing.CreditsCharged = creditCostDietRecommendation
	pricing.UncappedCreditsCharged = creditCostDietRecommendation
	if s.creditGuard == nil || strings.TrimSpace(userID) == "" {
		return creditCostDietRecommendation, "campus_agent_unmetered", &pricing
	}
	creditsInfo, err := s.creditGuard.ValidateDietRecommendationCredits(ctx, userID)
	if err != nil {
		logger.Warn(ctx, "校园餐Agent积分校验失败", logger.UserID(userID), slog.String("session_id", sessionID), logger.Err(err))
		return 0, "credit_validation_failed", &pricing
	}
	sourceKey := fmt.Sprintf("campus_diet_agent:%s:%s", sessionID, result.AgentRunID)
	if err := s.creditGuard.ConsumeEarnedCreditsAfterSuccess(ctx, userID, creditsInfo, creditCostDietRecommendation, "campus_diet_agent_spend", sourceKey, map[string]any{
		"session_id": sessionID, "agent_run_id": result.AgentRunID,
		"tool_count": result.ToolCount, "model": campusDietAgentModel,
	}); err != nil {
		logger.Warn(ctx, "校园餐Agent积分扣减失败", logger.UserID(userID), slog.String("session_id", sessionID), logger.Err(err))
	}
	return creditCostDietRecommendation, "campus_agent_fixed_credit", &pricing
}

func (s *StatsService) persistCampusDietAgentExchange(ctx context.Context, userID, sessionID, statsRange, question string, result *CampusDietAgentResult, creditsCharged int, actualPricing *billing.PricingResult, billingStatus string) (string, string) {
	userMessage, err := s.repo.AddPetChatMessage(ctx, domain.PetChatMessage{
		SessionID: sessionID, UserID: userID, Role: "user", Content: question,
		MessageType: "question", RangeType: statsRange,
		Meta: map[string]any{"intent": "campus_diet_agent", "agent_run_id": result.AgentRunID},
	})
	if err != nil {
		return "", ""
	}
	storedRecommendation := result.Recommendation
	storedRecommendation.SessionID = ""
	storedRecommendation.UserMessageID = ""
	storedRecommendation.AssistantMessageID = ""
	meta := map[string]any{
		"diet_recommendation": storedRecommendation,
		"agent_run": map[string]any{
			"agent_run_id": result.AgentRunID, "agent_used": result.AgentUsed,
			"tool_count": result.ToolCount, "tool_trace": result.ToolTrace,
			"evidence": result.Evidence, "fallback_reason": result.FallbackReason,
			"billing_status": billingStatus,
		},
	}
	if actualPricing != nil {
		meta["ai_usage_pricing"] = actualPricing
	}
	assistantMessage, err := s.repo.AddPetChatMessage(ctx, domain.PetChatMessage{
		SessionID: sessionID, UserID: userID, Role: "assistant", Content: result.Answer,
		MessageType: "diet_recommendation", RangeType: statsRange,
		CreditsCharged: creditsCharged, Meta: meta,
	})
	if err != nil {
		return userMessage.ID, ""
	}
	_ = s.repo.TouchPetChatSession(ctx, sessionID, userID, question, result.Answer, creditsCharged)
	return userMessage.ID, assistantMessage.ID
}

func newPetChatDoneChunk(sessionID, userMessageID, assistantMessageID string, comp *statsComputation, creditsCharged int, billingStatus string, actualPricing *billing.PricingResult, estimatedPricing billing.PricingResult) PetChatStreamChunk {
	return PetChatStreamChunk{
		Type: "done",
		Meta: &PetChatStreamMeta{
			SessionID: sessionID, UserMessageID: userMessageID, AssistantMessageID: assistantMessageID,
			Range: comp.StatsRange, RangeLabel: statsRangeLabel(comp.StatsRange), RecordedDays: comp.RecordedDays,
			CreditsCharged: creditsCharged, BillingStatus: billingStatus,
			AIUsagePricing: actualPricing, EstimatedPricing: estimatedPricing,
		},
	}
}

func (s *StatsService) campusDietAgentEstimatedPricing() billing.PricingResult {
	pricing := billing.PriceTokenUsage(billing.PricingInput{Model: campusDietAgentModel, Usage: billing.TokenUsage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2}}, s.aiUsagePricingConfig())
	pricing.CreditsCharged = creditCostDietRecommendation
	pricing.UncappedCreditsCharged = creditCostDietRecommendation
	return pricing
}

func (state *campusDietAgentRunState) emitProgress(label, toolName, status string, resultCount int) {
	state.ProgressStep++
	if state.Progress != nil {
		state.Progress(CampusDietAgentProgress{AgentRunID: state.RunID, Step: state.ProgressStep, Label: label, ToolName: toolName, Status: status, ResultCount: resultCount})
	}
}

func (state *campusDietAgentRunState) recordTool(name, status string, resultCount int, durationMS int64) {
	state.ToolCount++
	state.ToolTrace = append(state.ToolTrace, CampusDietAgentToolTrace{ToolName: name, Status: status, ResultCount: resultCount, DurationMS: durationMS})
}

func campusDietAgentProgressLabel(toolName string, done bool) string {
	switch toolName {
	case "get_meal_context":
		if done {
			return "已读取今天的饮食目标"
		}
		return "正在读取今天的饮食目标"
	case "search_campus_foods":
		if done {
			return "已完成校园菜品检索"
		}
		return "正在搜索真实校园菜品"
	case "get_campus_food_details":
		if done {
			return "已核对菜品热量和位置"
		}
		return "正在核对菜品详情"
	case "compare_campus_foods":
		if done {
			return "已完成营养比较"
		}
		return "正在比较菜品营养"
	default:
		return "正在查询校园餐数据"
	}
}

func campusDietAgentOutputCount(output map[string]any) int {
	if output == nil {
		return 0
	}
	for _, key := range []string{"returned", "total_matches"} {
		if value, ok := output[key]; ok {
			return int(anyFloat(value))
		}
	}
	return 1
}

func recommendationSourceIDsFromResult(result *DietRecommendationResult) []string {
	if result == nil {
		return nil
	}
	ids := make([]string, 0, len(result.Recommendations))
	for _, option := range result.Recommendations {
		if id := strings.TrimSpace(option.SourceID); id != "" {
			ids = append(ids, id)
		}
	}
	return normalizeDietRecommendationSourceIDs(ids)
}

func candidatesForCampusDietIDs(ids []string, candidates map[string]DietRecommendationCandidate) []DietRecommendationCandidate {
	out := make([]DietRecommendationCandidate, 0, len(ids))
	for _, id := range ids {
		if candidate, ok := candidates[id]; ok {
			out = append(out, candidate)
		}
	}
	return out
}

func campusDietAgentExactAnswer(intent string, candidates []DietRecommendationCandidate) string {
	parts := make([]string, 0, len(candidates))
	switch intent {
	case "facts":
		for _, candidate := range candidates {
			basis := "库内记录"
			if candidate.NutritionBasis == "library_estimate" {
				basis = "库内估算"
			}
			amount := ""
			if len(candidate.Items) > 0 {
				amount = strings.TrimSpace(candidate.Items[0].Amount)
			}
			suffix := ""
			if amount != "" {
				suffix = "，份量" + amount
			}
			parts = append(parts, fmt.Sprintf("%s：%s约 %s kcal%s", candidate.Title, basis, formatCampusDietNumber(candidate.Calories), suffix))
		}
		if len(parts) > 0 {
			return "我刚刚调用菜品详情工具核对了库内数值：\n" + strings.Join(parts, "；") + "。"
		}
	case "location":
		for _, candidate := range candidates {
			location := strings.Join(compactDietStrings(candidate.CanteenName, candidate.Floor, candidate.WindowName), " · ")
			parts = append(parts, candidate.Title+"："+defaultIfEmpty(location, "校园库暂未记录具体窗口"))
		}
		if len(parts) > 0 {
			return "我重新查询了这批菜的位置：\n" + strings.Join(parts, "；") + "。"
		}
	}
	return ""
}

func campusDietAgentQualitativeAnswer(answer string) string {
	segments := strings.FieldsFunc(answer, func(r rune) bool { return r == '。' || r == '；' || r == '\n' })
	kept := make([]string, 0, len(segments))
	for _, segment := range segments {
		segment = strings.TrimSpace(segment)
		if segment == "" || campusDietAgentDigitPattern.MatchString(segment) || campusDietAgentChineseNumericClaimPattern.MatchString(segment) {
			continue
		}
		kept = append(kept, segment)
		if len(kept) >= 2 {
			break
		}
	}
	return strings.Join(kept, "。")
}

func formatCampusDietNumber(value float64) string {
	if math.Abs(value-math.Round(value)) < 0.05 {
		return strconv.Itoa(int(math.Round(value)))
	}
	return strconv.FormatFloat(math.Round(value*10)/10, 'f', 1, 64)
}

func inferCampusDietMealType(question string, now time.Time) string {
	if regexp.MustCompile(`早餐|早饭|早上`).MatchString(question) {
		return "breakfast"
	}
	if regexp.MustCompile(`午餐|午饭|中午`).MatchString(question) {
		return "lunch"
	}
	if regexp.MustCompile(`晚餐|晚饭|晚上|夜宵`).MatchString(question) {
		return "dinner"
	}
	minute := now.Hour()*60 + now.Minute()
	if minute < 10*60+30 {
		return "breakfast"
	}
	if minute < 15*60 {
		return "lunch"
	}
	return "dinner"
}

func campusDietAgentMealCalorieTarget(context campusDietAgentMealContext) float64 {
	ratio := 0.3
	if context.MealType == "breakfast" {
		ratio = 0.25
	}
	if context.MealType == "lunch" {
		ratio = 0.35
	}
	target := context.CalorieTarget * ratio
	if target <= 0 {
		target = 500
	}
	if context.Remaining.Calories > 0 && target > context.Remaining.Calories {
		target = context.Remaining.Calories
	}
	return roundDietNumber(target)
}

func campusDietAgentExplicitCalorieLimit(question string) *float64 {
	match := campusDietAgentCaloriePattern.FindStringSubmatch(question)
	if len(match) < 2 {
		match = campusDietAgentBareCaloriePattern.FindStringSubmatch(question)
	}
	if len(match) < 2 {
		return nil
	}
	value, err := strconv.ParseFloat(match[1], 64)
	if err != nil || value <= 0 || value > 3000 {
		return nil
	}
	return &value
}

func campusDietAgentExplicitPriceLimit(question string) *float64 {
	match := campusDietAgentPricePattern.FindStringSubmatch(question)
	if len(match) < 2 {
		match = campusDietAgentBudgetPattern.FindStringSubmatch(question)
	}
	if len(match) < 2 {
		return nil
	}
	value, err := strconv.ParseFloat(match[1], 64)
	if err != nil || value <= 0 || value > 1000 {
		return nil
	}
	return &value
}

func campusDietAgentDefaultCalorieLimit(context campusDietAgentMealContext) *float64 {
	target := campusDietAgentMealCalorieTarget(context)
	limit := math.Max(target*1.35, target+150)
	limit = math.Min(limit, 1200)
	if context.Remaining.Calories > 0 {
		limit = math.Min(limit, context.Remaining.Calories)
	}
	limit = roundDietNumber(limit)
	return &limit
}

func campusDietAgentDefaultSort(question, goal string) string {
	questionContext := strings.ToLower(question)
	if strings.Contains(questionContext, "便宜") || strings.Contains(questionContext, "价格") || strings.Contains(questionContext, "太贵") || strings.Contains(questionContext, "预算") {
		return "lowest_price"
	}
	if strings.Contains(questionContext, "减脂") || strings.Contains(questionContext, "减肥") || strings.Contains(questionContext, "高蛋白") {
		return "protein_density"
	}
	if strings.Contains(questionContext, "增肌") || strings.Contains(questionContext, "补蛋白") {
		return "highest_protein"
	}
	goalContext := strings.ToLower(goal)
	if strings.Contains(goalContext, "fat_loss") || strings.Contains(goalContext, "减脂") {
		return "protein_density"
	}
	if strings.Contains(goalContext, "muscle_gain") || strings.Contains(goalContext, "增肌") {
		return "highest_protein"
	}
	return "best_match"
}

func campusDietAgentExplicitGoal(question string) string {
	if strings.Contains(question, "增肌") {
		return "muscle_gain"
	}
	if strings.Contains(question, "减脂") || strings.Contains(question, "减肥") {
		return "fat_loss"
	}
	if strings.Contains(question, "维持") || strings.Contains(question, "保持") {
		return "maintain"
	}
	return ""
}

func sanitizeCampusDietPositive(value *float64, max float64) *float64 {
	if value == nil || *value <= 0 || *value > max {
		return nil
	}
	copyValue := *value
	return &copyValue
}

func explicitCampusDietGoal(question, fallback string) string {
	if goal := campusDietAgentExplicitGoal(question); goal != "" {
		return goal
	}
	return fallback
}

func stringSliceFromCampusDietAny(value any) []string {
	values, ok := value.([]any)
	if !ok {
		if stringsValue, ok := value.([]string); ok {
			return stringsValue
		}
		return nil
	}
	out := make([]string, 0, len(values))
	for _, item := range values {
		text := strings.TrimSpace(fmt.Sprintf("%v", item))
		if text != "" && text != "<nil>" {
			out = append(out, text)
		}
	}
	return out
}

func positiveMapFloat(values map[string]any, keys []string, fallback float64) float64 {
	for _, key := range keys {
		if value := anyFloat(values[key]); value > 0 {
			return value
		}
	}
	return fallback
}

func anyFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

func addCampusDietAgentUsage(left, right billing.TokenUsage) billing.TokenUsage {
	return billing.TokenUsage{
		InputTokens:          left.InputTokens + right.InputTokens,
		OutputTokens:         left.OutputTokens + right.OutputTokens,
		TotalTokens:          left.TotalTokens + right.TotalTokens,
		CachedInputTokens:    left.CachedInputTokens + right.CachedInputTokens,
		CacheMissInputTokens: left.CacheMissInputTokens + right.CacheMissInputTokens,
	}
}
