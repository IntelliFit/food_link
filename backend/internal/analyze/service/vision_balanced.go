package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"time"

	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
)

const relayGemini37FlashModel = "gemini-3.7-flash"

// Channel priority follows 14-day production metrics (2026-10-18). Ordinary
// Gemini 3 Flash: OpenLux failed 3% with p50 9.5s, A6 failed 12% with p50
// 9.6s, Wanjie failed 10% with p50 24.3s. Precision: Wanjie Gemini 3.5 never
// failed (p50 17s), OpenLux 3.7 failed 9% (p50 15s), A6 3.7 failed 42%.
var (
	balancedOrdinaryPriority  = []string{geminiOpenLuxUpstream, geminiA6Upstream, geminiPrimaryUpstream}
	balancedPrecisionPriority = []string{geminiPrimaryUpstream, geminiOpenLuxUpstream, geminiA6Upstream}
)

// Hedge delays sit near the leading channel's p75 latency, so roughly one call
// in four pays for a second channel. Vars so tests can shorten them.
var (
	balancedHedgeDelayOrdinary  = 15 * time.Second
	balancedHedgeDelayPrecision = 22 * time.Second
	balancedHedgeDelayMin       = 8 * time.Second
	balancedHedgeDelayMax       = 25 * time.Second
)

// channelPrior is the 14-day production baseline (2026-10-18) used until a
// channel has enough recent samples: valid-response p50 and failure rate.
type channelPrior struct {
	latency     time.Duration
	failureRate float64
}

var (
	balancedOrdinaryPriors = map[string]channelPrior{
		geminiOpenLuxUpstream: {9500 * time.Millisecond, 0.03},
		geminiA6Upstream:      {9600 * time.Millisecond, 0.12},
		geminiPrimaryUpstream: {24300 * time.Millisecond, 0.10},
	}
	balancedPrecisionPriors = map[string]channelPrior{
		geminiPrimaryUpstream: {17100 * time.Millisecond, 0},
		geminiOpenLuxUpstream: {15100 * time.Millisecond, 0.09},
		geminiA6Upstream:      {11300 * time.Millisecond, 0.42},
	}
)

const (
	// balancedFailurePenalty approximates what a failed attempt costs: the wait
	// before switching plus the next channel's answer.
	balancedFailurePenalty       = 25 * time.Second
	balancedLatencyMinSample     = 3
	balancedHealthWindow         = 5 * time.Minute
	balancedHealthMinSamples     = 5
	balancedUnhealthyFailureRate = 0.2
	balancedAdaptiveMinSamples   = 20
)

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

// balancedVisionPlans lists every configured channel with its model mapping.
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

// orderedBalancedPlans puts recently healthy channels first, each group in the
// measured priority order, so a channel that starts failing stops taking the
// lead within minutes and gets it back once its samples recover.
func (s *AnalyzeService) orderedBalancedPlans(mode string, precision bool) []channelPlan {
	plans := s.balancedVisionPlans(precision)
	priority := balancedOrdinaryPriority
	if precision {
		priority = balancedPrecisionPriority
	}
	rank := func(upstream string) int {
		for index, candidate := range priority {
			if candidate == upstream {
				return index
			}
		}
		return len(priority)
	}
	priors := balancedOrdinaryPriors
	if precision {
		priors = balancedPrecisionPriors
	}
	now := time.Now()
	healthy := make(map[string]bool, len(plans))
	score := make(map[string]time.Duration, len(plans))
	for _, p := range plans {
		key := channelKey(mode, p.upstream, p.model)
		healthy[p.upstream] = s.visionChannels.recentlyHealthy(key, now)
		score[p.upstream] = s.visionChannels.expectedTimeToValid(key, priors[p.upstream], now)
	}
	sort.SliceStable(plans, func(i, j int) bool {
		a, b := plans[i].upstream, plans[j].upstream
		if healthy[a] != healthy[b] {
			return healthy[a]
		}
		if score[a] != score[b] {
			return score[a] < score[b]
		}
		return rank(a) < rank(b)
	})
	return plans
}

// expectedTimeToValid estimates how long the channel takes to deliver a usable
// answer: its recent latency plus failures weighted by the cost of switching.
// Attempts abandoned to a faster channel count with the time they had already
// spent, so a channel that turns slow without failing loses the lead within a
// few calls. Too few recent samples fall back to the production prior.
func (r *visionChannelRouter) expectedTimeToValid(key string, prior channelPrior, now time.Time) time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	h := r.health[key]
	latencies := []time.Duration{}
	valid, failed := 0, 0
	if h != nil {
		for _, sample := range h.samples {
			if now.Sub(sample.at) >= balancedHealthWindow {
				continue
			}
			if sample.valid {
				valid++
				latencies = append(latencies, sample.duration)
			} else {
				failed++
			}
		}
		for _, sample := range h.abandoned {
			if now.Sub(sample.at) < balancedHealthWindow {
				latencies = append(latencies, sample.duration)
			}
		}
	}
	if len(latencies)+failed < balancedLatencyMinSample {
		return prior.latency + time.Duration(prior.failureRate*float64(balancedFailurePenalty))
	}
	latency := prior.latency
	if len(latencies) > 0 {
		sort.Slice(latencies, func(i, j int) bool { return latencies[i] < latencies[j] })
		latency = latencies[len(latencies)/2]
	}
	failureRate := 0.0
	if valid+failed > 0 {
		failureRate = float64(failed) / float64(valid+failed)
	}
	return latency + time.Duration(failureRate*float64(balancedFailurePenalty))
}

// recentlyHealthy reports whether a channel may lead: its circuit is closed and
// at most balancedUnhealthyFailureRate of its recent attempts failed.
func (r *visionChannelRouter) recentlyHealthy(key string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	h := r.health[key]
	if h == nil {
		return true
	}
	if now.Before(h.openUntil) {
		return false
	}
	total, failed := 0, 0
	for _, sample := range h.samples {
		if now.Sub(sample.at) >= balancedHealthWindow {
			continue
		}
		total++
		if !sample.valid {
			failed++
		}
	}
	return total < balancedHealthMinSamples || float64(failed)/float64(total) <= balancedUnhealthyFailureRate
}

// balancedHedgeDelay uses the channel's own recent p75 once enough valid samples
// exist, bounded so a slow period cannot push the hedge out indefinitely.
func (r *visionChannelRouter) balancedHedgeDelay(key string, fallback time.Duration, now time.Time) time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	values := []time.Duration{}
	if h := r.health[key]; h != nil {
		for _, sample := range h.samples {
			if sample.valid && now.Sub(sample.at) < balancedHealthWindow {
				values = append(values, sample.duration)
			}
		}
	}
	if len(values) < balancedAdaptiveMinSamples {
		return fallback
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	delay := values[int(math.Ceil(float64(len(values))*0.75))-1]
	if delay < balancedHedgeDelayMin {
		return balancedHedgeDelayMin
	}
	if delay > balancedHedgeDelayMax {
		return balancedHedgeDelayMax
	}
	return delay
}

// selectBalancedVisionModel picks the channel that currently leads the priority
// order. The routing key no longer splits traffic evenly: an even split pinned a
// third of users to the slowest channel.
func (s *AnalyzeService) selectBalancedVisionModel(mode, _ string) string {
	precision := isPrecisionLikeExecutionMode(mode) || isGemini35ExecutionMode(mode)
	plans := s.orderedBalancedPlans(mode, precision)
	if len(plans) == 0 {
		if precision {
			return gemini35FlashModel
		}
		return gemini3FlashModel
	}
	return geminiRouteName(plans[0].model, plans[0].upstream)
}

// runBalancedGeminiVision starts the leading channel and hedges to the next one
// when the leader fails or exceeds its hedge delay. The first response that
// passes business validation wins and the others are cancelled. It never
// retries the same channel or downgrades to a domestic/Lite model.
func (s *AnalyzeService) runBalancedGeminiVision(ctx context.Context, stage, primaryUpstream, primaryModel, prompt string, imageURLs []string, temperature float64, validate func(map[string]any) error) (geminiVisionHedgeOutcome, error) {
	payloadCheck := validateBalancedFoodPayload
	if primaryModel != gemini3FlashModel {
		payloadCheck = validateBalancedPrecisionPayload
	}
	return s.runBalancedGeminiChannels(ctx, stage, primaryUpstream, primaryModel, prompt, imageURLs, temperature, validate, payloadCheck)
}

// runBalancedGeminiChannels is the shared channel scheduler. payloadCheck is the
// caller's shape gate applied after validate; text analysis passes nil because
// its validator already normalizes and checks the text result shape.
func (s *AnalyzeService) runBalancedGeminiChannels(ctx context.Context, stage, primaryUpstream, primaryModel, prompt string, imageURLs []string, temperature float64, validate, payloadCheck func(map[string]any) error) (geminiVisionHedgeOutcome, error) {
	r := s.visionChannels
	req, _ := ctx.Value(visionRequestKey{}).(*visionRequest)
	if req == nil {
		req = &visionRequest{mode: stage}
	}
	precision := primaryModel != gemini3FlashModel
	fallbackDelay := balancedHedgeDelayOrdinary
	if precision {
		fallbackDelay = balancedHedgeDelayPrecision
	}
	plans := s.orderedBalancedPlans(req.mode, precision)
	wait := time.Duration(r.config.ResponseWaitSeconds) * time.Second
	outcome := geminiVisionHedgeOutcome{upstream: primaryUpstream, model: primaryModel, primaryUpstream: primaryUpstream, primaryModel: primaryModel}
	hedgeCtx, cancelAll := context.WithCancel(ctx)
	defer cancelAll()
	results := make(chan channelResult, len(plans))
	next, pending, started := 0, 0, 0
	leadUpstream := ""
	var failures []error
	timer := time.NewTimer(time.Hour)
	defer timer.Stop()
	launch := func(reason string) bool {
		for next < len(plans) {
			p := plans[next]
			next++
			key := channelKey(req.mode, p.upstream, p.model)
			if !r.acquire(key, time.Now()) {
				logVisionChannelSkip(ctx, req, stage, p.upstream, p.model, "circuit_open", false)
				continue
			}
			started++
			pending++
			if leadUpstream == "" {
				leadUpstream = p.upstream
				outcome.primaryUpstream, outcome.primaryModel = p.upstream, p.model
			}
			outcome.hedgeLaunched = started > 1
			logger.Info(ctx, "餐照渠道请求启动", slog.String("task_id", req.taskID), slog.String("execution_mode", req.mode),
				slog.String("stage", stage), slog.String("upstream", p.upstream), slog.String("model", p.model),
				slog.String("reason", reason), slog.Int("attempt", started), slog.Duration("response_wait", wait))
			go func() {
				results <- s.callBalancedVisionChannel(hedgeCtx, req, stage, p, key, wait, prompt, imageURLs, temperature, validate, payloadCheck)
			}()
			resetTimer(timer, r.balancedHedgeDelay(key, fallbackDelay, time.Now()))
			return true
		}
		return false
	}
	if !launch("priority") {
		return outcome, fmt.Errorf("Gemini 所有已配置渠道处于熔断或不可用状态")
	}
	for {
		select {
		case result := <-results:
			pending--
			if result.err == nil {
				cancelAll()
				outcome.parsed, outcome.client, outcome.upstream, outcome.model = result.parsed, result.plan.client, result.plan.upstream, result.plan.model
				outcome.alternateWon = result.plan.upstream != primaryUpstream
				logger.Info(ctx, "餐照渠道返回业务有效结果", slog.String("task_id", req.taskID), slog.String("execution_mode", req.mode),
					slog.String("upstream", outcome.upstream), slog.String("model", outcome.model), slog.Int("channel_count", started), slog.Bool("hedge_launched", outcome.hedgeLaunched))
				return outcome, nil
			}
			failures = append(failures, result.err)
			if result.plan.upstream == leadUpstream {
				outcome.primaryError = result.err
			} else {
				outcome.alternateError = result.err
			}
			// Do not log upstream response bodies: they may echo private input.
			logger.Warn(ctx, "餐照渠道未返回有效结果，切换其他渠道", slog.String("task_id", req.taskID), slog.String("upstream", result.plan.upstream),
				slog.String("model", result.plan.model), slog.String("status", visionChannelStatus(result.err)))
			launch("invalid_or_failed")
			if pending == 0 {
				return outcome, fmt.Errorf("Gemini 三渠道未返回有效识别结果: %w", errors.Join(failures...))
			}
		case <-timer.C:
			launch("hedge_delay_elapsed")
		case <-ctx.Done():
			return outcome, fmt.Errorf("Gemini 渠道调度达到总截止时间: %w", errors.Join(append(failures, ctx.Err())...))
		}
	}
}

// callBalancedVisionChannel runs one attempt with its own response budget and
// records the outcome for circuit breaking, hedge timing and metrics.
func (s *AnalyzeService) callBalancedVisionChannel(ctx context.Context, req *visionRequest, stage string, p channelPlan, key string, wait time.Duration, prompt string, imageURLs []string, temperature float64, validate, payloadCheck func(map[string]any) error) channelResult {
	attemptCtx, cancel := context.WithTimeout(ctx, wait)
	defer cancel()
	u := &visionUsage{}
	attemptCtx = context.WithValue(attemptCtx, visionUsageKey{}, u)
	start := time.Now()
	parsed, err := newAnalyzeWithImagesTemperatureModelCall(p.client, prompt, imageURLs, temperature, p.model)(attemptCtx)
	if err == nil && validate != nil {
		err = validate(parsed)
	}
	if err == nil && payloadCheck != nil {
		err = payloadCheck(parsed)
	}
	// Reject a late completion, even if the HTTP client returned no error.
	if err == nil {
		err = attemptCtx.Err()
	}
	duration := time.Since(start)
	if s.visionChannels.record(key, duration, err, time.Now()) {
		logger.Warn(ctx, "餐照渠道已临时熔断", slog.String("upstream", p.upstream), slog.String("model", p.model), slog.String("execution_mode", req.mode))
	}
	status := visionChannelStatus(err)
	metrics.ObserveVisionChannel(ctx, req.mode, stage, p.upstream, p.model, status, false, duration, u.input, u.output)
	logger.Info(ctx, "餐照渠道请求完成", slog.String("task_id", req.taskID), slog.String("execution_mode", req.mode),
		slog.String("stage", stage), slog.String("upstream", p.upstream), slog.String("model", p.model), slog.String("status", status), slog.Bool("shadow", false),
		slog.Int64("duration_ms", duration.Milliseconds()), slog.Int("image_count", len(imageURLs)), slog.Int("prompt_bytes", len(prompt)),
		slog.Int64("input_tokens", u.input), slog.Int64("output_tokens", u.output), slog.Bool("usage_reported", u.reported))
	return channelResult{plan: p, parsed: parsed, err: err, duration: duration}
}

func resetTimer(timer *time.Timer, delay time.Duration) {
	if !timer.Stop() {
		select {
		case <-timer.C:
		default:
		}
	}
	timer.Reset(delay)
}
