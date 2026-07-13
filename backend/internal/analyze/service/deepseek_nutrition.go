package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

var deepSeekFenceRe = regexp.MustCompile("(?s)```json?\\s*\\n?|```")

const deepSeekNutritionFallbackModel = "deepseek-v4-pro"

const aiNutritionMicronutrientRequirement = "必须尽量补齐维生素和矿物质等项目 21 项微量营养：fiber、sugar、saturatedFat、cholesterolMg、sodiumMg、potassiumMg、calciumMg、ironMg、magnesiumMg、zincMg、vitaminARaeMcg、vitaminCMg、vitaminDMcg、vitaminEMg、vitaminKMcg、thiaminMg、riboflavinMg、niacinMg、vitaminB6Mg、folateMcg、vitaminB12Mcg。不要把微量元素随意填 0；微量元素不确定时也要按同类食物保守估算，只有天然接近 0 或该食物确实几乎不含该营养时才填 0。"

type DeepSeekNutritionEstimator struct {
	APIKey  string
	BaseURL string
	Model   string
	client  *http.Client
}

type UnresolvedNutritionCandidate struct {
	Index                int
	Name                 string
	EstimatedWeightGrams float64
}

func NewDeepSeekNutritionEstimator(apiKey, baseURL, model string) *DeepSeekNutritionEstimator {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = "https://api.deepseek.com"
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = deepSeekNutritionFallbackModel
	}
	return &DeepSeekNutritionEstimator{
		APIKey:  strings.TrimSpace(apiKey),
		BaseURL: baseURL,
		Model:   model,
		client:  &http.Client{Timeout: 25 * time.Second},
	}
}

func (e *DeepSeekNutritionEstimator) Analyze(ctx context.Context, prompt, imageURL string) (map[string]any, error) {
	if e == nil || e.APIKey == "" {
		return nil, fmt.Errorf("缺少 DEEPSEEK_API_KEY")
	}
	body := map[string]any{
		"model": e.Model,
		"messages": []map[string]any{
			{"role": "user", "content": prompt},
		},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     0,
		"stream":          false,
	}
	content, err := e.chatCompletion(ctx, body)
	if err != nil {
		return nil, err
	}
	return parseLLMJSON(content)
}

func (e *DeepSeekNutritionEstimator) Estimate(ctx context.Context, candidates []UnresolvedNutritionCandidate, additionalContext string) (map[int]map[string]any, error) {
	if e == nil || e.APIKey == "" {
		return map[int]map[string]any{}, nil
	}
	payloadItems := []map[string]any{}
	candidateNames := map[int]string{}
	for _, candidate := range candidates {
		name := strings.TrimSpace(candidate.Name)
		if name == "" || candidate.EstimatedWeightGrams <= 0 {
			continue
		}
		candidateNames[candidate.Index] = name
		payloadItems = append(payloadItems, map[string]any{
			"index":                candidate.Index,
			"name":                 name,
			"estimatedWeightGrams": round2(candidate.EstimatedWeightGrams),
		})
	}
	if len(payloadItems) == 0 {
		return map[int]map[string]any{}, nil
	}
	systemPrompt := "你是营养数据库补全助手。用户已通过视觉模型识别出食物名称和重量，现在只需要你基于食物名称、烹饪方式和重量，补充每100g营养估计。请尽量使用可靠营养知识、品牌/包装常识和常见食物数据库口径交叉校验；不确定时保守估计并保持热量与宏量营养一致。只返回 JSON，不要附加解释。"
	userPrompt := map[string]any{
		"task": "为未命中食物补充每100g营养估计",
		"requirements": []string{
			"根据食物名称和常见烹饪方式估算每100g营养，不需要重新判断重量。",
			"输出字段使用 camelCase。",
			"所有字段必须为数字；不要因为不确定就把热量或宏量营养随意填 0，只有该营养天然接近 0 时才填 0。",
			aiNutritionMicronutrientRequirement,
			"如果名称带有烹饪信息，例如 清炒/清蒸/炖/红烧，请结合该烹饪方式估算。",
			"热量单位 kcal；protein/carbs/fat/fiber/sugar/saturatedFat 单位 g；cholesterolMg、sodiumMg、potassiumMg、calciumMg、ironMg、magnesiumMg、zincMg 和维生素中以 Mg 结尾的字段单位为 mg；vitaminARaeMcg、vitaminDMcg、vitaminKMcg、folateMcg、vitaminB12Mcg 单位为 mcg。",
			"热量必须与宏量营养一致：calories 应大致不低于 protein*4 + carbs*4 + fat*9；如果无法确定热量，用该公式的结果作为下限。",
			"每100g 的 protein/carbs/fat/fiber/sugar/saturatedFat 不得为负，也不得超过 100g；sugar 不得超过 carbs，saturatedFat 不得超过 fat。",
			"无糖黑咖啡/美式咖啡/纯茶/白水每100g可接近 0 kcal；但如果名称包含拿铁、奶、糖、糖浆、奶油、椰乳等，应估算对应碳水/脂肪和热量。",
			"品牌饮品如果无法确认配方，应按同类常见产品估算，并保证热量和宏量营养自洽。",
		},
		"additionalContext": strings.TrimSpace(additionalContext),
		"items":             payloadItems,
		"responseSchema": map[string]any{
			"items": []map[string]any{{
				"index":                0,
				"unitNutritionPer100g": zeroUnitNutritionPer100g(),
			}},
		},
	}
	userBytes, _ := json.Marshal(userPrompt)
	body := map[string]any{
		"model": e.Model,
		"messages": []map[string]any{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": string(userBytes)},
		},
		"response_format": map[string]string{"type": "json_object"},
		"temperature":     0,
		"max_tokens":      estimateMaxTokens(len(payloadItems)),
		"stream":          false,
	}
	content, err := e.chatCompletion(ctx, body)
	if err != nil {
		return nil, err
	}
	parsed, err := parseLLMJSON(content)
	if err != nil {
		return nil, fmt.Errorf("解析 DeepSeek 营养 JSON 失败: %w", err)
	}
	rawItems, ok := parsed["items"].([]any)
	if !ok {
		return map[int]map[string]any{}, nil
	}
	out := map[int]map[string]any{}
	for _, raw := range rawItems {
		row, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		index := int(numberFromAny(row["index"]))
		unit, ok := row["unitNutritionPer100g"].(map[string]any)
		if !ok {
			continue
		}
		out[index] = normalizeFallbackUnitNutrition(candidateNames[index], coerceExtendedNutrients(unit))
	}
	return out, nil
}

func (e *DeepSeekNutritionEstimator) chatCompletion(ctx context.Context, body map[string]any) (string, error) {
	bodyBytes, _ := json.Marshal(body)
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.BaseURL+"/chat/completions", bytes.NewReader(bodyBytes))
		if err != nil {
			return "", err
		}
		req.Header.Set("Authorization", "Bearer "+e.APIKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := e.client.Do(req)
		if err != nil {
			lastErr = err
		} else {
			content, retry, err := readDeepSeekChatContent(resp)
			if err == nil {
				return content, nil
			}
			lastErr = err
			if !retry {
				return "", err
			}
		}
		if attempt < 3 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			case <-time.After(time.Duration(attempt) * time.Second):
			}
		}
	}
	return "", lastErr
}

func readDeepSeekChatContent(resp *http.Response) (string, bool, error) {
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		err := fmt.Errorf("DeepSeek API 错误: %d body=%s", resp.StatusCode, summarizeDeepSeekBody(respBody))
		return "", resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests, err
	}
	var response struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &response); err != nil {
		return "", true, fmt.Errorf("解析 DeepSeek API 响应失败: %w body=%s", err, summarizeDeepSeekBody(respBody))
	}
	if len(response.Choices) == 0 || strings.TrimSpace(response.Choices[0].Message.Content) == "" {
		return "", true, fmt.Errorf("DeepSeek 返回了空响应 body=%s", summarizeDeepSeekBody(respBody))
	}
	return response.Choices[0].Message.Content, false, nil
}

func summarizeDeepSeekBody(data []byte) string {
	text := strings.TrimSpace(string(data))
	if text == "" {
		return "empty"
	}
	runes := []rune(text)
	if len(runes) > 300 {
		return string(runes[:300]) + "..."
	}
	return text
}

func estimateMaxTokens(itemCount int) int {
	if itemCount <= 0 {
		return 1200
	}
	tokens := 1200 + itemCount*700
	if tokens > 12000 {
		return 12000
	}
	return tokens
}

func zeroUnitNutritionPer100g() map[string]any {
	return map[string]any{
		"calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0, "sugar": 0,
		"saturatedFat": 0, "cholesterolMg": 0, "sodiumMg": 0, "potassiumMg": 0,
		"calciumMg": 0, "ironMg": 0, "magnesiumMg": 0, "zincMg": 0,
		"vitaminARaeMcg": 0, "vitaminCMg": 0, "vitaminDMcg": 0, "vitaminEMg": 0,
		"vitaminKMcg": 0, "thiaminMg": 0, "riboflavinMg": 0, "niacinMg": 0,
		"vitaminB6Mg": 0, "folateMcg": 0, "vitaminB12Mcg": 0,
	}
}

var nutritionKeyAliases = map[string][]string{
	"calories":       {"calories", "calorie", "kcal", "energy", "total_calories"},
	"protein":        {"protein", "total_protein"},
	"carbs":          {"carbs", "carbohydrates", "carbohydrate", "total_carbs"},
	"fat":            {"fat", "total_fat"},
	"fiber":          {"fiber", "dietary_fiber", "fibre"},
	"sugar":          {"sugar", "total_sugar", "sugars"},
	"saturatedFat":   {"saturatedFat", "saturated_fat"},
	"cholesterolMg":  {"cholesterolMg", "cholesterol_mg"},
	"sodiumMg":       {"sodiumMg", "sodium_mg"},
	"potassiumMg":    {"potassiumMg", "potassium_mg"},
	"calciumMg":      {"calciumMg", "calcium_mg"},
	"ironMg":         {"ironMg", "iron_mg"},
	"magnesiumMg":    {"magnesiumMg", "magnesium_mg"},
	"zincMg":         {"zincMg", "zinc_mg"},
	"vitaminARaeMcg": {"vitaminARaeMcg", "vitamin_a_rae_mcg"},
	"vitaminCMg":     {"vitaminCMg", "vitamin_c_mg"},
	"vitaminDMcg":    {"vitaminDMcg", "vitamin_d_mcg"},
	"vitaminEMg":     {"vitaminEMg", "vitamin_e_mg"},
	"vitaminKMcg":    {"vitaminKMcg", "vitamin_k_mcg"},
	"thiaminMg":      {"thiaminMg", "thiamin_mg"},
	"riboflavinMg":   {"riboflavinMg", "riboflavin_mg"},
	"niacinMg":       {"niacinMg", "niacin_mg"},
	"vitaminB6Mg":    {"vitaminB6Mg", "vitamin_b6_mg"},
	"folateMcg":      {"folateMcg", "folate_mcg"},
	"vitaminB12Mcg":  {"vitaminB12Mcg", "vitamin_b12_mcg"},
}

func coerceExtendedNutrients(unit map[string]any) map[string]any {
	out := zeroUnitNutritionPer100g()
	for key := range out {
		out[key] = round4(numberFromAny(nutritionValue(unit, key)))
	}
	return out
}

func normalizeFallbackUnitNutrition(foodName string, unit map[string]any) map[string]any {
	out := zeroUnitNutritionPer100g()
	for key := range out {
		out[key] = clampMin(round4(numberFromAny(unit[key])), 0)
	}
	_ = foodName

	out["protein"] = clampRange(numberFromAny(out["protein"]), 0, 100)
	out["carbs"] = clampRange(numberFromAny(out["carbs"]), 0, 100)
	out["fat"] = clampRange(numberFromAny(out["fat"]), 0, 100)
	out["fiber"] = clampRange(numberFromAny(out["fiber"]), 0, 100)
	out["sugar"] = clampRange(numberFromAny(out["sugar"]), 0, numberFromAny(out["carbs"]))
	out["saturatedFat"] = clampRange(numberFromAny(out["saturatedFat"]), 0, numberFromAny(out["fat"]))

	macroCalories := round4(numberFromAny(out["protein"])*4 + numberFromAny(out["carbs"])*4 + numberFromAny(out["fat"])*9)
	calories := clampRange(numberFromAny(out["calories"]), 0, 900)
	if macroCalories > 0 && calories < macroCalories*0.85 {
		calories = macroCalories
	}
	out["calories"] = clampRange(round4(calories), 0, 900)
	return out
}

func clampMin(value, min float64) float64 {
	if value < min {
		return min
	}
	return value
}

func clampRange(value, min, max float64) float64 {
	if max < min {
		max = min
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func nutritionValue(unit map[string]any, key string) any {
	if aliases, ok := nutritionKeyAliases[key]; ok {
		for _, alias := range aliases {
			if value, exists := unit[alias]; exists {
				return value
			}
		}
	}
	return unit[key]
}

func round2(value float64) float64 {
	return mathRound(value, 100)
}

func round4(value float64) float64 {
	return mathRound(value, 10000)
}

func mathRound(value float64, factor float64) float64 {
	if value >= 0 {
		return float64(int(value*factor+0.5)) / factor
	}
	return float64(int(value*factor-0.5)) / factor
}
