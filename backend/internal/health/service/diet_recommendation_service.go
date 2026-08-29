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
	"strings"
	"time"

	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/logger"

	"log/slog"
)

type DietRecommendationInput struct {
	Scene                string                   `json:"scene"`
	Date                 string                   `json:"date"`
	Question             string                   `json:"question,omitempty"`
	MealType             string                   `json:"meal_type,omitempty"`
	SchoolID             string                   `json:"school_id,omitempty"`
	SchoolName           string                   `json:"school_name,omitempty"`
	CampusID             string                   `json:"campus_id,omitempty"`
	CampusName           string                   `json:"campus_name,omitempty"`
	SessionID            string                   `json:"session_id,omitempty"`
	NewSession           bool                     `json:"new_session,omitempty"`
	FollowUpIntent       string                   `json:"follow_up_intent,omitempty"`
	RecommendedSourceIDs []string                 `json:"recommended_source_ids,omitempty"`
	CalorieRemaining     float64                  `json:"calorie_remaining"`
	MacroGaps            DietRecommendationMacro  `json:"macro_gaps"`
	Targets              DietRecommendationMacro  `json:"targets"`
	Current              DietRecommendationMacro  `json:"current"`
	Meals                []DietRecommendationMeal `json:"meals"`
	UserGoal             string                   `json:"user_goal"`
	PreferenceContext    string                   `json:"preference_context"`
}

type DietRecommendationCandidate = domain.DietRecommendationCandidate

type DietRecommendationMacro struct {
	Calories float64 `json:"calories"`
	Protein  float64 `json:"protein"`
	Carbs    float64 `json:"carbs"`
	Fat      float64 `json:"fat"`
}

type DietRecommendationMeal struct {
	Type        string  `json:"type"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Calories    float64 `json:"calories"`
	Protein     float64 `json:"protein"`
	Carbs       float64 `json:"carbs"`
	Fat         float64 `json:"fat"`
}

type DietRecommendationResult struct {
	Scene              string                               `json:"scene"`
	Title              string                               `json:"title"`
	Summary            string                               `json:"summary"`
	CalorieRemaining   float64                              `json:"calorie_remaining"`
	MacroGaps          DietRecommendationMacro              `json:"macro_gaps"`
	Recommendations    []DietRecommendationOption           `json:"recommendations"`
	GeneratedBy        string                               `json:"generated_by"`
	ResolvedSchool     *domain.DietRecommendationSchool     `json:"resolved_school,omitempty"`
	CampusID           string                               `json:"campus_id,omitempty"`
	CampusName         string                               `json:"campus_name,omitempty"`
	AIUsed             bool                                 `json:"ai_used"`
	CandidateCount     int                                  `json:"candidate_count,omitempty"`
	AIRerankCount      int                                  `json:"ai_rerank_count,omitempty"`
	SessionID          string                               `json:"session_id,omitempty"`
	UserMessageID      string                               `json:"user_message_id,omitempty"`
	AssistantMessageID string                               `json:"assistant_message_id,omitempty"`
	AgentConstraints   *CampusDietRecommendationConstraints `json:"agent_constraints,omitempty"`
}

type CampusDietRecommendationConstraints struct {
	Goal        string   `json:"goal,omitempty"`
	MaxCalories *float64 `json:"max_calories,omitempty"`
	MaxPrice    *float64 `json:"max_price,omitempty"`
	MinProtein  *float64 `json:"min_protein,omitempty"`
	MaxFat      *float64 `json:"max_fat,omitempty"`
	SortBy      string   `json:"sort_by,omitempty"`
}

type DietRecommendationOption struct {
	Title                   string                       `json:"title"`
	Reason                  string                       `json:"reason"`
	Source                  string                       `json:"source,omitempty"`
	SourceID                string                       `json:"source_id,omitempty"`
	Calories                float64                      `json:"calories"`
	Protein                 float64                      `json:"protein"`
	Carbs                   float64                      `json:"carbs"`
	Fat                     float64                      `json:"fat"`
	Items                   []DietRecommendationFoodItem `json:"items"`
	Tips                    []string                     `json:"tips"`
	Alternatives            []string                     `json:"alternatives"`
	IsCampusFood            bool                         `json:"is_campus_food,omitempty"`
	SchoolID                string                       `json:"school_id,omitempty"`
	SchoolName              string                       `json:"school_name,omitempty"`
	CampusID                string                       `json:"campus_id,omitempty"`
	CampusName              string                       `json:"campus_name,omitempty"`
	CanteenID               string                       `json:"canteen_id,omitempty"`
	CanteenName             string                       `json:"canteen_name,omitempty"`
	WindowID                string                       `json:"window_id,omitempty"`
	WindowName              string                       `json:"window_name,omitempty"`
	Floor                   string                       `json:"floor,omitempty"`
	Price                   float64                      `json:"price,omitempty"`
	PriceUnit               string                       `json:"price_unit,omitempty"`
	ImagePath               string                       `json:"image_path,omitempty"`
	NutritionBasis          string                       `json:"nutrition_basis,omitempty"`
	NutritionSourceCategory string                       `json:"nutrition_source_category,omitempty"`
	WeightMethod            string                       `json:"weight_method,omitempty"`
	WeightConfidence        float64                      `json:"weight_confidence,omitempty"`
	UncertaintyLevel        string                       `json:"uncertainty_level,omitempty"`
}

type DietRecommendationFoodItem = domain.DietRecommendationFoodItem

var dietRecommendationFenceRe = regexp.MustCompile("(?s)```json?\\s*\\n?|```")

const creditCostDietRecommendation = 1

const (
	campusDietRecommendationPoolLimit      = 3000
	campusDietRecommendationAIRerankLimit  = 60
	campusDietRecommendationSelectionLimit = 3
)

type campusDietRecommendationAISelection struct {
	SourceID string `json:"source_id"`
	Reason   string `json:"reason"`
	Tip      string `json:"tip"`
}

type campusDietRecommendationAIResponse struct {
	Summary    string                                `json:"summary"`
	Selections []campusDietRecommendationAISelection `json:"selections"`
}

// 饮食推荐必须在小程序请求超时前返回。AI 只是改善文案和组合的可选项，
// 不能让它的瞬时网络波动阻塞本地候选和规则兜底结果。
var dietRecommendationTimeout = 12 * time.Second

func (s *StatsService) GenerateDietRecommendation(ctx context.Context, userID string, input DietRecommendationInput) (*DietRecommendationResult, error) {
	input = normalizeDietRecommendationInput(input)
	var creditsInfo map[string]any
	var err error
	if s.creditGuard != nil && userID != "" {
		creditsInfo, err = s.creditGuard.ValidateDietRecommendationCredits(ctx, userID)
		if err != nil {
			return nil, err
		}
	}

	result, err := s.generateDietRecommendationCore(ctx, userID, input)
	if err != nil {
		return nil, err
	}

	if s.creditGuard != nil && creditsInfo != nil {
		_ = s.creditGuard.ConsumeEarnedCreditsAfterSuccess(ctx, userID, creditsInfo, creditCostDietRecommendation, "diet_recommendation_spend", "diet_rec:"+input.Date+":"+input.Scene, map[string]any{
			"date":  input.Date,
			"scene": input.Scene,
		})
	}
	if input.Question != "" && userID != "" {
		s.persistDietRecommendationExchange(ctx, userID, input, result)
	}

	return result, nil
}

func (s *StatsService) persistDietRecommendationExchange(ctx context.Context, userID string, input DietRecommendationInput, result *DietRecommendationResult) {
	if s.repo == nil || result == nil {
		return
	}
	var session *domain.PetChatSession
	var err error
	if input.SessionID != "" && !input.NewSession {
		session, err = s.repo.GetPetChatSession(ctx, userID, input.SessionID)
	}
	if session == nil || err != nil {
		session, err = s.repo.CreatePetChatSession(ctx, domain.PetChatSession{
			UserID:           userID,
			Title:            trimStatsRunes(input.Question, 28),
			RangeType:        "week",
			Status:           "active",
			ContextStartDate: input.Date,
			ContextEndDate:   input.Date,
			LastQuestion:     input.Question,
			LastAnswer:       dietRecommendationAnswerText(result),
			LastMessageAt:    nil,
			Meta: map[string]any{
				"source":    "diet_recommendation",
				"meal_type": input.MealType,
			},
		})
	}
	if err != nil || session == nil {
		logger.Warn(ctx, "创建饮食推荐宠物会话失败",
			logger.UserID(userID),
			logger.Err(err),
		)
		return
	}
	result.SessionID = session.ID
	userMessage, err := s.repo.AddPetChatMessage(ctx, domain.PetChatMessage{
		SessionID:   session.ID,
		UserID:      userID,
		Role:        "user",
		Content:     input.Question,
		MessageType: "question",
		RangeType:   "week",
		Meta: map[string]any{
			"intent":    "diet_recommendation",
			"meal_type": input.MealType,
		},
	})
	if err != nil {
		logger.Warn(ctx, "保存饮食推荐用户消息失败",
			logger.UserID(userID),
			slog.String("session_id", session.ID),
			logger.Err(err),
		)
		return
	}
	result.UserMessageID = userMessage.ID
	answer := dietRecommendationAnswerText(result)
	storedResult := *result
	storedResult.UserMessageID = ""
	storedResult.AssistantMessageID = ""
	assistantMessage, err := s.repo.AddPetChatMessage(ctx, domain.PetChatMessage{
		SessionID:      session.ID,
		UserID:         userID,
		Role:           "assistant",
		Content:        answer,
		MessageType:    "diet_recommendation",
		RangeType:      "week",
		CreditsCharged: creditCostDietRecommendation,
		Meta: map[string]any{
			"diet_recommendation": storedResult,
		},
	})
	if err != nil {
		logger.Warn(ctx, "保存饮食推荐回复消息失败",
			logger.UserID(userID),
			slog.String("session_id", session.ID),
			logger.Err(err),
		)
		return
	}
	result.AssistantMessageID = assistantMessage.ID
	if err := s.repo.TouchPetChatSession(ctx, session.ID, userID, input.Question, answer, creditCostDietRecommendation); err != nil {
		logger.Warn(ctx, "更新饮食推荐宠物会话失败",
			logger.UserID(userID),
			slog.String("session_id", session.ID),
			logger.Err(err),
		)
	}
}

func dietRecommendationAnswerText(result *DietRecommendationResult) string {
	if result == nil {
		return "我暂时没有找到合适的餐食。"
	}
	parts := make([]string, 0, len(result.Recommendations))
	for i, option := range result.Recommendations {
		if i >= 3 {
			break
		}
		parts = append(parts, option.Title)
	}
	if len(parts) == 0 {
		return strings.TrimSpace(result.Summary)
	}
	prefix := fmt.Sprintf("我按你今天的营养目标筛了 %d 个选择", len(parts))
	if result.ResolvedSchool != nil {
		if result.AIUsed {
			prefix = fmt.Sprintf("我检索了%s的 %d 道真实食堂菜，并让 AI 比较了其中 %d 道相关候选", result.ResolvedSchool.Name, result.CandidateCount, result.AIRerankCount)
		} else {
			prefix = fmt.Sprintf("我从%s的真实食堂菜品里筛了 %d 个选择", result.ResolvedSchool.Name, len(parts))
		}
	}
	return prefix + "：" + strings.Join(parts, "、") + "。点卡片可以看菜品详情。"
}

func (s *StatsService) generateDietRecommendationCore(ctx context.Context, userID string, input DietRecommendationInput) (*DietRecommendationResult, error) {
	ctx, cancel := context.WithTimeout(ctx, dietRecommendationTimeout)
	defer cancel()

	input = normalizeDietRecommendationInput(input)
	resolvedSchool, resolvedCampusID, resolvedCampusName := s.resolveDietRecommendationSchool(ctx, userID, input)
	if resolvedSchool != nil {
		input.SchoolID = resolvedSchool.ID
		input.SchoolName = resolvedSchool.Name
		if input.CampusID == "" {
			input.CampusID = resolvedCampusID
			input.CampusName = resolvedCampusName
		}
	}
	llm := s.preferredTextLLM()
	apiKey := llm.APIKey
	candidates := s.fetchDietRecommendationCandidates(ctx, userID, input)
	if resolvedSchool != nil && len(candidates) == 0 && input.CampusID != "" {
		input.CampusID = ""
		input.CampusName = ""
		candidates = s.fetchDietRecommendationCandidates(ctx, userID, input)
	}
	if resolvedSchool != nil && len(candidates) > 0 {
		if input.FollowUpIntent != "location" && input.FollowUpIntent != "context" && apiKey != "" {
			result, err := s.generateCampusDietRecommendationWithAI(ctx, userID, input, *resolvedSchool, llm, candidates)
			if err == nil && result != nil && len(result.Recommendations) > 0 {
				return result, nil
			}
			logger.Warn(ctx, "校园饮食推荐大模型重排失败，使用真实菜品规则兜底",
				logger.UserID(userID),
				slog.String("school_id", resolvedSchool.ID),
				slog.String("school_name", resolvedSchool.Name),
				slog.String("model", llm.Model),
				slog.Int("candidate_count", len(candidates)),
				logger.Err(err),
			)
		}
		result := fallbackDietRecommendationFromCandidates(input, "campus_database", candidates)
		result.ResolvedSchool = resolvedSchool
		result.CampusID = input.CampusID
		result.CampusName = input.CampusName
		result.AIUsed = false
		result.CandidateCount = len(candidates)
		switch input.FollowUpIntent {
		case "more":
			result.Title = "再换一批校园菜品"
			result.Summary = "已排除这次会话里刚推荐过的菜品，继续从真实校园食物库筛选。"
		case "location", "context":
			result.Title = "刚才这些菜在这里"
			result.Summary = "下面仍是上一轮的真实菜品，食堂、楼层和窗口以卡片位置为准。"
		case "compare":
			result.Title = "重新比较刚才的选择"
			result.Summary = "只在上一轮真实菜品中，按你今天这餐的营养缺口重新排序。"
		}
		if len(result.Recommendations) > 3 {
			result.Recommendations = result.Recommendations[:3]
		}
		logger.Info(ctx, "校园饮食推荐生成完成",
			logger.UserID(userID),
			slog.String("school_id", resolvedSchool.ID),
			slog.String("school_name", resolvedSchool.Name),
			slog.Int("candidate_count", len(candidates)),
			slog.Bool("ai_used", false),
		)
		return result, nil
	}
	if resolvedSchool != nil {
		if input.FollowUpIntent != "" && len(input.RecommendedSourceIDs) > 0 {
			summary := "上一轮菜品可能已下架或暂时不可用，没有用模型补写不存在的菜名。"
			if input.FollowUpIntent == "more" {
				summary = "这次会话里还没有更多未推荐过的真实校园菜品，我没有重复上一批，也没有用模型编造新菜。"
			}
			return &DietRecommendationResult{
				Scene:            input.Scene,
				Title:            "暂时没有更多真实校园菜品",
				Summary:          summary,
				CalorieRemaining: input.CalorieRemaining,
				MacroGaps:        input.MacroGaps,
				Recommendations:  []DietRecommendationOption{},
				GeneratedBy:      "campus_database",
				ResolvedSchool:   resolvedSchool,
			}, nil
		}
		fallbackInput := input
		fallbackInput.SchoolID = ""
		fallbackInput.SchoolName = ""
		fallbackInput.CampusID = ""
		fallbackInput.CampusName = ""
		result := fallbackDietRecommendation(fallbackInput, "campus_general_fallback", s.fetchDietRecommendationCandidates(ctx, userID, fallbackInput))
		result.Title = resolvedSchool.Name + "暂时没有匹配的校园菜品"
		result.Summary = "本校公共食物库暂时没有满足条件的已发布菜品，以下是通用备选，不代表该校食堂；我没有用模型编造食堂或菜名。"
		result.ResolvedSchool = resolvedSchool
		return result, nil
	}
	if apiKey == "" {
		logger.Info(ctx, "饮食推荐未配置文本模型，使用兜底推荐",
			slog.String("user_id", userID),
			slog.String("scene", input.Scene),
			slog.Int("candidate_count", len(candidates)),
		)
		return fallbackDietRecommendation(input, "rule_fallback", candidates), nil
	}

	body := map[string]any{
		"model": llm.Model,
		"messages": []map[string]string{
			{"role": "user", "content": buildDietRecommendationPrompt(input, candidates)},
		},
		"temperature": 0.5,
		"max_tokens":  1600,
		"stream":      false,
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, llm.BaseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		logger.Warn(ctx, "饮食推荐大模型请求失败，使用兜底推荐",
			logger.Err(err),
			slog.String("user_id", userID),
			slog.String("scene", input.Scene),
			slog.String("model", llm.Model),
			slog.Int("candidate_count", len(candidates)),
		)
		return fallbackDietRecommendation(input, "rule_fallback", candidates), nil
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		logger.Warn(ctx, "饮食推荐大模型响应异常，使用兜底推荐",
			slog.String("user_id", userID),
			slog.String("scene", input.Scene),
			slog.String("model", llm.Model),
			slog.Int("http.status_code", resp.StatusCode),
		)
		return fallbackDietRecommendation(input, "rule_fallback", candidates), nil
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil || len(parsed.Choices) == 0 {
		logger.Warn(ctx, "饮食推荐大模型返回内容无效，使用兜底推荐",
			logger.Err(err),
			slog.String("user_id", userID),
			slog.String("scene", input.Scene),
			slog.String("model", llm.Model),
		)
		return fallbackDietRecommendation(input, "rule_fallback", candidates), nil
	}
	content := strings.TrimSpace(dietRecommendationFenceRe.ReplaceAllString(parsed.Choices[0].Message.Content, ""))
	var result DietRecommendationResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		logger.Warn(ctx, "饮食推荐大模型 JSON 解析失败，使用兜底推荐",
			logger.Err(err),
			slog.String("user_id", userID),
			slog.String("scene", input.Scene),
			slog.String("model", llm.Model),
		)
		return fallbackDietRecommendation(input, "rule_fallback", candidates), nil
	}
	result = normalizeDietRecommendationResult(input, result, llm.Model, candidates)
	if len(result.Recommendations) == 0 {
		logger.Warn(ctx, "饮食推荐大模型未返回方案，使用兜底推荐",
			slog.String("user_id", userID),
			slog.String("scene", input.Scene),
			slog.String("model", llm.Model),
		)
		return fallbackDietRecommendation(input, "rule_fallback", candidates), nil
	}
	logger.Info(ctx, "饮食推荐生成完成",
		slog.String("user_id", userID),
		slog.String("scene", input.Scene),
		slog.String("model", llm.Model),
		slog.Int("candidate_count", len(candidates)),
		slog.Int("recommendation_count", len(result.Recommendations)),
	)

	return &result, nil
}

func normalizeDietRecommendationInput(input DietRecommendationInput) DietRecommendationInput {
	scene := strings.TrimSpace(input.Scene)
	if scene != "eat_out" && scene != "cook_home" {
		scene = "eat_out"
	}
	input.Scene = scene
	input.Question = strings.TrimSpace(input.Question)
	input.MealType = strings.TrimSpace(input.MealType)
	input.SchoolID = strings.TrimSpace(input.SchoolID)
	input.SchoolName = strings.TrimSpace(input.SchoolName)
	input.CampusID = strings.TrimSpace(input.CampusID)
	input.CampusName = strings.TrimSpace(input.CampusName)
	input.SessionID = strings.TrimSpace(input.SessionID)
	input.FollowUpIntent = normalizeDietRecommendationFollowUpIntent(input.FollowUpIntent)
	input.RecommendedSourceIDs = normalizeDietRecommendationSourceIDs(input.RecommendedSourceIDs)
	input.Date = strings.TrimSpace(input.Date)
	if input.Date == "" {
		input.Date = time.Now().In(chinaTZ).Format("2006-01-02")
	}
	input.CalorieRemaining = roundDietNumber(input.CalorieRemaining)
	input.MacroGaps.Calories = input.CalorieRemaining
	input.MacroGaps.Protein = roundDietNumber(math.Max(0, input.MacroGaps.Protein))
	input.MacroGaps.Carbs = roundDietNumber(math.Max(0, input.MacroGaps.Carbs))
	input.MacroGaps.Fat = roundDietNumber(math.Max(0, input.MacroGaps.Fat))
	input.Targets.Calories = roundDietNumber(math.Max(0, input.Targets.Calories))
	input.Targets.Protein = roundDietNumber(math.Max(0, input.Targets.Protein))
	input.Targets.Carbs = roundDietNumber(math.Max(0, input.Targets.Carbs))
	input.Targets.Fat = roundDietNumber(math.Max(0, input.Targets.Fat))
	input.Current.Calories = roundDietNumber(math.Max(0, input.Current.Calories))
	input.Current.Protein = roundDietNumber(math.Max(0, input.Current.Protein))
	input.Current.Carbs = roundDietNumber(math.Max(0, input.Current.Carbs))
	input.Current.Fat = roundDietNumber(math.Max(0, input.Current.Fat))
	if len(input.Meals) > 8 {
		input.Meals = input.Meals[:8]
	}
	return input
}

func buildDietRecommendationPrompt(input DietRecommendationInput, candidates []DietRecommendationCandidate) string {
	sceneLabel := "外面吃"
	sceneConstraint := "优先给便利店、快餐、面馆、轻食店、食堂都容易执行的点餐组合；说明少油少酱、半份主食、加蛋白等点餐要点。"
	if input.Scene == "cook_home" {
		sceneLabel = "自己做"
		sceneConstraint = "优先给常见食材和克重组合；每个方案必须有蛋白质食材、可选主食、蔬菜或低热量配菜。"
	}
	mealsJSON, _ := json.Marshal(input.Meals)
	candidatesJSON, _ := json.Marshal(limitDietRecommendationCandidates(candidates, 24))
	return fmt.Sprintf(`你是食探小程序里的智能饮食推荐助手。用户想知道“今天剩余热量还能吃什么”。

请基于以下上下文给出 %s 场景的饮食建议：
- 日期：%s
- 今日已摄入：热量 %.0f kcal，蛋白质 %.1fg，碳水 %.1fg，脂肪 %.1fg
- 今日目标：热量 %.0f kcal，蛋白质 %.1fg，碳水 %.1fg，脂肪 %.1fg
- 今日缺口：剩余热量 %.0f kcal，蛋白质缺口 %.1fg，碳水缺口 %.1fg，脂肪缺口 %.1fg
- 用户目标：%s
- 偏好补充：%s
- 今日已吃餐次摘要 JSON：%s
- 可用候选 JSON：%s

推荐原则：
1. 目标是“更接近今日热量和三大营养素目标”，不是医学诊断或治疗建议。
2. %s
3. 如果脂肪已经接近或超过目标，避免油炸、奶油、肥肉和高油酱汁。
4. 如果蛋白质缺口明显，优先安排高蛋白低脂来源。
5. 如果剩余热量低于 120 kcal，给轻量加餐或建议不必硬吃。
6. 每个方案必须给具体食物和份量，不要只写“吃点蛋白质”。
7. 优先使用“可用候选 JSON”里的真实候选；如果用了候选，必须把候选的 source 和 source_id 原样写入方案。
8. 如果需要微调份量，可以调整 amount 和营养数值，但不要凭空发明没有来源的主食物；确实补充少量配菜时，也要说明为补充建议。

只输出 JSON，不要 markdown，不要解释。格式必须是：
{
  "scene": "%s",
  "title": "一句标题",
  "summary": "一句整体建议",
  "calorie_remaining": 0,
  "macro_gaps": {"calories":0,"protein":0,"carbs":0,"fat":0},
  "recommendations": [
    {
      "title": "方案名",
      "reason": "为什么适合当前缺口",
      "source": "public_food_library / user_food_records / food_nutrition_library / mixed",
      "source_id": "候选 ID，如有",
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "items": [{"name":"食物名","amount":"具体重量或份量","source":"来源","source_id":"来源 ID"}],
      "tips": ["执行提示"],
      "alternatives": ["替换选择"]
    }
  ]
}
recommendations 给 5 个。所有数字用阿拉伯数字。`,
		sceneLabel,
		input.Date,
		input.Current.Calories,
		input.Current.Protein,
		input.Current.Carbs,
		input.Current.Fat,
		input.Targets.Calories,
		input.Targets.Protein,
		input.Targets.Carbs,
		input.Targets.Fat,
		input.CalorieRemaining,
		input.MacroGaps.Protein,
		input.MacroGaps.Carbs,
		input.MacroGaps.Fat,
		defaultIfEmpty(input.UserGoal, "未设置"),
		defaultIfEmpty(input.PreferenceContext, "无"),
		string(mealsJSON),
		string(candidatesJSON),
		sceneConstraint,
		input.Scene,
	)
}

func (s *StatsService) generateCampusDietRecommendationWithAI(
	ctx context.Context,
	userID string,
	input DietRecommendationInput,
	school domain.DietRecommendationSchool,
	llm textLLMRuntimeConfig,
	candidates []DietRecommendationCandidate,
) (*DietRecommendationResult, error) {
	shortlist := limitDietRecommendationCandidates(candidates, campusDietRecommendationAIRerankLimit)
	if len(shortlist) == 0 {
		return nil, fmt.Errorf("校园菜品候选为空")
	}
	prompt := buildCampusDietRecommendationPrompt(input, school, len(candidates), shortlist)
	body := map[string]any{
		"model": llm.Model,
		"messages": []map[string]string{
			{"role": "user", "content": prompt},
		},
		"temperature": 0.35,
		"max_tokens":  900,
		"stream":      false,
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, llm.BaseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+llm.APIKey)
	req.Header.Set("Content-Type", "application/json")
	startedAt := time.Now()
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("校园饮食推荐模型响应异常: %d", resp.StatusCode)
	}
	var completion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &completion); err != nil {
		return nil, fmt.Errorf("校园饮食推荐模型返回内容无效: %w", err)
	}
	if len(completion.Choices) == 0 {
		return nil, fmt.Errorf("校园饮食推荐模型未返回候选")
	}
	content := strings.TrimSpace(dietRecommendationFenceRe.ReplaceAllString(completion.Choices[0].Message.Content, ""))
	var ranked campusDietRecommendationAIResponse
	if err := json.Unmarshal([]byte(content), &ranked); err != nil {
		return nil, fmt.Errorf("校园饮食推荐模型 JSON 解析失败: %w", err)
	}

	byID := make(map[string]DietRecommendationCandidate, len(shortlist))
	for _, candidate := range shortlist {
		byID[candidate.SourceID] = candidate
	}
	options := make([]DietRecommendationOption, 0, campusDietRecommendationSelectionLimit)
	seen := map[string]bool{}
	for _, selection := range ranked.Selections {
		sourceID := strings.TrimSpace(selection.SourceID)
		candidate, ok := byID[sourceID]
		if !ok || seen[sourceID] {
			continue
		}
		seen[sourceID] = true
		options = append(options, campusDietRecommendationOption(candidate, selection.Reason, selection.Tip))
		if len(options) >= campusDietRecommendationSelectionLimit {
			break
		}
	}
	expectedSelections := campusDietRecommendationSelectionLimit
	if len(shortlist) < expectedSelections {
		expectedSelections = len(shortlist)
	}
	if len(options) != expectedSelections {
		return nil, fmt.Errorf("校园饮食推荐模型只返回 %d/%d 个有效真实菜品 ID", len(options), expectedSelections)
	}
	title := "AI 按你的目标选校园餐"
	summary := trimStatsRunes(strings.TrimSpace(ranked.Summary), 120)
	if summary == "" {
		summary = fmt.Sprintf("已检索本校 %d 道真实菜品，并由 AI 比较最相关的 %d 道候选。", len(candidates), len(shortlist))
	}
	switch input.FollowUpIntent {
	case "more":
		title = "AI 再换一批校园菜品"
	case "compare":
		title = "AI 重新比较刚才的选择"
	}
	result := &DietRecommendationResult{
		Scene:            input.Scene,
		Title:            title,
		Summary:          summary,
		CalorieRemaining: input.CalorieRemaining,
		MacroGaps:        input.MacroGaps,
		Recommendations:  options,
		GeneratedBy:      llm.Model,
		ResolvedSchool:   &school,
		CampusID:         input.CampusID,
		CampusName:       input.CampusName,
		AIUsed:           true,
		CandidateCount:   len(candidates),
		AIRerankCount:    len(shortlist),
	}
	logger.Info(ctx, "校园饮食推荐大模型重排完成",
		logger.UserID(userID),
		slog.String("school_id", school.ID),
		slog.String("school_name", school.Name),
		slog.String("model", llm.Model),
		slog.Int("candidate_count", len(candidates)),
		slog.Int("ai_rerank_count", len(shortlist)),
		slog.Int("recommendation_count", len(options)),
		slog.Int64("duration_ms", time.Since(startedAt).Milliseconds()),
	)
	return result, nil
}

func buildCampusDietRecommendationPrompt(input DietRecommendationInput, school domain.DietRecommendationSchool, totalCandidates int, candidates []DietRecommendationCandidate) string {
	type promptCandidate struct {
		SourceID    string  `json:"source_id"`
		Name        string  `json:"name"`
		Description string  `json:"description,omitempty"`
		Calories    float64 `json:"calories"`
		Protein     float64 `json:"protein"`
		Carbs       float64 `json:"carbs"`
		Fat         float64 `json:"fat"`
		Canteen     string  `json:"canteen,omitempty"`
		Floor       string  `json:"floor,omitempty"`
		Window      string  `json:"window,omitempty"`
		Price       float64 `json:"price,omitempty"`
		PriceUnit   string  `json:"price_unit,omitempty"`
	}
	promptCandidates := make([]promptCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		promptCandidates = append(promptCandidates, promptCandidate{
			SourceID: candidate.SourceID, Name: candidate.Title, Description: candidate.Description,
			Calories: candidate.Calories, Protein: candidate.Protein, Carbs: candidate.Carbs, Fat: candidate.Fat,
			Canteen: candidate.CanteenName, Floor: candidate.Floor, Window: candidate.WindowName,
			Price: candidate.Price, PriceUnit: candidate.PriceUnit,
		})
	}
	candidatesJSON, _ := json.Marshal(promptCandidates)
	selectionCount := campusDietRecommendationSelectionLimit
	if len(candidates) < selectionCount {
		selectionCount = len(candidates)
	}
	return fmt.Sprintf(`你是食探小程序的校园餐食决策助手。系统已经从%s的 %d 道已发布真实菜品中，按本餐热量与营养相关性初筛出以下 %d 道候选。

用户本轮原话：%s
餐次：%s
当前长期目标：%s
偏好补充：%s
今日剩余热量：%.0f kcal
本餐营养缺口：蛋白质 %.1fg，碳水 %.1fg，脂肪 %.1fg
真实候选 JSON：%s

请综合理解用户本轮语义和营养缺口后排序。本轮明确说出的“减脂、增肌、清淡、高蛋白、便宜、某食堂”等要求，优先级高于长期目标；条件接近时尽量增加食堂和菜品类型的多样性。

严格约束：
1. 只能从候选 JSON 选择，source_id 必须逐字原样返回；禁止创造菜名、食堂、位置、价格或营养值。
2. 必须选择 %d 道。reason 必须具体说明它为什么符合本轮问题，不能使用通用模板句。
3. tip 只写可执行的点餐/份量建议，不确定时留空。
4. 只输出 JSON，不要 markdown：{"summary":"一句整体判断","selections":[{"source_id":"真实ID","reason":"具体原因","tip":"可选提示"}]}`,
		school.Name,
		totalCandidates,
		len(candidates),
		defaultIfEmpty(input.Question, "今天吃什么"),
		defaultIfEmpty(input.MealType, "未指定"),
		defaultIfEmpty(input.UserGoal, "未设置"),
		defaultIfEmpty(input.PreferenceContext, "无"),
		input.CalorieRemaining,
		input.MacroGaps.Protein,
		input.MacroGaps.Carbs,
		input.MacroGaps.Fat,
		string(candidatesJSON),
		selectionCount,
	)
}

func campusDietRecommendationOption(candidate DietRecommendationCandidate, reason, tip string) DietRecommendationOption {
	reason = trimStatsRunes(strings.TrimSpace(reason), 100)
	if reason == "" {
		reason = "这道真实校园菜的营养值较接近你本餐的目标。"
	}
	location := strings.Join(compactDietStrings(candidate.SchoolName, candidate.CanteenName, candidate.Floor, candidate.WindowName), " · ")
	tips := make([]string, 0, 2)
	if location != "" {
		tips = append(tips, "位置："+location)
	}
	if tip = trimStatsRunes(strings.TrimSpace(tip), 80); tip != "" {
		tips = append(tips, tip)
	}
	items := candidate.Items
	if len(items) == 0 {
		items = []DietRecommendationFoodItem{{
			Name: candidate.Title, Amount: "1份", Source: candidate.Source, SourceID: candidate.SourceID,
		}}
	}
	return DietRecommendationOption{
		Title: candidate.Title, Reason: reason, Source: candidate.Source, SourceID: candidate.SourceID,
		Calories: candidate.Calories, Protein: candidate.Protein, Carbs: candidate.Carbs, Fat: candidate.Fat,
		Items: items, Tips: tips, IsCampusFood: candidate.IsCampusFood,
		SchoolID: candidate.SchoolID, SchoolName: candidate.SchoolName,
		CampusID: candidate.CampusID, CampusName: candidate.CampusName,
		CanteenID: candidate.CanteenID, CanteenName: candidate.CanteenName,
		WindowID: candidate.WindowID, WindowName: candidate.WindowName, Floor: candidate.Floor,
		Price: candidate.Price, PriceUnit: candidate.PriceUnit, ImagePath: candidate.ImagePath,
		NutritionBasis: candidate.NutritionBasis, NutritionSourceCategory: candidate.NutritionSourceCategory,
		WeightMethod: candidate.WeightMethod, WeightConfidence: candidate.WeightConfidence,
		UncertaintyLevel: candidate.UncertaintyLevel,
	}
}

func fallbackDietRecommendation(input DietRecommendationInput, generatedBy string, candidates []DietRecommendationCandidate) *DietRecommendationResult {
	if len(candidates) > 0 {
		return fallbackDietRecommendationFromCandidates(input, generatedBy, candidates)
	}
	title := "按今日缺口补一餐"
	summary := "优先补蛋白，热量控制在剩余额度附近。"
	options := []DietRecommendationOption{}
	if input.CalorieRemaining < 120 {
		summary = "今天剩余热量不多，可以选择很轻的加餐，也可以不必硬吃。"
		options = append(options, DietRecommendationOption{
			Title:    "轻量收尾",
			Reason:   "剩余热量较少，避免为了补齐目标而超额。",
			Calories: 80, Protein: 6, Carbs: 8, Fat: 2,
			Source:       "rule_fallback",
			Items:        []DietRecommendationFoodItem{{Name: "无糖酸奶", Amount: "100g", Source: "rule_fallback"}},
			Tips:         []string{"如果不饿，可以跳过加餐。"},
			Alternatives: []string{"水煮蛋 1 个", "无糖豆浆 200ml"},
		})
	} else if input.Scene == "cook_home" {
		options = append(options,
			DietRecommendationOption{
				Title:    "鸡胸肉蔬菜饭",
				Reason:   "蛋白质足，主食份量可控，适合补齐大多数热量缺口。",
				Calories: clampDietCalories(input.CalorieRemaining, 360), Protein: 35, Carbs: 42, Fat: 6,
				Source:       "rule_fallback",
				Items:        []DietRecommendationFoodItem{{Name: "鸡胸肉", Amount: "120g", Source: "rule_fallback"}, {Name: "米饭", Amount: "100g", Source: "rule_fallback"}, {Name: "西兰花", Amount: "200g", Source: "rule_fallback"}},
				Tips:         []string{"少油煎或水煮，调味以酱油、黑胡椒为主。"},
				Alternatives: []string{"鸡胸肉可换虾仁 150g", "米饭可换红薯 180g"},
			},
			DietRecommendationOption{
				Title:    "豆腐鸡蛋简餐",
				Reason:   "食材容易准备，脂肪不过高，适合晚餐补蛋白。",
				Calories: clampDietCalories(input.CalorieRemaining, 300), Protein: 24, Carbs: 20, Fat: 12,
				Source:       "rule_fallback",
				Items:        []DietRecommendationFoodItem{{Name: "北豆腐", Amount: "200g", Source: "rule_fallback"}, {Name: "鸡蛋", Amount: "1个", Source: "rule_fallback"}, {Name: "玉米", Amount: "半根", Source: "rule_fallback"}},
				Tips:         []string{"如果脂肪已偏高，鸡蛋可只用蛋白。"},
				Alternatives: []string{"豆腐可换鱼肉 120g", "玉米可换全麦面包 1 片"},
			},
		)
	} else {
		options = append(options,
			DietRecommendationOption{
				Title:    "便利店高蛋白组合",
				Reason:   "外食可执行性高，热量和蛋白质比较好控制。",
				Calories: clampDietCalories(input.CalorieRemaining, 380), Protein: 32, Carbs: 45, Fat: 7,
				Source:       "rule_fallback",
				Items:        []DietRecommendationFoodItem{{Name: "即食鸡胸肉", Amount: "1包", Source: "rule_fallback"}, {Name: "饭团", Amount: "1个", Source: "rule_fallback"}, {Name: "无糖豆浆", Amount: "1瓶", Source: "rule_fallback"}},
				Tips:         []string{"优先选原味鸡胸和无糖饮品。"},
				Alternatives: []string{"饭团可换玉米", "鸡胸可换茶叶蛋 2 个"},
			},
			DietRecommendationOption{
				Title:    "轻食店鸡肉沙拉",
				Reason:   "适合脂肪缺口不多、蛋白质仍需补齐的情况。",
				Calories: clampDietCalories(input.CalorieRemaining, 320), Protein: 28, Carbs: 25, Fat: 10,
				Source:       "rule_fallback",
				Items:        []DietRecommendationFoodItem{{Name: "鸡肉沙拉", Amount: "1份", Source: "rule_fallback"}, {Name: "酱料", Amount: "半份或另放", Source: "rule_fallback"}},
				Tips:         []string{"避开油炸配料，酱料减半。"},
				Alternatives: []string{"鸡肉可换虾仁", "主食不足时加半份玉米"},
			},
		)
	}
	if len(options) < 3 {
		options = append(options, DietRecommendationOption{
			Title:    "面馆清爽吃法",
			Reason:   "控制主食份量，同时通过加蛋白提升饱腹感。",
			Calories: clampDietCalories(input.CalorieRemaining, 430), Protein: 25, Carbs: 58, Fat: 9,
			Source:       "rule_fallback",
			Items:        []DietRecommendationFoodItem{{Name: "牛肉面", Amount: "半份面", Source: "rule_fallback"}, {Name: "牛肉", Amount: "加一份", Source: "rule_fallback"}, {Name: "汤", Amount: "少喝", Source: "rule_fallback"}},
			Tips:         []string{"少油辣，优先吃肉和菜。"},
			Alternatives: []string{"可换鸡丝面", "可加青菜或鸡蛋"},
		})
	}
	return &DietRecommendationResult{
		Scene:            input.Scene,
		Title:            title,
		Summary:          summary,
		CalorieRemaining: input.CalorieRemaining,
		MacroGaps:        input.MacroGaps,
		Recommendations:  options,
		GeneratedBy:      generatedBy,
	}
}

func normalizeDietRecommendationResult(input DietRecommendationInput, result DietRecommendationResult, generatedBy string, candidates []DietRecommendationCandidate) DietRecommendationResult {
	result.Scene = input.Scene
	if strings.TrimSpace(result.Title) == "" {
		result.Title = "按今日缺口补一餐"
	}
	if strings.TrimSpace(result.Summary) == "" {
		result.Summary = "下面这些方案会尽量贴近今天剩余热量和营养缺口。"
	}
	result.CalorieRemaining = input.CalorieRemaining
	result.MacroGaps = input.MacroGaps
	result.GeneratedBy = generatedBy
	for i := range result.Recommendations {
		opt := &result.Recommendations[i]
		attachDietRecommendationSource(opt, candidates)
		opt.Calories = roundDietNumber(math.Max(0, opt.Calories))
		opt.Protein = roundDietNumber(math.Max(0, opt.Protein))
		opt.Carbs = roundDietNumber(math.Max(0, opt.Carbs))
		opt.Fat = roundDietNumber(math.Max(0, opt.Fat))
		if len(opt.Tips) > 3 {
			opt.Tips = opt.Tips[:3]
		}
		if len(opt.Alternatives) > 4 {
			opt.Alternatives = opt.Alternatives[:4]
		}
	}
	if len(result.Recommendations) > 5 {
		result.Recommendations = result.Recommendations[:5]
	}
	return result
}

func (s *StatsService) fetchDietRecommendationCandidates(ctx context.Context, userID string, input DietRecommendationInput) []DietRecommendationCandidate {
	if s.repo == nil {
		return nil
	}
	limit := 24
	if input.SchoolID != "" {
		limit = campusDietRecommendationPoolLimit
	}
	candidates, err := s.repo.GetDietRecommendationCandidates(ctx, userID, input.Scene, domain.DietRecommendationScope{
		SchoolID:         input.SchoolID,
		CampusID:         input.CampusID,
		IncludeSourceIDs: dietRecommendationIncludedSourceIDs(input),
		ExcludeSourceIDs: dietRecommendationExcludedSourceIDs(input),
	}, limit)
	if err != nil {
		return nil
	}
	return rankDietRecommendationCandidates(input, candidates)
}

func normalizeDietRecommendationFollowUpIntent(value string) string {
	switch strings.TrimSpace(value) {
	case "more", "location", "compare", "context":
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func normalizeDietRecommendationSourceIDs(values []string) []string {
	out := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
		if len(out) >= 300 {
			break
		}
	}
	return out
}

func dietRecommendationIncludedSourceIDs(input DietRecommendationInput) []string {
	if input.FollowUpIntent == "location" || input.FollowUpIntent == "compare" || input.FollowUpIntent == "context" {
		return input.RecommendedSourceIDs
	}
	return nil
}

func dietRecommendationExcludedSourceIDs(input DietRecommendationInput) []string {
	if input.FollowUpIntent == "more" {
		return input.RecommendedSourceIDs
	}
	return nil
}

func fallbackDietRecommendationFromCandidates(input DietRecommendationInput, generatedBy string, candidates []DietRecommendationCandidate) *DietRecommendationResult {
	candidates = rankDietRecommendationCandidates(input, candidates)
	options := make([]DietRecommendationOption, 0, 5)
	for _, candidate := range candidates {
		if len(options) >= 5 {
			break
		}
		if strings.TrimSpace(candidate.Title) == "" || candidate.Calories <= 0 {
			continue
		}
		option := DietRecommendationOption{
			Title:        candidate.Title,
			Reason:       "来自" + dietRecommendationSourceLabel(candidate.Source) + "，营养值更接近今天剩余目标。",
			Source:       candidate.Source,
			SourceID:     candidate.SourceID,
			Calories:     candidate.Calories,
			Protein:      candidate.Protein,
			Carbs:        candidate.Carbs,
			Fat:          candidate.Fat,
			Items:        candidate.Items,
			Tips:         []string{"可按饥饿程度微调份量。"},
			IsCampusFood: candidate.IsCampusFood,
			SchoolID:     candidate.SchoolID,
			SchoolName:   candidate.SchoolName,
			CampusID:     candidate.CampusID,
			CampusName:   candidate.CampusName,
			CanteenID:    candidate.CanteenID,
			CanteenName:  candidate.CanteenName,
			WindowID:     candidate.WindowID,
			WindowName:   candidate.WindowName,
			Floor:        candidate.Floor,
			Price:        candidate.Price,
			PriceUnit:    candidate.PriceUnit,
			ImagePath:    candidate.ImagePath,
		}
		if candidate.IsCampusFood {
			location := strings.Join(compactDietStrings(candidate.SchoolName, candidate.CanteenName, candidate.Floor, candidate.WindowName), " · ")
			option.Reason = "来自真实校园食堂数据，营养更接近你当前这餐的缺口。"
			if location != "" {
				option.Tips = []string{"位置：" + location}
			}
		}
		if len(option.Items) == 0 {
			option.Items = []DietRecommendationFoodItem{{
				Name:     candidate.Title,
				Amount:   "1份",
				Source:   candidate.Source,
				SourceID: candidate.SourceID,
			}}
		}
		options = append(options, option)
	}
	if len(options) == 0 {
		return fallbackDietRecommendation(input, generatedBy, nil)
	}
	return &DietRecommendationResult{
		Scene:            input.Scene,
		Title:            "按今日缺口补一餐",
		Summary:          "优先从已有食物数据中挑选，更贴近真实记录和营养值。",
		CalorieRemaining: input.CalorieRemaining,
		MacroGaps:        input.MacroGaps,
		Recommendations:  options,
		GeneratedBy:      generatedBy,
	}
}

func compactDietStrings(values ...string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			out = append(out, value)
		}
	}
	return out
}

func (s *StatsService) resolveDietRecommendationSchool(ctx context.Context, userID string, input DietRecommendationInput) (*domain.DietRecommendationSchool, string, string) {
	if s.repo == nil {
		return nil, "", ""
	}
	question := strings.TrimSpace(input.Question)
	if question != "" {
		if school, err := s.repo.ResolveDietRecommendationSchool(ctx, question); err == nil && school != nil {
			return school, "", ""
		}
	}
	if input.SchoolID != "" {
		return &domain.DietRecommendationSchool{ID: input.SchoolID, Name: input.SchoolName}, input.CampusID, input.CampusName
	}
	if input.SessionID != "" {
		if messages, err := s.repo.GetPetChatSessionMessages(ctx, userID, input.SessionID, 12); err == nil {
			for i := len(messages) - 1; i >= 0; i-- {
				if messages[i].Role != "user" {
					continue
				}
				if school, err := s.repo.ResolveDietRecommendationSchool(ctx, messages[i].Content); err == nil && school != nil {
					return school, "", ""
				}
			}
		}
	}
	profile, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil || profile == nil {
		return nil, "", ""
	}
	pref := mapFromAny(profile.HealthCondition["campus_dining_preference"])
	if len(pref) == 0 {
		return nil, "", ""
	}
	schoolID := strings.TrimSpace(fmt.Sprintf("%v", pref["school_id"]))
	if schoolID == "" || schoolID == "<nil>" {
		return nil, "", ""
	}
	return &domain.DietRecommendationSchool{
		ID:   schoolID,
		Name: strings.TrimSpace(fmt.Sprintf("%v", pref["school_name"])),
	}, dietRecommendationMapString(pref, "campus_id"), dietRecommendationMapString(pref, "campus_name")
}

func dietRecommendationMapString(values map[string]any, key string) string {
	value := strings.TrimSpace(fmt.Sprintf("%v", values[key]))
	if value == "<nil>" {
		return ""
	}
	return value
}

func normalizeDietRecommendationCandidates(candidates []DietRecommendationCandidate) []DietRecommendationCandidate {
	out := make([]DietRecommendationCandidate, 0, len(candidates))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		candidate.Source = strings.TrimSpace(candidate.Source)
		candidate.SourceID = strings.TrimSpace(candidate.SourceID)
		candidate.Title = strings.TrimSpace(candidate.Title)
		if candidate.Source == "" || candidate.Title == "" {
			continue
		}
		key := candidate.Source + ":" + candidate.SourceID + ":" + candidate.Title
		if seen[key] {
			continue
		}
		seen[key] = true
		candidate.Calories = roundDietNumber(math.Max(0, candidate.Calories))
		candidate.Protein = roundDietNumber(math.Max(0, candidate.Protein))
		candidate.Carbs = roundDietNumber(math.Max(0, candidate.Carbs))
		candidate.Fat = roundDietNumber(math.Max(0, candidate.Fat))
		for i := range candidate.Items {
			if strings.TrimSpace(candidate.Items[i].Source) == "" {
				candidate.Items[i].Source = candidate.Source
			}
			if strings.TrimSpace(candidate.Items[i].SourceID) == "" {
				candidate.Items[i].SourceID = candidate.SourceID
			}
		}
		out = append(out, candidate)
	}
	return out
}

func rankDietRecommendationCandidates(input DietRecommendationInput, candidates []DietRecommendationCandidate) []DietRecommendationCandidate {
	candidates = normalizeDietRecommendationCandidates(candidates)
	sort.SliceStable(candidates, func(i, j int) bool {
		return dietRecommendationCandidateScore(input, candidates[i]) > dietRecommendationCandidateScore(input, candidates[j])
	})
	return candidates
}

func dietRecommendationCandidateScore(input DietRecommendationInput, candidate DietRecommendationCandidate) float64 {
	score := 1000.0
	target := dietRecommendationMealCalorieTarget(input)
	if target <= 0 {
		target = candidate.Calories
	}
	score -= math.Abs(candidate.Calories-target) * 1.2
	if input.MacroGaps.Protein > 15 {
		score += candidate.Protein * 8
	}
	if input.MacroGaps.Fat <= 5 && candidate.Fat > 12 {
		score -= candidate.Fat * 10
	}
	if input.Scene == "eat_out" && candidate.Source == "public_food_library" {
		score += 120
	}
	if input.Scene == "cook_home" && candidate.Source == "food_nutrition_library" {
		score += 80
	}
	if candidate.Source == "user_food_records" {
		score += 60
	}
	goalContext := dietRecommendationGoalContext(input)
	proteinDensity := candidate.Protein / math.Max(candidate.Calories, 1)
	if strings.Contains(goalContext, "减脂") || strings.Contains(goalContext, "减肥") || strings.Contains(goalContext, "控脂") || strings.Contains(goalContext, "fat_loss") {
		score += proteinDensity * 1200
		score -= candidate.Fat * 3
	}
	if strings.Contains(goalContext, "增肌") || strings.Contains(goalContext, "长肌肉") || strings.Contains(goalContext, "muscle_gain") {
		score += candidate.Protein * 12
		score += candidate.Carbs * 1.2
	}
	if strings.Contains(goalContext, "高蛋白") || strings.Contains(goalContext, "补蛋白") {
		score += candidate.Protein * 14
	}
	if strings.Contains(goalContext, "低脂") || strings.Contains(goalContext, "清淡") || strings.Contains(goalContext, "少油") {
		score -= candidate.Fat * 8
	}
	return score
}

func dietRecommendationGoalContext(input DietRecommendationInput) string {
	question := strings.ToLower(strings.TrimSpace(input.Question))
	preference := strings.ToLower(strings.TrimSpace(input.PreferenceContext))
	if strings.Contains(question, "减脂") || strings.Contains(question, "减肥") || strings.Contains(question, "控脂") || strings.Contains(question, "增肌") || strings.Contains(question, "长肌肉") {
		return question + " " + preference
	}
	return strings.Join(compactDietStrings(question, strings.ToLower(strings.TrimSpace(input.UserGoal)), preference), " ")
}

func dietRecommendationMealCalorieTarget(input DietRecommendationInput) float64 {
	ratio := 0.3
	switch strings.TrimSpace(input.MealType) {
	case "breakfast":
		ratio = 0.25
	case "lunch":
		ratio = 0.35
	case "dinner":
		ratio = 0.3
	}
	target := input.Targets.Calories * ratio
	if target <= 0 {
		target = math.Min(input.CalorieRemaining, 500)
	}
	if input.CalorieRemaining > 0 && target > input.CalorieRemaining {
		target = input.CalorieRemaining
	}
	return target
}

func limitDietRecommendationCandidates(candidates []DietRecommendationCandidate, limit int) []DietRecommendationCandidate {
	if limit <= 0 || len(candidates) <= limit {
		return candidates
	}
	return candidates[:limit]
}

func attachDietRecommendationSource(option *DietRecommendationOption, candidates []DietRecommendationCandidate) {
	if option == nil {
		return
	}
	source := strings.TrimSpace(option.Source)
	sourceID := strings.TrimSpace(option.SourceID)
	if source != "" {
		for i := range option.Items {
			if strings.TrimSpace(option.Items[i].Source) == "" {
				option.Items[i].Source = source
			}
			if strings.TrimSpace(option.Items[i].SourceID) == "" {
				option.Items[i].SourceID = sourceID
			}
		}
		return
	}
	matched := findDietRecommendationCandidate(option, candidates)
	if matched == nil {
		option.Source = "ai_generated"
		return
	}
	option.Source = matched.Source
	option.SourceID = matched.SourceID
	for i := range option.Items {
		if strings.TrimSpace(option.Items[i].Source) == "" {
			option.Items[i].Source = matched.Source
		}
		if strings.TrimSpace(option.Items[i].SourceID) == "" {
			option.Items[i].SourceID = matched.SourceID
		}
	}
}

func findDietRecommendationCandidate(option *DietRecommendationOption, candidates []DietRecommendationCandidate) *DietRecommendationCandidate {
	title := normalizeDietRecommendationText(option.Title)
	for i := range candidates {
		if title != "" && normalizeDietRecommendationText(candidates[i].Title) == title {
			return &candidates[i]
		}
		for _, item := range option.Items {
			itemName := normalizeDietRecommendationText(item.Name)
			if itemName != "" && normalizeDietRecommendationText(candidates[i].Title) == itemName {
				return &candidates[i]
			}
			for _, candidateItem := range candidates[i].Items {
				if itemName != "" && normalizeDietRecommendationText(candidateItem.Name) == itemName {
					return &candidates[i]
				}
			}
		}
	}
	return nil
}

func normalizeDietRecommendationText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, " ", "")
	value = strings.ReplaceAll(value, "　", "")
	return value
}

func dietRecommendationSourceLabel(source string) string {
	switch source {
	case "public_food_library":
		return "公共食物库"
	case "user_food_records":
		return "你的历史记录"
	case "food_nutrition_library":
		return "标准营养库"
	case "rule_fallback":
		return "规则兜底"
	default:
		return "候选库"
	}
}

func clampCandidateCalories(remaining, value float64) float64 {
	if remaining <= 0 || value <= 0 {
		return roundDietNumber(value)
	}
	if value > remaining*1.25 && remaining >= 120 {
		return roundDietNumber(remaining)
	}
	return roundDietNumber(value)
}

func roundDietNumber(v float64) float64 {
	return math.Round(v*10) / 10
}

func clampDietCalories(remaining float64, fallback float64) float64 {
	if remaining <= 0 {
		return fallback
	}
	return roundDietNumber(math.Min(math.Max(120, remaining), fallback))
}

func defaultIfEmpty(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}
