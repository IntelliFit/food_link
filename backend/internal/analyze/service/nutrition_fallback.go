package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const fallbackNutritionSourceKey = "_nutrition_source"

type namedNutritionFallbackEstimator struct {
	source    string
	estimator nutritionFallbackEstimator
}

type chainedNutritionFallbackEstimator struct {
	estimators []namedNutritionFallbackEstimator
}

func newChainedNutritionFallbackEstimator(estimators ...namedNutritionFallbackEstimator) *chainedNutritionFallbackEstimator {
	active := make([]namedNutritionFallbackEstimator, 0, len(estimators))
	for _, estimator := range estimators {
		if estimator.estimator == nil || strings.TrimSpace(estimator.source) == "" {
			continue
		}
		active = append(active, estimator)
	}
	return &chainedNutritionFallbackEstimator{estimators: active}
}

func (e *chainedNutritionFallbackEstimator) Estimate(ctx context.Context, candidates []UnresolvedNutritionCandidate, additionalContext string) (map[int]map[string]any, error) {
	if e == nil || len(e.estimators) == 0 {
		return map[int]map[string]any{}, nil
	}
	var lastErr error
	for _, candidate := range e.estimators {
		rows, err := candidate.estimator.Estimate(ctx, candidates, additionalContext)
		if err == nil && len(rows) > 0 {
			tagFallbackSource(rows, candidate.source)
			return rows, nil
		}
		if err != nil {
			lastErr = err
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return map[int]map[string]any{}, nil
}

func tagFallbackSource(rows map[int]map[string]any, source string) {
	source = strings.TrimSpace(source)
	if source == "" {
		return
	}
	for index, row := range rows {
		if row == nil {
			row = map[string]any{}
			rows[index] = row
		}
		row[fallbackNutritionSourceKey] = source
	}
}

func popFallbackSource(unit map[string]any, fallback string) string {
	source := strings.TrimSpace(fallback)
	if unit == nil {
		return source
	}
	if raw, ok := unit[fallbackNutritionSourceKey]; ok {
		delete(unit, fallbackNutritionSourceKey)
		if value := strings.TrimSpace(fmt.Sprintf("%v", raw)); value != "" {
			return value
		}
	}
	return source
}

type QwenNutritionEstimator struct {
	client LLMClient
}

func NewQwenNutritionEstimator(client LLMClient) *QwenNutritionEstimator {
	return &QwenNutritionEstimator{client: client}
}

func (e *QwenNutritionEstimator) Estimate(ctx context.Context, candidates []UnresolvedNutritionCandidate, additionalContext string) (map[int]map[string]any, error) {
	if e == nil || e.client == nil {
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
	userPrompt := map[string]any{
		"task": "为未命中食物补充每100g营养估计",
		"requirements": []string{
			"根据食物名称、常见做法和重量估算每100g营养，不需要重新判断重量。",
			"只返回 JSON，不要解释。",
			"输出字段使用 camelCase。",
			"所有字段必须为数字；不要因为不确定就把热量或宏量营养填 0，只有白水、无糖茶、黑咖啡等天然接近 0 时才可接近 0。",
			"如果名称包含清炒、清蒸、炖、红烧、油麦菜、青菜、蔬菜等信息，请按常见熟制菜估算，不要误判成肉类或补剂。",
			"热量单位 kcal，其余 protein/carbs/fat/fiber/sugar 单位 g。",
			"热量必须与宏量营养基本自洽：calories 不应低于 protein*4 + carbs*4 + fat*9 太多。",
			"每100g 的 protein/carbs/fat/fiber/sugar/saturatedFat 不得为负，也不得超过 100g；sugar 不得超过 carbs，saturatedFat 不得超过 fat。",
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
	bytes, _ := json.Marshal(userPrompt)
	prompt := "你是营养数据库补全助手。请用常见营养数据库口径保守估算，避免 0 营养和宏量不闭合。\n" + string(bytes)
	parsed, err := e.client.Analyze(ctx, prompt, "")
	if err != nil {
		return nil, err
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
