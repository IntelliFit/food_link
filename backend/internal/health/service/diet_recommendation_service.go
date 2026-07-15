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
	Scene             string                   `json:"scene"`
	Date              string                   `json:"date"`
	CalorieRemaining  float64                  `json:"calorie_remaining"`
	MacroGaps         DietRecommendationMacro  `json:"macro_gaps"`
	Targets           DietRecommendationMacro  `json:"targets"`
	Current           DietRecommendationMacro  `json:"current"`
	Meals             []DietRecommendationMeal `json:"meals"`
	UserGoal          string                   `json:"user_goal"`
	PreferenceContext string                   `json:"preference_context"`
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
	Scene            string                     `json:"scene"`
	Title            string                     `json:"title"`
	Summary          string                     `json:"summary"`
	CalorieRemaining float64                    `json:"calorie_remaining"`
	MacroGaps        DietRecommendationMacro    `json:"macro_gaps"`
	Recommendations  []DietRecommendationOption `json:"recommendations"`
	GeneratedBy      string                     `json:"generated_by"`
}

type DietRecommendationOption struct {
	Title        string                       `json:"title"`
	Reason       string                       `json:"reason"`
	Source       string                       `json:"source,omitempty"`
	SourceID     string                       `json:"source_id,omitempty"`
	Calories     float64                      `json:"calories"`
	Protein      float64                      `json:"protein"`
	Carbs        float64                      `json:"carbs"`
	Fat          float64                      `json:"fat"`
	Items        []DietRecommendationFoodItem `json:"items"`
	Tips         []string                     `json:"tips"`
	Alternatives []string                     `json:"alternatives"`
}

type DietRecommendationFoodItem = domain.DietRecommendationFoodItem

var dietRecommendationFenceRe = regexp.MustCompile("(?s)```json?\\s*\\n?|```")

const creditCostDietRecommendation = 1

// 饮食推荐必须在小程序请求超时前返回。AI 只是改善文案和组合的可选项，
// 不能让它的瞬时网络波动阻塞本地候选和规则兜底结果。
var dietRecommendationTimeout = 12 * time.Second

func (s *StatsService) GenerateDietRecommendation(ctx context.Context, userID string, input DietRecommendationInput) (*DietRecommendationResult, error) {
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

	return result, nil
}

func (s *StatsService) generateDietRecommendationCore(ctx context.Context, userID string, input DietRecommendationInput) (*DietRecommendationResult, error) {
	ctx, cancel := context.WithTimeout(ctx, dietRecommendationTimeout)
	defer cancel()

	input = normalizeDietRecommendationInput(input)
	llm := s.preferredTextLLM()
	apiKey := llm.APIKey
	candidates := s.fetchDietRecommendationCandidates(ctx, userID, input)
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
	candidates, err := s.repo.GetDietRecommendationCandidates(ctx, userID, input.Scene, 24)
	if err != nil {
		return nil
	}
	return rankDietRecommendationCandidates(input, candidates)
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
			Title:    candidate.Title,
			Reason:   "来自" + dietRecommendationSourceLabel(candidate.Source) + "，营养值更接近今天剩余目标。",
			Source:   candidate.Source,
			SourceID: candidate.SourceID,
			Calories: clampCandidateCalories(input.CalorieRemaining, candidate.Calories),
			Protein:  candidate.Protein,
			Carbs:    candidate.Carbs,
			Fat:      candidate.Fat,
			Items:    candidate.Items,
			Tips:     []string{"可按饥饿程度微调份量。"},
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
	remaining := input.CalorieRemaining
	if remaining <= 0 {
		remaining = candidate.Calories
	}
	score -= math.Abs(candidate.Calories-remaining) * 1.2
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
	return score
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
