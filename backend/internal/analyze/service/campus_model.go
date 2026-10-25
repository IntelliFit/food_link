package service

import (
	"context"
	"fmt"
	"log/slog"

	"food_link/backend/pkg/logger"
)

// campusBudgetService creates a request-local view of the immutable service
// configuration. Never mutate the shared service: other food-analysis callers
// retain their existing model selection and concurrent fallback behavior.
func (s *AnalyzeService) campusBudgetService(ctx context.Context) (*AnalyzeService, error) {
	if s == nil || s.dashscopeClient == nil {
		logger.Warn(ctx, "校园低成本分析未配置千问，未转用高价模型")
		return nil, fmt.Errorf("校园千问分析客户端未配置")
	}
	budget := *s
	budget.deepseek = nil
	budget.nutritionAI = newChainedNutritionFallbackEstimator(namedNutritionFallbackEstimator{
		source: "qwen_generated", estimator: NewQwenNutritionEstimator(s.dashscopeClient), timeout: nutritionFallbackAttemptTimeout,
	})
	return &budget, nil
}

// AnalyzeCampus is used only for normal campus catalog image tasks.
func (s *AnalyzeService) AnalyzeCampus(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	budget, err := s.campusBudgetService(ctx)
	if err != nil {
		return nil, err
	}
	input.ModelName = qwen38FlashModel
	logger.Info(ctx, "校园图片分析使用千问低成本路由", slog.String("model", qwen38FlashModel))
	return budget.Analyze(ctx, userID, input)
}

// AnalyzeCampusText prevents an unspecified campus model from inheriting the
// shared Gemini default or launching a concurrent DeepSeek nutrition estimate.
func (s *AnalyzeService) AnalyzeCampusText(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	budget, err := s.campusBudgetService(ctx)
	if err != nil {
		return nil, err
	}
	input.ModelName = qwen38FlashModel
	logger.Info(ctx, "校园文字分析使用千问低成本路由", slog.String("model", qwen38FlashModel))
	return budget.AnalyzeText(ctx, userID, input)
}

// ApplyCampusPreciseMicronutrientsToResolvedItems retains the existing food
// state, per-100g, 4/4/9 and 21-field validation gates. Only its estimator cohort
// differs: one Qwen model, no simultaneous Pro or Gemini nutrition requests.
func (s *AnalyzeService) ApplyCampusPreciseMicronutrientsToResolvedItems(ctx context.Context, items []map[string]any, additionalContext string) ([]map[string]any, error) {
	budget, err := s.campusBudgetService(ctx)
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "校园营养补全使用千问单模型", slog.String("model", qwen38FlashModel), slog.Int("item_count", len(items)))
	return budget.ApplyPreciseMicronutrientsToResolvedItems(ctx, items, additionalContext)
}
