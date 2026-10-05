package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"food_link/backend/pkg/config"
	"github.com/stretchr/testify/require"
)

type channelCallArgs struct {
	model, prompt string
	images        []string
}
type channelFixture struct {
	result   map[string]any
	err      error
	delay    time.Duration
	calls    atomic.Int32
	args     chan channelCallArgs
	canceled chan struct{}
}

func (f *channelFixture) Analyze(ctx context.Context, prompt, image string) (map[string]any, error) {
	return f.AnalyzeWithImagesAndTemperatureModel(ctx, prompt, []string{image}, 0, "")
}

func (f *channelFixture) AnalyzeWithImagesAndTemperatureModel(ctx context.Context, prompt string, images []string, temperature float64, model string) (map[string]any, error) {
	f.calls.Add(1)
	if f.args != nil {
		f.args <- channelCallArgs{model, prompt, append([]string(nil), images...)}
	}
	timer := time.NewTimer(f.delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		if f.canceled != nil {
			f.canceled <- struct{}{}
		}
		return nil, ctx.Err()
	case <-timer.C:
		data, _ := json.Marshal(f.result)
		var out map[string]any
		_ = json.Unmarshal(data, &out)
		return out, f.err
	}
}

func channelFood(name string) map[string]any {
	return map[string]any{"items": []any{map[string]any{"name": name, "estimatedWeightGrams": 100.0}}}
}

func configureChannelTest(s *AnalyzeService, a6 LLMClient, live bool) {
	s.ConfigureA6VisionRouting("", "", config.VisionRoutingConfig{A6ShadowPercent: 100, CostRoutingEnabled: live, A6IndependentUpstream: true, A6ApprovedModels: []string{gemini3FlashModel, gemini35FlashModel}, HedgeMinSeconds: 1, HedgeMaxSeconds: 1, ThirdHedgeSeconds: 2})
	s.visionChannels.a6 = a6
}

func TestVisionChannelsShadowDoesNotChangeWinnerOrFollowTaskCancellation(t *testing.T) {
	primary := &channelFixture{result: channelFood("米饭")}
	a6 := &channelFixture{result: channelFood("面条"), delay: 40 * time.Millisecond, args: make(chan channelCallArgs, 1), canceled: make(chan struct{}, 1)}
	s := NewAnalyzeService(nil, primary, nil)
	configureChannelTest(s, a6, false)
	baseCtx, cancel := context.WithCancel(context.Background())
	ctx := WithVisionRequest(baseCtx, "standard", "real-task", true)
	outcome, err := s.runHedgedGeminiVision(ctx, "food_image_gemini_hedge", geminiPrimaryUpstream, gemini3FlashModel, "FULL PROMPT", []string{"https://images.test/a", "https://images.test/b"}, 0, primary, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiPrimaryUpstream, outcome.upstream)
	require.Equal(t, "米饭", visionResultSummary(outcome.parsed)[0]["name"])
	cancel()
	select {
	case args := <-a6.args:
		require.Equal(t, gemini3FlashModel, args.model)
		require.Equal(t, "FULL PROMPT", args.prompt)
		require.Len(t, args.images, 2)
	case <-time.After(time.Second):
		t.Fatal("影子未启动")
	}
	require.Eventually(t, func() bool { return len(s.visionChannels.shadowSlots) == 0 }, time.Second, time.Millisecond)
	require.Empty(t, a6.canceled)
	s.visionChannels.mu.Lock()
	samples := append([]channelSample(nil), s.visionChannels.state(channelKey("standard", geminiA6Upstream, gemini3FlashModel)).samples...)
	s.visionChannels.mu.Unlock()
	require.Len(t, samples, 1)
	require.True(t, samples[0].valid)
}

func TestVisionChannelsShadowSkipsBenchmarksAndCapsConcurrentCost(t *testing.T) {
	primary := &channelFixture{result: channelFood("米饭")}
	a6 := &channelFixture{result: channelFood("米饭"), delay: 80 * time.Millisecond}
	s := NewAnalyzeService(nil, primary, nil)
	configureChannelTest(s, a6, false)
	s.visionChannels.shadowSlots = make(chan struct{}, 1)
	for i, eligible := range []bool{false, true, true} {
		ctx := WithVisionRequest(context.Background(), "standard", string(rune('a'+i)), eligible)
		_, err := s.runHedgedGeminiVision(ctx, "food_image", geminiPrimaryUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, primary, validateNonEmptyFoodAnalysisResult)
		require.NoError(t, err)
	}
	require.Eventually(t, func() bool { return len(s.visionChannels.shadowSlots) == 0 }, time.Second, time.Millisecond)
	require.EqualValues(t, 1, a6.calls.Load())
}

func TestVisionChannelsCostOrderRejectsEmptyResultsBeforeWanjie(t *testing.T) {
	primary := &channelFixture{result: channelFood("正确米饭")}
	openlux := &channelFixture{err: errors.New("upstream 429")}
	a6 := &channelFixture{result: map[string]any{"items": []any{}}}
	s := NewAnalyzeService(nil, primary, nil)
	s.ConfigureOpenLuxGeminiLLMClients(openlux, nil)
	configureChannelTest(s, a6, true)
	outcome, err := s.runHedgedGeminiVision(context.Background(), "food_image", geminiPrimaryUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, primary, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiPrimaryUpstream, outcome.upstream)
	require.True(t, outcome.hedgeLaunched)
	require.True(t, outcome.alternateWon)
	require.Equal(t, geminiA6Upstream, outcome.primaryUpstream)
	require.EqualValues(t, 1, a6.calls.Load())
	require.EqualValues(t, 1, openlux.calls.Load())
	require.EqualValues(t, 1, primary.calls.Load())
}

func TestVisionChannelsCostRouteRequiresApprovalAndIndependentUpstream(t *testing.T) {
	for _, which := range []string{"unapproved", "shared_upstream", "disabled"} {
		t.Run(which, func(t *testing.T) {
			primary := &channelFixture{result: channelFood("米饭")}
			a6 := &channelFixture{result: channelFood("unexpected")}
			s := NewAnalyzeService(nil, primary, nil)
			configureChannelTest(s, a6, true)
			switch which {
			case "unapproved":
				s.visionChannels.config.A6ApprovedModels = nil
			case "shared_upstream":
				s.visionChannels.config.A6IndependentUpstream = false
			case "disabled":
				s.visionChannels.config.CostRoutingEnabled = false
			}
			_, err := s.runHedgedGeminiVision(context.Background(), "food_image", geminiPrimaryUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, primary, validateNonEmptyFoodAnalysisResult)
			require.NoError(t, err)
			require.Zero(t, a6.calls.Load())
		})
	}
}

func TestVisionChannelsPrecisionKeepsProviderModelMappings(t *testing.T) {
	primary := &channelFixture{result: channelFood("unused"), args: make(chan channelCallArgs, 1)}
	openlux := &channelFixture{result: channelFood("米饭"), args: make(chan channelCallArgs, 1)}
	a6 := &channelFixture{err: errors.New("upstream 503"), args: make(chan channelCallArgs, 1)}
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureGemini35LLMClient(primary)
	s.ConfigureOpenLuxGeminiLLMClients(nil, openlux)
	configureChannelTest(s, a6, true)
	outcome, err := s.runHedgedGeminiVision(context.Background(), "precision", geminiPrimaryUpstream, gemini35FlashModel, "prompt", []string{"image"}, 0, primary, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, precisionGeminiFlashModel, outcome.model)
	require.Equal(t, gemini35FlashModel, (<-a6.args).model)
	require.Equal(t, precisionGeminiFlashModel, (<-openlux.args).model)
	require.Zero(t, primary.calls.Load())
}

func TestVisionChannelsThirdHedgeAndCancellation(t *testing.T) {
	primary := &channelFixture{result: channelFood("兜底米饭")}
	openlux := &channelFixture{delay: 10 * time.Second, result: channelFood("slow"), canceled: make(chan struct{}, 1)}
	a6 := &channelFixture{delay: 10 * time.Second, result: channelFood("slow"), canceled: make(chan struct{}, 1)}
	s := NewAnalyzeService(nil, primary, nil)
	s.ConfigureOpenLuxGeminiLLMClients(openlux, nil)
	configureChannelTest(s, a6, true)
	start := time.Now()
	outcome, err := s.runHedgedGeminiVision(context.Background(), "food_image", geminiPrimaryUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, primary, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiPrimaryUpstream, outcome.upstream)
	require.GreaterOrEqual(t, time.Since(start), 2*time.Second)
	for _, ch := range []chan struct{}{a6.canceled, openlux.canceled} {
		select {
		case <-ch:
		case <-time.After(time.Second):
			t.Fatal("未取消慢渠道")
		}
	}
}

func TestVisionChannelsTotalDeadlineAndNoQwenFallback(t *testing.T) {
	primary := &channelFixture{delay: time.Second, result: channelFood("slow")}
	openlux := &channelFixture{delay: time.Second, result: channelFood("slow")}
	s := NewAnalyzeService(nil, primary, nil)
	s.ConfigureOpenLuxGeminiLLMClients(openlux, nil)
	configureChannelTest(s, nil, false)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := s.runHedgedGeminiVision(ctx, "food_image", geminiPrimaryUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, primary, validateNonEmptyFoodAnalysisResult)
	require.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestVisionChannelsCircuitHalfOpenAndCancellationAccounting(t *testing.T) {
	s := NewAnalyzeService(nil, nil, nil)
	configureChannelTest(s, nil, false)
	r := s.visionChannels
	now := time.Now()
	key := "model/channel"
	for i := 0; i < 3; i++ {
		r.record(key, time.Second, errors.New("503"), now)
	}
	require.False(t, r.acquire(key, now))
	require.True(t, r.acquire(key, now.Add(time.Minute)))
	require.False(t, r.acquire(key, now.Add(time.Minute)))
	r.record(key, time.Second, nil, now.Add(time.Minute))
	require.True(t, r.acquire(key, now.Add(time.Minute)))
	for i := 0; i < 4; i++ {
		r.record(key, time.Second, context.Canceled, now.Add(time.Minute))
	}
	require.True(t, r.acquire(key, now.Add(time.Minute)))
	require.Len(t, r.health[key].samples, 4)
}

func TestVisionChannelsUncertainReviewSurfacesDisagreement(t *testing.T) {
	food := channelFood("锅巴")
	toItems(food["items"])[0]["confidence"] = .4
	primary := &channelFixture{result: food}
	openlux := &channelFixture{result: channelFood("腐竹")}
	s := NewAnalyzeService(nil, primary, nil)
	s.ConfigureOpenLuxGeminiLLMClients(openlux, nil)
	configureChannelTest(s, nil, false)
	s.visionChannels.config.UncertainReviewEnabled = true
	outcome, err := s.runHedgedGeminiVision(context.Background(), "food_image", geminiPrimaryUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, primary, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	meta := mapFromAny(outcome.parsed["channel_review"])
	require.Equal(t, true, meta["requires_confirmation"])
	require.Equal(t, false, meta["names_agree"])
	require.Equal(t, "锅巴", visionResultSummary(outcome.parsed)[0]["name"])
	require.NotEmpty(t, outcome.parsed["uncertaintyNotes"])
}

func TestVisionChannelsOpenAIWireIsNonStreamingAndRejectsTruncation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		require.NoError(t, json.NewDecoder(r.Body).Decode(&payload))
		require.Equal(t, false, payload["stream"])
		require.EqualValues(t, 8192, payload["max_tokens"])
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"length","message":{"content":"{\"items\":[{\"name\":\"米饭\"}]}"}}]}`))
	}))
	defer server.Close()
	client := NewOfoxAIClient("test", gemini3FlashModel, server.URL)
	_, err := client.Analyze(context.Background(), "prompt", "https://image.test/a")
	require.True(t, IsLLMJSONParseError(err))
}

func TestVisionChannelsBusinessValidationRejectsNamelessOrAbsurdWeight(t *testing.T) {
	require.Error(t, validateVisionFoodPayload(map[string]any{"items": []any{map[string]any{"estimatedWeightGrams": 100}}}))
	food := channelFood("米饭")
	toItems(food["items"])[0]["estimatedWeightGrams"] = 99999.0
	require.Error(t, validateVisionFoodPayload(food))
	toItems(food["items"])[0]["estimatedWeightGrams"] = -100.0
	require.Error(t, validateVisionFoodPayload(food))
}
