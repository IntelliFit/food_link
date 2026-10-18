package service

import (
	"context"
	"fmt"
	"log/slog"

	"food_link/backend/pkg/logger"
)

// Text-mode evaluation (2026-10-18, 40 recent production inputs plus 18 weighed
// dataset labels): Gemini 3 Flash on the ordinary channel order answered in
// 5.6s p50 / 16.4s p90 with no failures. Qwen 3.8 with thinking took 54.9s p50
// and timed out on 10 of 58; on inputs with explicit weights Gemini's calories
// differed from it by 3.4% p50. Qwen 3.8 without thinking (20.6s p50) is kept
// only as the fallback because its tail misread per-100g values (p90 67%).

// textDefaultGeminiAvailable reports whether the default text route can reach
// at least one Gemini channel.
func (s *AnalyzeService) textDefaultGeminiAvailable() bool {
	return s.visionChannels != nil && len(s.balancedVisionPlans(false)) > 0
}

// runDefaultTextModel runs the default (no explicit model) text analysis on the
// fastest healthy Gemini channel, then falls back to Qwen 3.8 without thinking.
// validate must normalize and check the text result shape; a result that fails
// it moves on to the next channel.
func (s *AnalyzeService) runDefaultTextModel(ctx context.Context, prompt string, schema map[string]any, validate func(map[string]any) error) (map[string]any, string, string, error) {
	var geminiErr error
	if s.textDefaultGeminiAvailable() {
		outcome, err := s.runBalancedGeminiChannels(ctx, "food_text", geminiOpenLuxUpstream, gemini3FlashModel, prompt, nil, 0, validate, nil)
		if err == nil {
			return outcome.parsed, "gemini", outcome.model, nil
		}
		geminiErr = err
		logger.Warn(ctx, "文字食物 Gemini 渠道均未返回有效结果，回退千问", logger.Err(err))
	}
	if s.dashscopeClient == nil {
		if geminiErr != nil {
			return nil, "gemini", gemini3FlashModel, geminiErr
		}
		return nil, "", "", fmt.Errorf("文字输入模式大模型未配置")
	}
	var raw map[string]any
	var err error
	if qwen, ok := s.dashscopeClient.(interface {
		AnalyzeTextWithJSONSchemaWithoutThinking(context.Context, string, string, map[string]any) (map[string]any, error)
	}); ok {
		raw, err = qwen.AnalyzeTextWithJSONSchemaWithoutThinking(ctx, prompt, qwen38FlashModel, schema)
	} else {
		raw, err = newAnalyzeWithImagesWithoutThinkingModelCall(s.dashscopeClient, prompt, nil, qwen38FlashModel)(ctx)
	}
	if err == nil && validate != nil {
		err = validate(raw)
	}
	if err != nil {
		logger.Warn(ctx, "文字食物千问回退失败", slog.String("model", qwen38FlashModel), logger.Err(err))
	}
	return raw, "qwen", qwen38FlashModel, err
}
