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
	"strings"
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
	Calories     float64                      `json:"calories"`
	Protein      float64                      `json:"protein"`
	Carbs        float64                      `json:"carbs"`
	Fat          float64                      `json:"fat"`
	Items        []DietRecommendationFoodItem `json:"items"`
	Tips         []string                     `json:"tips"`
	Alternatives []string                     `json:"alternatives"`
}

type DietRecommendationFoodItem struct {
	Name   string `json:"name"`
	Amount string `json:"amount"`
}

var dietRecommendationFenceRe = regexp.MustCompile("(?s)```json?\\s*\\n?|```")

const creditCostDietRecommendation = 1

func (s *StatsService) GenerateDietRecommendation(ctx context.Context, userID string, input DietRecommendationInput) (*DietRecommendationResult, error) {
	var creditsInfo map[string]any
	var err error
	if s.creditGuard != nil && userID != "" {
		creditsInfo, err = s.creditGuard.ValidateDietRecommendationCredits(ctx, userID)
		if err != nil {
			return nil, err
		}
	}

	result, err := s.generateDietRecommendationCore(ctx, input)
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

func (s *StatsService) generateDietRecommendationCore(ctx context.Context, input DietRecommendationInput) (*DietRecommendationResult, error) {
	input = normalizeDietRecommendationInput(input)
	apiKey := ""
	if s.cfg != nil {
		apiKey = strings.TrimSpace(s.cfg.External.DeepSeekAPIKey)
	}
	if apiKey == "" {
		return fallbackDietRecommendation(input, "rule_fallback"), nil
	}

	body := map[string]any{
		"model": statsInsightDeepSeekModel,
		"messages": []map[string]string{
			{"role": "user", "content": buildDietRecommendationPrompt(input)},
		},
		"temperature": 0.5,
		"max_tokens":  1600,
		"stream":      false,
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.deepseek.com/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return fallbackDietRecommendation(input, "rule_fallback"), nil
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fallbackDietRecommendation(input, "rule_fallback"), nil
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil || len(parsed.Choices) == 0 {
		return fallbackDietRecommendation(input, "rule_fallback"), nil
	}
	content := strings.TrimSpace(dietRecommendationFenceRe.ReplaceAllString(parsed.Choices[0].Message.Content, ""))
	var result DietRecommendationResult
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return fallbackDietRecommendation(input, "rule_fallback"), nil
	}
	result = normalizeDietRecommendationResult(input, result, "deepseek-v4-flash")
	if len(result.Recommendations) == 0 {
		return fallbackDietRecommendation(input, "rule_fallback"), nil
	}

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

func buildDietRecommendationPrompt(input DietRecommendationInput) string {
	sceneLabel := "外面吃"
	sceneConstraint := "优先给便利店、快餐、面馆、轻食店、食堂都容易执行的点餐组合；说明少油少酱、半份主食、加蛋白等点餐要点。"
	if input.Scene == "cook_home" {
		sceneLabel = "自己做"
		sceneConstraint = "优先给常见食材和克重组合；每个方案必须有蛋白质食材、可选主食、蔬菜或低热量配菜。"
	}
	mealsJSON, _ := json.Marshal(input.Meals)
	return fmt.Sprintf(`你是食探小程序里的智能饮食推荐助手。用户想知道“今天剩余热量还能吃什么”。

请基于以下上下文给出 %s 场景的饮食建议：
- 日期：%s
- 今日已摄入：热量 %.0f kcal，蛋白质 %.1fg，碳水 %.1fg，脂肪 %.1fg
- 今日目标：热量 %.0f kcal，蛋白质 %.1fg，碳水 %.1fg，脂肪 %.1fg
- 今日缺口：剩余热量 %.0f kcal，蛋白质缺口 %.1fg，碳水缺口 %.1fg，脂肪缺口 %.1fg
- 用户目标：%s
- 偏好补充：%s
- 今日已吃餐次摘要 JSON：%s

推荐原则：
1. 目标是“更接近今日热量和三大营养素目标”，不是医学诊断或治疗建议。
2. %s
3. 如果脂肪已经接近或超过目标，避免油炸、奶油、肥肉和高油酱汁。
4. 如果蛋白质缺口明显，优先安排高蛋白低脂来源。
5. 如果剩余热量低于 120 kcal，给轻量加餐或建议不必硬吃。
6. 每个方案必须给具体食物和份量，不要只写“吃点蛋白质”。

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
      "calories": 0,
      "protein": 0,
      "carbs": 0,
      "fat": 0,
      "items": [{"name":"食物名","amount":"具体重量或份量"}],
      "tips": ["执行提示"],
      "alternatives": ["替换选择"]
    }
  ]
}
recommendations 给 3 个。所有数字用阿拉伯数字。`,
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
		sceneConstraint,
		input.Scene,
	)
}

func fallbackDietRecommendation(input DietRecommendationInput, generatedBy string) *DietRecommendationResult {
	title := "按今日缺口补一餐"
	summary := "优先补蛋白，热量控制在剩余额度附近。"
	options := []DietRecommendationOption{}
	if input.CalorieRemaining < 120 {
		summary = "今天剩余热量不多，可以选择很轻的加餐，也可以不必硬吃。"
		options = append(options, DietRecommendationOption{
			Title:    "轻量收尾",
			Reason:   "剩余热量较少，避免为了补齐目标而超额。",
			Calories: 80, Protein: 6, Carbs: 8, Fat: 2,
			Items:        []DietRecommendationFoodItem{{Name: "无糖酸奶", Amount: "100g"}},
			Tips:         []string{"如果不饿，可以跳过加餐。"},
			Alternatives: []string{"水煮蛋 1 个", "无糖豆浆 200ml"},
		})
	} else if input.Scene == "cook_home" {
		options = append(options,
			DietRecommendationOption{
				Title:    "鸡胸肉蔬菜饭",
				Reason:   "蛋白质足，主食份量可控，适合补齐大多数热量缺口。",
				Calories: clampDietCalories(input.CalorieRemaining, 360), Protein: 35, Carbs: 42, Fat: 6,
				Items:        []DietRecommendationFoodItem{{Name: "鸡胸肉", Amount: "120g"}, {Name: "米饭", Amount: "100g"}, {Name: "西兰花", Amount: "200g"}},
				Tips:         []string{"少油煎或水煮，调味以酱油、黑胡椒为主。"},
				Alternatives: []string{"鸡胸肉可换虾仁 150g", "米饭可换红薯 180g"},
			},
			DietRecommendationOption{
				Title:    "豆腐鸡蛋简餐",
				Reason:   "食材容易准备，脂肪不过高，适合晚餐补蛋白。",
				Calories: clampDietCalories(input.CalorieRemaining, 300), Protein: 24, Carbs: 20, Fat: 12,
				Items:        []DietRecommendationFoodItem{{Name: "北豆腐", Amount: "200g"}, {Name: "鸡蛋", Amount: "1个"}, {Name: "玉米", Amount: "半根"}},
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
				Items:        []DietRecommendationFoodItem{{Name: "即食鸡胸肉", Amount: "1包"}, {Name: "饭团", Amount: "1个"}, {Name: "无糖豆浆", Amount: "1瓶"}},
				Tips:         []string{"优先选原味鸡胸和无糖饮品。"},
				Alternatives: []string{"饭团可换玉米", "鸡胸可换茶叶蛋 2 个"},
			},
			DietRecommendationOption{
				Title:    "轻食店鸡肉沙拉",
				Reason:   "适合脂肪缺口不多、蛋白质仍需补齐的情况。",
				Calories: clampDietCalories(input.CalorieRemaining, 320), Protein: 28, Carbs: 25, Fat: 10,
				Items:        []DietRecommendationFoodItem{{Name: "鸡肉沙拉", Amount: "1份"}, {Name: "酱料", Amount: "半份或另放"}},
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
			Items:        []DietRecommendationFoodItem{{Name: "牛肉面", Amount: "半份面"}, {Name: "牛肉", Amount: "加一份"}, {Name: "汤", Amount: "少喝"}},
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

func normalizeDietRecommendationResult(input DietRecommendationInput, result DietRecommendationResult, generatedBy string) DietRecommendationResult {
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
	if len(result.Recommendations) > 3 {
		result.Recommendations = result.Recommendations[:3]
	}
	return result
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
