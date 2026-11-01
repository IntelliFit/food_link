package service

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"food_link/backend/pkg/logger"
)

// campusBudgetService creates a request-local view of the immutable service
// configuration. Never mutate the shared service: other food-analysis callers
// retain their existing model selection and concurrent fallback behavior.
func (s *AnalyzeService) campusBudgetService(ctx context.Context) (*AnalyzeService, error) {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("CAMPUS_A6_DEEPSEEK_ENABLED")), "true") {
		if s == nil || strings.TrimSpace(os.Getenv("CAMPUS_A6_DEEPSEEK_API_KEY")) == "" {
			return nil, fmt.Errorf("校园 A6 DeepSeek 独立凭证未配置，不回退其它付费渠道")
		}
		budget := *s
		budget.deepseek = newCampusDeepSeekEstimator(os.Getenv("CAMPUS_A6_DEEPSEEK_API_KEY"))
		budget.dashscopeClient = nil // Also prevents fast mode overriding DeepSeek.
		budget.nutritionAI = newChainedNutritionFallbackEstimator(namedNutritionFallbackEstimator{
			source: "deepseek_generated", estimator: budget.deepseek, timeout: nutritionFallbackAttemptTimeout,
		})
		return &budget, nil
	}
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
	if campusUsesDeepSeek(budget) {
		// Pro is text-only. Estimate the named catalog dish, never pretend to
		// have inspected the attached photo or silently call a costly vision API.
		if strings.TrimSpace(input.Text) == "" {
			if !strings.Contains(input.AdditionalContext, "菜品名称：") {
				return nil, fmt.Errorf("DeepSeek 不支持图片识别，需提供校园菜品名称")
			}
			input.Text = input.AdditionalContext
		}
		input.ImageURL, input.Base64Image, input.ImageURLs = "", "", nil
		result, err := runCampusDeepSeekText(ctx, budget, userID, input)
		if err == nil {
			result["campus_image_analysis_skipped"] = true
			result["campus_analysis_basis"] = "catalog_text_only"
		}
		return result, err
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
	if campusUsesDeepSeek(budget) {
		return runCampusDeepSeekText(ctx, budget, userID, input)
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
	if campusUsesDeepSeek(budget) {
		ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
		defer cancel()
		logger.Info(ctx, "校园营养补全使用 A6 DeepSeek 单模型", slog.String("model", campusA6DeepSeekModel), slog.Int("item_count", len(items)))
		enriched, err := budget.ApplyPreciseMicronutrientsToResolvedItems(ctx, items, additionalContext)
		if err != nil {
			return nil, err
		}
		return normalizeCampusAIEnergy(enriched)
	}
	logger.Info(ctx, "校园营养补全使用千问单模型", slog.String("model", qwen38FlashModel), slog.Int("item_count", len(items)))
	return budget.ApplyPreciseMicronutrientsToResolvedItems(ctx, items, additionalContext)
}

func campusUsesDeepSeek(s *AnalyzeService) bool {
	return s != nil && s.deepseek != nil && s.deepseek.Model == campusA6DeepSeekModel
}

func runCampusDeepSeekText(ctx context.Context, budget *AnalyzeService, userID string, input AnalyzeInput) (map[string]any, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	input.ModelName = campusA6DeepSeekModel
	logger.Info(ctx, "校园文字分析使用 A6 DeepSeek", slog.String("model", campusA6DeepSeekModel))
	result, err := budget.AnalyzeText(ctx, userID, input)
	if err != nil {
		return nil, err
	}
	items, err := normalizeCampusAIEnergy(toItems(result["items"]))
	if err != nil {
		return nil, err
	}
	result["items"] = items
	return result, nil
}
