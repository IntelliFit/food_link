package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"food_link/backend/pkg/logger"
)

// Precision photos can run the one-call ordinary flow instead of the split
// plan/estimate/aggregate pipeline. 2026-11-26 paired eval on 31 weighed
// photos: ordinary flow on A6 gemini-4-hydrogen median weight error 15.6% vs
// the split pipeline on Gemini 3.6 19.9%, with far fewer misses over 50%.
const (
	precisionFlowLegacy   = "legacy"
	precisionFlowOrdinary = "ordinary"

	defaultPrecisionOrdinaryModel = "gemini-4-hydrogen"
	// The lead model's p90 was 32s on single photos and 89s on a crowded tray;
	// after this wait the ordinary Gemini 3.6 channels race it.
	defaultPrecisionOrdinaryHedge = 45 * time.Second

	// Gemini 4 models think longer on crowded trays; 8192 output tokens
	// truncated 3 of 66 eval calls.
	geminiLargeOutputTokens = 16384
)

type precisionOrdinaryKey struct{}

func (s *AnalyzeService) precisionOrdinaryEnabled() bool {
	return s.visionChannels != nil && s.visionChannels.a6 != nil &&
		strings.EqualFold(strings.TrimSpace(s.visionChannels.config.PrecisionFlow), precisionFlowOrdinary)
}

func (s *AnalyzeService) precisionOrdinaryModel() string {
	if s.visionChannels != nil {
		if model := strings.TrimSpace(s.visionChannels.config.PrecisionOrdinaryModel); model != "" {
			return model
		}
	}
	return defaultPrecisionOrdinaryModel
}

func (s *AnalyzeService) precisionOrdinaryHedge() time.Duration {
	if s.visionChannels != nil && s.visionChannels.config.PrecisionOrdinaryHedgeSeconds > 0 {
		return time.Duration(s.visionChannels.config.PrecisionOrdinaryHedgeSeconds) * time.Second
	}
	return defaultPrecisionOrdinaryHedge
}

// precisionOrdinaryLead is the channel that leads a precision photo running
// the ordinary flow; the ordinary channels follow it as fallbacks.
func (s *AnalyzeService) precisionOrdinaryLead(ctx context.Context, image bool) (channelPlan, bool) {
	if !image || ctx.Value(precisionOrdinaryKey{}) == nil || s.visionChannels == nil || s.visionChannels.a6 == nil {
		return channelPlan{}, false
	}
	return channelPlan{client: s.visionChannels.a6, upstream: geminiA6Upstream, model: s.precisionOrdinaryModel()}, true
}

// analyzePrecisionViaOrdinary runs a precision photo through the ordinary
// one-call flow with the precision model leading and the ordinary channels
// behind it. If the whole ordinary flow fails, the legacy precision analysis
// still answers, so the switch never leaves a user without a result.
func (s *AnalyzeService) analyzePrecisionViaOrdinary(ctx context.Context, userID string, input AnalyzeInput) (map[string]any, error) {
	mode := defaultExecutionMode
	ordinary := input
	ordinary.ExecutionMode = &mode
	ordinary.ModelName = ""
	ordinary.PrecisionFlow = ""
	taskID := foodImageModelRoutingKey(userID, input)
	if req, ok := ctx.Value(visionRequestKey{}).(*visionRequest); ok && req.taskID != "" {
		taskID = req.taskID
	}
	ordinaryCtx := context.WithValue(WithVisionRequest(ctx, mode, taskID, false), precisionOrdinaryKey{}, true)
	resp, err := s.Analyze(ordinaryCtx, userID, ordinary)
	if err == nil {
		resp["precision_flow"] = precisionFlowOrdinary
		return resp, nil
	}
	logger.Warn(ctx, "精准模式普通流程失败，退回原精准识别", slog.String("task_id", taskID), logger.Err(err))
	legacy := input
	legacy.PrecisionFlow = ""
	resp, legacyErr := s.Analyze(ctx, userID, legacy)
	if legacyErr != nil {
		return nil, legacyErr
	}
	resp["precision_flow"] = "legacy_fallback"
	return resp, nil
}

// geminiBodyForModel raises the output budget for Gemini 4 models on an
// already prepared native request body.
func geminiBodyForModel(model string, body []byte) []byte {
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "gemini-4-") {
		return body
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		return body
	}
	generation, ok := decoded["generationConfig"].(map[string]any)
	if !ok {
		return body
	}
	generation["maxOutputTokens"] = geminiLargeOutputTokens
	out, err := json.Marshal(decoded)
	if err != nil {
		return body
	}
	return out
}
