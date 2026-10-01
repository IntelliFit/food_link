package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
	apm "food_link/backend/pkg/trace"
	"go.opentelemetry.io/otel/attribute"
)

const geminiA6Upstream = "a6"

type visionRequestKey struct{}
type visionRequest struct {
	mode, taskID   string
	shadowEligible bool
	shadowStarted  atomic.Bool
}

// WithVisionRequest identifies real tasks without putting images or prompts in logs.
// One task can shadow at most one model stage, even when precision runs several rounds.
func WithVisionRequest(ctx context.Context, mode, taskID string, shadowEligible bool) context.Context {
	mode = normalizeExecutionMode(&mode)
	return context.WithValue(ctx, visionRequestKey{}, &visionRequest{mode: mode, taskID: taskID, shadowEligible: shadowEligible})
}

type channelSample struct {
	at       time.Time
	duration time.Duration
	valid    bool
}

type channelHealth struct {
	samples   []channelSample
	failures  int
	openUntil time.Time
	probe     bool
}

type visionChannelRouter struct {
	config      config.VisionRoutingConfig
	a6          LLMClient
	shadowSlots chan struct{}
	mu          sync.Mutex
	health      map[string]*channelHealth
}

func normalizeVisionRouting(c config.VisionRoutingConfig) config.VisionRoutingConfig {
	c.A6ShadowPercent = clampTrafficPercent(c.A6ShadowPercent)
	if c.ShadowMaxConcurrent <= 0 {
		c.ShadowMaxConcurrent = 2
	}
	if c.ShadowMaxConcurrent > 16 {
		c.ShadowMaxConcurrent = 16
	}
	if c.ShadowTimeoutSeconds <= 0 || c.ShadowTimeoutSeconds > 60 {
		c.ShadowTimeoutSeconds = 35
	}
	if c.HedgeMinSeconds <= 0 {
		c.HedgeMinSeconds = 3
	}
	if c.HedgeMaxSeconds < c.HedgeMinSeconds {
		c.HedgeMaxSeconds = c.HedgeMinSeconds + 3
	}
	if c.ThirdHedgeSeconds <= c.HedgeMaxSeconds {
		c.ThirdHedgeSeconds = c.HedgeMaxSeconds + 4
	}
	if c.OverallTimeoutSeconds <= c.ThirdHedgeSeconds || c.OverallTimeoutSeconds > 60 {
		c.OverallTimeoutSeconds = 35
	}
	if c.HedgeMinSeconds >= c.OverallTimeoutSeconds || c.ThirdHedgeSeconds >= c.OverallTimeoutSeconds {
		c.HedgeMinSeconds, c.HedgeMaxSeconds, c.ThirdHedgeSeconds = 3, 6, 10
	}
	if c.CircuitFailures <= 0 {
		c.CircuitFailures = 3
	}
	if c.CircuitCooldownSeconds <= 0 {
		c.CircuitCooldownSeconds = 60
	}
	c.A6ApprovedModels = append([]string(nil), c.A6ApprovedModels...)
	return c
}

func (s *AnalyzeService) ConfigureA6VisionRouting(apiKey, baseURL string, c config.VisionRoutingConfig) {
	c = normalizeVisionRouting(c)
	r := &visionChannelRouter{config: c, shadowSlots: make(chan struct{}, c.ShadowMaxConcurrent), health: make(map[string]*channelHealth)}
	if strings.TrimSpace(apiKey) != "" {
		baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
		if baseURL == "" {
			baseURL = "https://api.a6api.com"
		}
		r.a6 = NewOfoxAIClient(strings.TrimSpace(apiKey), gemini3FlashModel, baseURL)
	}
	s.visionChannels = r
	logger.Info(context.Background(), "餐照渠道调度已配置",
		slog.Bool("a6_configured", r.a6 != nil), slog.Int("a6_shadow_percent", c.A6ShadowPercent),
		slog.Bool("cost_routing_enabled", c.CostRoutingEnabled), slog.Any("a6_approved_models", c.A6ApprovedModels),
		slog.Bool("a6_independent_upstream", c.A6IndependentUpstream), slog.Int("shadow_max_concurrent", c.ShadowMaxConcurrent),
		slog.Int("hedge_min_seconds", c.HedgeMinSeconds), slog.Int("hedge_max_seconds", c.HedgeMaxSeconds),
		slog.Int("third_hedge_seconds", c.ThirdHedgeSeconds), slog.Int("overall_timeout_seconds", c.OverallTimeoutSeconds))
}

func (r *visionChannelRouter) approved(model string) bool {
	if !r.config.CostRoutingEnabled || !r.config.A6IndependentUpstream || r.a6 == nil {
		return false
	}
	for _, m := range r.config.A6ApprovedModels {
		if strings.TrimSpace(m) == model {
			return true
		}
	}
	return false
}

func channelKey(mode, upstream, model string) string {
	return mode + "\x00" + upstream + "\x00" + model
}

func (r *visionChannelRouter) state(key string) *channelHealth {
	h := r.health[key]
	if h == nil {
		h = &channelHealth{}
		r.health[key] = h
	}
	return h
}

func (r *visionChannelRouter) acquire(key string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	h := r.state(key)
	if h.openUntil.IsZero() {
		return true
	}
	if now.Before(h.openUntil) || h.probe {
		return false
	}
	h.probe = true
	return true
}

func (r *visionChannelRouter) record(key string, duration time.Duration, err error, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	h := r.state(key)
	h.probe = false
	// Losing a race is expected; it is neither a failure nor a fast success.
	if errors.Is(err, context.Canceled) {
		return false
	}
	samples := h.samples[:0]
	for _, sample := range h.samples {
		if now.Sub(sample.at) < 5*time.Minute {
			samples = append(samples, sample)
		}
	}
	h.samples = append(samples, channelSample{now, duration, err == nil})
	if len(h.samples) > 256 {
		h.samples = h.samples[len(h.samples)-256:]
	}
	if err == nil {
		h.failures = 0
		h.openUntil = time.Time{}
		return false
	}
	h.failures++
	failed := 0
	for _, sample := range h.samples {
		if !sample.valid {
			failed++
		}
	}
	if h.failures >= r.config.CircuitFailures || (len(h.samples) >= 20 && float64(failed)/float64(len(h.samples)) > 0.05) {
		h.openUntil = now.Add(time.Duration(r.config.CircuitCooldownSeconds) * time.Second)
		return true
	}
	return false
}

func (r *visionChannelRouter) hedgeDelay(key string) time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()
	low, high := time.Duration(r.config.HedgeMinSeconds)*time.Second, time.Duration(r.config.HedgeMaxSeconds)*time.Second
	values := []time.Duration{}
	for _, sample := range r.state(key).samples {
		if sample.valid && time.Since(sample.at) < 5*time.Minute {
			values = append(values, sample.duration)
		}
	}
	if len(values) < 20 {
		return high
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	delay := values[int(math.Ceil(float64(len(values))*0.75))-1]
	if delay < low {
		return low
	}
	if delay > high {
		return high
	}
	return delay
}

type channelPlan struct {
	client          LLMClient
	upstream, model string
}
type channelResult struct {
	plan     channelPlan
	parsed   map[string]any
	err      error
	duration time.Duration
}

func (s *AnalyzeService) runChannelGeminiVision(ctx context.Context, stage, primaryUpstream, primaryModel, prompt string, imageURLs []string, temperature float64, primaryClient LLMClient, validate func(map[string]any) error) (outcome geminiVisionHedgeOutcome, err error) {
	r := s.visionChannels
	req, _ := ctx.Value(visionRequestKey{}).(*visionRequest)
	if req == nil {
		req = &visionRequest{mode: stage}
	}
	plans := []channelPlan{{primaryClient, primaryUpstream, primaryModel}}
	alt, altUpstream, altModel := s.alternateGeminiClient(primaryModel, primaryUpstream)
	if alt != nil && alt != primaryClient {
		plans = append(plans, channelPlan{alt, altUpstream, altModel})
	}
	if r.approved(primaryModel) {
		plans = append([]channelPlan{{r.a6, geminiA6Upstream, primaryModel}}, plans...)
		// Cost order: A6, OpenLux, Wanjie. Existing precision model mappings travel with each channel.
		sort.SliceStable(plans, func(i, j int) bool {
			return visionChannelCostRank(plans[i].upstream) < visionChannelCostRank(plans[j].upstream)
		})
	}
	finishShadow := s.startVisionShadow(ctx, req, stage, primaryModel, prompt, imageURLs, temperature, validate, r.approved(primaryModel))
	defer func() { finishShadow(outcome, err) }()
	budget := time.Duration(r.config.OverallTimeoutSeconds) * time.Second
	hedgeCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	results := make(chan channelResult, len(plans))
	started, pending, next := 0, 0, 0
	var failures []error
	var firstValid *channelResult
	var reviewTimer *time.Timer
	var reviewDeadline <-chan time.Time
	defer func() {
		if reviewTimer != nil {
			reviewTimer.Stop()
		}
	}()
	outcome = geminiVisionHedgeOutcome{client: primaryClient, upstream: primaryUpstream, model: primaryModel}
	launchNext := func(reason string) bool {
		for next < len(plans) {
			plan := plans[next]
			next++
			if plan.client == nil {
				continue
			}
			if !r.acquire(channelKey(req.mode, plan.upstream, plan.model), time.Now()) {
				logVisionChannelSkip(ctx, req, stage, plan.upstream, plan.model, "circuit_open", false)
				continue
			}
			started++
			pending++
			if started == 1 {
				outcome.client, outcome.upstream, outcome.model = plan.client, plan.upstream, plan.model
			}
			outcome.hedgeLaunched = started > 1
			logger.Info(ctx, "餐照渠道请求启动", slog.String("task_id", req.taskID), slog.String("execution_mode", req.mode),
				slog.String("stage", stage), slog.String("upstream", plan.upstream), slog.String("model", plan.model), slog.String("reason", reason))
			go func() {
				results <- s.callVisionChannel(hedgeCtx, req, stage, plan, prompt, imageURLs, temperature, validate, false)
			}()
			return true
		}
		return false
	}
	if !launchNext("primary") {
		return outcome, fmt.Errorf("Gemini 所有已配置渠道处于熔断或不可用状态")
	}
	firstUpstream := outcome.upstream
	outcome.primaryUpstream, outcome.primaryModel = outcome.upstream, outcome.model
	accept := func(result channelResult) (geminiVisionHedgeOutcome, error) {
		outcome.parsed, outcome.client, outcome.upstream, outcome.model = result.parsed, result.plan.client, result.plan.upstream, result.plan.model
		outcome.alternateWon = result.plan.upstream != firstUpstream
		cancel()
		logger.Info(ctx, "餐照渠道返回业务有效结果", slog.String("task_id", req.taskID), slog.String("execution_mode", req.mode),
			slog.String("upstream", outcome.upstream), slog.String("model", outcome.model), slog.Int("channel_count", started), slog.Bool("hedge_launched", outcome.hedgeLaunched))
		return outcome, nil
	}
	delay := r.hedgeDelay(channelKey(req.mode, outcome.upstream, outcome.model))
	timer := time.NewTimer(delay)
	defer timer.Stop()
	third := time.NewTimer(time.Duration(r.config.ThirdHedgeSeconds) * time.Second)
	defer third.Stop()
	for {
		select {
		case result := <-results:
			pending--
			if result.err == nil {
				if firstValid != nil {
					markVisionReview(firstValid.parsed, result.parsed, result.plan.upstream, "completed")
					return accept(*firstValid)
				}
				if r.config.UncertainReviewEnabled && visionNeedsIdentityReview(result.parsed) {
					firstValid = &result
					if pending == 0 {
						launchNext("identity_uncertain")
					}
					if pending > 0 {
						reviewTimer = time.NewTimer(4 * time.Second)
						reviewDeadline = reviewTimer.C
						continue
					}
					markVisionReview(result.parsed, nil, "", "unavailable")
				}
				return accept(result)
			}
			failures = append(failures, result.err)
			if result.plan.upstream == firstUpstream {
				outcome.primaryError = result.err
			} else {
				outcome.alternateError = result.err
			}
			launchNext("invalid_or_failed")
			if pending == 0 {
				if firstValid != nil {
					markVisionReview(firstValid.parsed, nil, "", "unavailable")
					return accept(*firstValid)
				}
				return outcome, fmt.Errorf("Gemini 所有可用渠道均失败: %w", errors.Join(failures...))
			}
		case <-timer.C:
			launchNext("hedge_delay_elapsed")
		case <-third.C:
			launchNext("third_hedge_elapsed")
		case <-hedgeCtx.Done():
			if firstValid != nil && ctx.Err() == nil {
				markVisionReview(firstValid.parsed, nil, "", "timeout")
				return accept(*firstValid)
			}
			return outcome, fmt.Errorf("Gemini 渠道调度达到总截止时间: %w", errors.Join(append(failures, hedgeCtx.Err())...))
		case <-reviewDeadline:
			markVisionReview(firstValid.parsed, nil, "", "timeout")
			return accept(*firstValid)
		}
	}
}

func visionChannelCostRank(upstream string) int {
	switch upstream {
	case geminiA6Upstream:
		return 0
	case geminiOpenLuxUpstream:
		return 1
	default:
		return 2
	}
}

type visionUsageKey struct{}
type visionUsage struct {
	input, output int64
	reported      bool
}

func captureVisionUsage(ctx context.Context, raw map[string]any) {
	u, _ := ctx.Value(visionUsageKey{}).(*visionUsage)
	if u == nil {
		return
	}
	meta := extractChatCompletionUsageMeta(raw)
	if meta["total_tokens"] != nil || meta["input_tokens"] != nil || meta["prompt_tokens"] != nil {
		u.reported = true
		u.input += int64(numberFromAny(firstNonNil(meta["input_tokens"], meta["prompt_tokens"])))
		u.output += int64(numberFromAny(firstNonNil(meta["output_tokens"], meta["completion_tokens"])))
	}
}

func (s *AnalyzeService) callVisionChannel(ctx context.Context, req *visionRequest, stage string, plan channelPlan, prompt string, imageURLs []string, temperature float64, validate func(map[string]any) error, shadow bool) channelResult {
	start := time.Now()
	u := &visionUsage{}
	ctx = context.WithValue(ctx, visionUsageKey{}, u)
	timeout := s.geminiVisionTimeout(plan.upstream)
	if plan.upstream == geminiA6Upstream {
		timeout = time.Duration(s.visionChannels.config.ShadowTimeoutSeconds) * time.Second
	}
	parsed, err := tryGeminiVisionCall(ctx, stage, plan.upstream, plan.model, prompt, imageURLs, temperature, timeout, plan.client)
	if err == nil && validate != nil {
		err = validate(parsed)
	}
	duration := time.Since(start)
	status := visionChannelStatus(err)
	if s.visionChannels.record(channelKey(req.mode, plan.upstream, plan.model), duration, err, time.Now()) {
		logger.Warn(ctx, "餐照渠道已临时熔断", slog.String("execution_mode", req.mode), slog.String("upstream", plan.upstream), slog.String("model", plan.model))
	}
	metrics.ObserveVisionChannel(ctx, req.mode, stage, plan.upstream, plan.model, status, shadow, duration, u.input, u.output)
	logger.Info(ctx, "餐照渠道请求完成", slog.String("task_id", req.taskID), slog.String("execution_mode", req.mode), slog.String("stage", stage),
		slog.String("upstream", plan.upstream), slog.String("model", plan.model), slog.String("status", status), slog.Bool("shadow", shadow),
		slog.Int64("duration_ms", duration.Milliseconds()), slog.Int("image_count", len(imageURLs)), slog.Int("prompt_bytes", len(prompt)),
		slog.Int64("input_tokens", u.input), slog.Int64("output_tokens", u.output), slog.Bool("usage_reported", u.reported))
	return channelResult{plan, parsed, err, duration}
}

func visionChannelStatus(err error) string {
	if err == nil {
		return "valid"
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	if IsLLMJSONParseError(err) {
		return "invalid_json"
	}
	if errors.Is(err, ErrEmptyFoodAnalysisResult) {
		return "invalid_result"
	}
	if strings.Contains(err.Error(), "429") {
		return "rate_limited"
	}
	return "failed"
}

type visionComparison struct {
	upstream, model, status string
	items                   []map[string]any
}

func visionResultSummary(parsed map[string]any) []map[string]any {
	items := parseItems(parsed)
	if len(items) > 20 {
		items = items[:20]
	}
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, map[string]any{
			"name": visionSummaryName(stringFromAny(item["name"])), "weight_g": numberFromAny(item["estimatedWeightGrams"]),
			"confidence": numberFromAny(item["confidence"]),
		})
	}
	return out
}

func visionSummaryName(name string) string { return truncateRunes(name, 80) }

func visionNamesAgree(a, b []map[string]any) bool {
	if len(a) == 0 || len(a) != len(b) {
		return false
	}
	names := func(items []map[string]any) []string {
		out := []string{}
		for _, item := range items {
			out = append(out, strings.TrimSpace(stringFromAny(item["name"])))
		}
		sort.Strings(out)
		return out
	}
	return strings.Join(names(a), "\x00") == strings.Join(names(b), "\x00")
}

func (s *AnalyzeService) startVisionShadow(ctx context.Context, req *visionRequest, stage, model, prompt string, imageURLs []string, temperature float64, validate func(map[string]any) error, alreadyLive bool) func(geminiVisionHedgeOutcome, error) {
	r := s.visionChannels
	noop := func(geminiVisionHedgeOutcome, error) {}
	if ctx.Err() != nil || alreadyLive || r.a6 == nil || !req.shadowEligible || len(imageURLs) == 0 || !strings.HasPrefix(model, "gemini-") {
		return noop
	}
	fingerprint := sha256.Sum256([]byte(model + "\x00" + prompt + "\x00" + strings.Join(imageURLs, "\x00")))
	evaluationID := hex.EncodeToString(fingerprint[:12])
	if !stableTrafficHit("a6_shadow", req.taskID+evaluationID, r.config.A6ShadowPercent) || !req.shadowStarted.CompareAndSwap(false, true) {
		return noop
	}
	select {
	case r.shadowSlots <- struct{}{}:
	default:
		logVisionChannelSkip(ctx, req, stage, geminiA6Upstream, model, "concurrency_limit", true)
		return noop
	}
	if !r.acquire(channelKey(req.mode, geminiA6Upstream, model), time.Now()) {
		<-r.shadowSlots
		logVisionChannelSkip(ctx, req, stage, geminiA6Upstream, model, "circuit_open", true)
		return noop
	}
	baseline := make(chan visionComparison, 1)
	urls := append([]string(nil), imageURLs...)
	go func() {
		defer func() { <-r.shadowSlots }()
		shadowCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Duration(r.config.ShadowTimeoutSeconds)*time.Second)
		defer cancel()
		shadowCtx, span := apm.StartSpan(shadowCtx, "analysis.vision_shadow", attribute.String("analysis.evaluation_id", evaluationID))
		defer span.End()
		result := s.callVisionChannel(shadowCtx, req, stage, channelPlan{r.a6, geminiA6Upstream, model}, prompt, urls, temperature, validate, true)
		var base visionComparison
		// Main and shadow start together; a failed/fast shadow must not wait forever for the task.
		waitCtx, waitCancel := context.WithTimeout(context.WithoutCancel(ctx), 60*time.Second)
		defer waitCancel()
		select {
		case base = <-baseline:
		case <-waitCtx.Done():
			base.status = "baseline_unavailable"
		}
		items := visionResultSummary(result.parsed)
		agree := base.status == "valid" && result.err == nil && visionNamesAgree(base.items, items)
		comparison := "unavailable"
		if base.status == "valid" && result.err == nil {
			comparison = "disagree"
			if agree {
				comparison = "agree"
			}
			if base.model != model {
				comparison = "different_model"
			}
		}
		metrics.ObserveVisionComparison(shadowCtx, req.mode, model, comparison)
		logger.Info(shadowCtx, "A6 餐照影子评估完成", slog.String("task_id", req.taskID), slog.String("evaluation_id", evaluationID),
			slog.String("execution_mode", req.mode), slog.String("model", model), slog.String("stage", stage),
			slog.String("status", visionChannelStatus(result.err)), slog.Int64("duration_ms", result.duration.Milliseconds()),
			slog.String("baseline_status", base.status), slog.String("baseline_upstream", base.upstream), slog.String("baseline_model", base.model),
			slog.String("name_comparison", comparison), slog.Any("baseline_items", base.items), slog.Any("shadow_items", items))
	}()
	return func(outcome geminiVisionHedgeOutcome, err error) {
		baseline <- visionComparison{outcome.upstream, outcome.model, visionChannelStatus(err), visionResultSummary(outcome.parsed)}
	}
}

// Names/weights are schema gates, not a claim that visual identity is correct.
func validateVisionFoodPayload(parsed map[string]any) error {
	items := toItems(parsed["items"])
	if len(items) == 0 || len(items) > 100 {
		return ErrEmptyFoodAnalysisResult
	}
	if raw, ok := parsed["items"].([]any); ok && len(raw) != len(items) {
		return ErrEmptyFoodAnalysisResult
	}
	for _, item := range items {
		name := strings.TrimSpace(stringFromAny(item["name"]))
		if name == "" || name == "未知食物" {
			return ErrEmptyFoodAnalysisResult
		}
		if value := firstNonNil(item["estimatedWeightGrams"], item["weight"], item["estimated_weight_g"]); value != nil {
			weight := numberFromAny(value)
			if math.IsNaN(weight) || math.IsInf(weight, 0) || weight <= 0 || weight > 20000 {
				return ErrEmptyFoodAnalysisResult
			}
		}
	}
	return nil
}

func visionNeedsIdentityReview(parsed map[string]any) bool {
	for _, item := range toItems(parsed["items"]) {
		if value, exists := item["confidence"]; exists && numberFromAny(value) < 0.65 {
			return true
		}
		if len(toStringSlice(item["alternativeNames"])) > 0 {
			return true
		}
	}
	return false
}

func markVisionReview(parsed, review map[string]any, upstream, status string) {
	meta := map[string]any{"status": status, "review_upstream": upstream, "requires_confirmation": true}
	if review != nil {
		agree := visionNamesAgree(visionResultSummary(parsed), visionResultSummary(review))
		meta["names_agree"] = agree
		meta["requires_confirmation"] = !agree
		if !agree {
			parsed["uncertaintyNotes"] = append(toStringSlice(parsed["uncertaintyNotes"]), "不同识别渠道对食物名称判断不一致，请确认食物名称。")
			names := []string{}
			for _, item := range toItems(review["items"]) {
				names = append(names, stringFromAny(item["name"]))
			}
			meta["review_names"] = names
		}
	}
	parsed["channel_review"] = meta
}

func observeVisionPhase(ctx context.Context, mode, phase string, start time.Time) float64 {
	if req, ok := ctx.Value(visionRequestKey{}).(*visionRequest); ok {
		mode = req.mode
	}
	duration := time.Since(start)
	metrics.ObserveAnalysisPhase(ctx, mode, phase, duration)
	logger.Info(ctx, "食物识别处理阶段完成", slog.String("execution_mode", mode), slog.String("phase", phase), slog.Int64("duration_ms", duration.Milliseconds()))
	apm.AddEvent(ctx, "食物识别处理阶段完成", attribute.String("analysis.phase", phase), apm.DurationMS("analysis.phase_duration_ms", duration))
	return float64(duration.Milliseconds())
}

func logVisionChannelSkip(ctx context.Context, req *visionRequest, stage, upstream, model, reason string, shadow bool) {
	logger.Info(ctx, "餐照渠道请求已跳过", slog.String("task_id", req.taskID), slog.String("execution_mode", req.mode),
		slog.String("stage", stage), slog.String("upstream", upstream), slog.String("model", model),
		slog.String("reason", reason), slog.Bool("shadow", shadow))
}
