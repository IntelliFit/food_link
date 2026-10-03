package service

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"time"

	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
)

const relayGemini37FlashModel = "gemini-3.7-flash"

func validateBalancedFoodPayload(parsed map[string]any) error {
	if err := validateNonEmptyFoodAnalysisResult(parsed); err != nil {
		return err
	}
	for _, item := range toItems(parsed["items"]) {
		if firstNonNil(item["estimatedWeightGrams"], item["weight"], item["estimated_weight_g"]) == nil {
			return ErrEmptyFoodAnalysisResult
		}
	}
	return nil
}

// Planning can legitimately ask for clarification instead of estimating food.
// Estimation must contain named items with usable weights, not an arbitrary JSON
// wrapper around a provider retirement notice or coding-assistant introduction.
func validateBalancedPrecisionPayload(parsed map[string]any) error {
	status := stringFromAny(parsed["precisionStatus"])
	if status == "needs_user_input" || status == "needs_retake" {
		if len(anyListFromAny(parsed["questions"])) > 0 || len(anyListFromAny(parsed["retakeRequirements"])) > 0 || len(anyListFromAny(parsed["pendingRequirements"])) > 0 {
			return nil
		}
	}
	if status == "ready_for_estimate" {
		items := anyListFromAny(parsed["itemsToEstimate"])
		if len(items) > 0 {
			for _, item := range items {
				m := mapFromAny(item)
				if stringFromAny(firstNonNil(m["item_name"], m["name"])) == "" {
					return ErrEmptyFoodAnalysisResult
				}
			}
			return nil
		}
	}
	if item := mapFromAny(parsed["item"]); len(item) > 0 {
		return validateBalancedFoodPayload(map[string]any{"items": []any{item}})
	}
	return validateBalancedFoodPayload(parsed)
}

func (s *AnalyzeService) balancedVisionEnabled() bool {
	return s.visionChannels != nil && s.visionChannels.config.BalancedRoutingEnabled
}

func (s *AnalyzeService) balancedVisionApplies(ctx context.Context, model string) bool {
	if !s.balancedVisionEnabled() {
		return false
	}
	req, ok := ctx.Value(visionRequestKey{}).(*visionRequest)
	if !ok || !(isOrdinaryFoodImageMode(req.mode) || isPrecisionLikeExecutionMode(req.mode) || isGemini35ExecutionMode(req.mode)) {
		return false
	}
	return model == gemini3FlashModel || model == gemini35FlashModel || model == precisionGeminiFlashModel || model == relayGemini37FlashModel
}

// Every available channel receives one initial slot. Health checks are applied
// at call time; they do not change the deterministic task/session assignment.
func (s *AnalyzeService) balancedVisionPlans(precision bool) []channelPlan {
	wModel, relayModel := gemini3FlashModel, gemini3FlashModel
	wClient, luxClient := s.ofoxAIClient, s.openLuxGemini3Client
	if precision {
		wModel, relayModel = gemini35FlashModel, relayGemini37FlashModel
		wClient, luxClient = s.gemini35Client, s.openLuxPrecisionGeminiClient
	}
	plans := []channelPlan{}
	for _, p := range []channelPlan{{wClient, geminiPrimaryUpstream, wModel}, {luxClient, geminiOpenLuxUpstream, relayModel}, {s.visionChannels.a6, geminiA6Upstream, relayModel}} {
		if p.client != nil {
			plans = append(plans, p)
		}
	}
	return plans
}

func (s *AnalyzeService) selectBalancedVisionModel(mode, routingKey string) string {
	plans := s.balancedVisionPlans(isPrecisionLikeExecutionMode(mode) || isGemini35ExecutionMode(mode))
	if len(plans) == 0 {
		if isPrecisionLikeExecutionMode(mode) || isGemini35ExecutionMode(mode) {
			return gemini35FlashModel
		}
		return gemini3FlashModel
	}
	h := fnv.New32a()
	_, _ = h.Write([]byte(mode + "\x00" + routingKey))
	p := plans[int(h.Sum32()%uint32(len(plans)))]
	return geminiRouteName(p.model, p.upstream)
}

// Non-streaming calls have no meaningful first-token signal. An attempt must
// finish AND pass the caller's business validation within the response budget.
// Cancel the expired attempt before contacting another channel; never shadow,
// retry the same channel, or silently downgrade to a domestic/Lite model.
func (s *AnalyzeService) runBalancedGeminiVision(ctx context.Context, stage, primaryUpstream, primaryModel, prompt string, imageURLs []string, temperature float64, validate func(map[string]any) error) (geminiVisionHedgeOutcome, error) {
	r := s.visionChannels
	req, _ := ctx.Value(visionRequestKey{}).(*visionRequest)
	if req == nil {
		req = &visionRequest{mode: stage}
	}
	plans := s.balancedVisionPlans(primaryModel != gemini3FlashModel)
	// Start with the assigned channel, then prefer the cheaper remaining one.
	ordered := make([]channelPlan, 0, len(plans))
	for _, p := range plans {
		if p.upstream == primaryUpstream {
			ordered = append(ordered, p)
		}
	}
	for _, upstream := range []string{geminiA6Upstream, geminiOpenLuxUpstream, geminiPrimaryUpstream} {
		for _, p := range plans {
			if p.upstream == upstream && p.upstream != primaryUpstream {
				ordered = append(ordered, p)
			}
		}
	}
	outcome := geminiVisionHedgeOutcome{upstream: primaryUpstream, model: primaryModel, primaryUpstream: primaryUpstream, primaryModel: primaryModel}
	var failures []error
	started := 0
	for _, p := range ordered {
		if ctx.Err() != nil {
			return outcome, ctx.Err()
		}
		key := channelKey(req.mode, p.upstream, p.model)
		if !r.acquire(key, time.Now()) {
			logVisionChannelSkip(ctx, req, stage, p.upstream, p.model, "circuit_open", false)
			continue
		}
		started++
		wait := time.Duration(r.config.ResponseWaitSeconds) * time.Second
		logger.Info(ctx, "餐照渠道串行请求启动", slog.String("task_id", req.taskID), slog.String("execution_mode", req.mode),
			slog.String("stage", stage), slog.String("upstream", p.upstream), slog.String("model", p.model), slog.Int("attempt", started), slog.Duration("response_wait", wait))
		attemptCtx, cancel := context.WithTimeout(ctx, wait)
		u := &visionUsage{}
		attemptCtx = context.WithValue(attemptCtx, visionUsageKey{}, u)
		start := time.Now()
		call := newAnalyzeWithImagesTemperatureModelCall(p.client, prompt, imageURLs, temperature, p.model)
		parsed, err := call(attemptCtx)
		if err == nil && validate != nil {
			err = validate(parsed)
		}
		if err == nil {
			if primaryModel == gemini3FlashModel {
				err = validateBalancedFoodPayload(parsed)
			} else {
				err = validateBalancedPrecisionPayload(parsed)
			}
		}
		// Reject a late completion, even if the HTTP client returned no error.
		if err == nil {
			err = attemptCtx.Err()
		}
		cancel()
		duration := time.Since(start)
		if r.record(key, duration, err, time.Now()) {
			logger.Warn(ctx, "餐照渠道已临时熔断", slog.String("upstream", p.upstream), slog.String("model", p.model), slog.String("execution_mode", req.mode))
		}
		status := visionChannelStatus(err)
		metrics.ObserveVisionChannel(ctx, req.mode, stage, p.upstream, p.model, status, false, duration, u.input, u.output)
		logger.Info(ctx, "餐照渠道串行请求完成", slog.String("task_id", req.taskID), slog.String("execution_mode", req.mode),
			slog.String("stage", stage), slog.String("upstream", p.upstream), slog.String("model", p.model), slog.String("status", status),
			slog.Int64("duration_ms", duration.Milliseconds()), slog.Int("attempt", started), slog.Int64("input_tokens", u.input), slog.Int64("output_tokens", u.output))
		if err == nil {
			outcome.parsed, outcome.client, outcome.upstream, outcome.model = parsed, p.client, p.upstream, p.model
			outcome.alternateWon = p.upstream != primaryUpstream
			return outcome, nil
		}
		failures = append(failures, err)
		if p.upstream == primaryUpstream {
			outcome.primaryError = err
		} else {
			outcome.alternateError = err
		}
		// Do not log upstream response bodies: they may echo private input.
		logger.Warn(ctx, "餐照渠道未返回有效结果，切换其他渠道", slog.String("task_id", req.taskID), slog.String("upstream", p.upstream),
			slog.String("model", p.model), slog.String("status", status), slog.Int("attempt", started))
	}
	if len(failures) == 0 {
		return outcome, fmt.Errorf("Gemini 所有已配置渠道处于熔断或不可用状态")
	}
	return outcome, fmt.Errorf("Gemini 三渠道未返回有效识别结果: %w", errors.Join(failures...))
}
