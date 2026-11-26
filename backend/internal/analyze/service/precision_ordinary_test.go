package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"food_link/backend/pkg/config"
	"github.com/stretchr/testify/require"
)

func newPrecisionOrdinaryService(t *testing.T, c balancedChannels, hedgeSeconds int) *AnalyzeService {
	t.Helper()
	s := newBalancedRoutingService(t, c)
	s.ConfigureA6VisionRouting("", "", config.VisionRoutingConfig{
		BalancedRoutingEnabled: true, ResponseWaitSeconds: 5,
		PrecisionFlow: "ordinary", PrecisionOrdinaryHedgeSeconds: hedgeSeconds,
	})
	s.visionChannels.a6 = c.a6
	return s
}

func precisionOrdinaryCtx() context.Context {
	return context.WithValue(standardVisionCtx(), precisionOrdinaryKey{}, true)
}

func TestPrecisionOrdinaryLeadsWithHydrogenOnA6(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("万界米饭")},
		openlux: &channelFixture{result: channelFood("openlux米饭")},
		a6:      &channelFixture{result: channelFood("米饭"), args: make(chan channelCallArgs, 4)},
	}
	s := newPrecisionOrdinaryService(t, c, 45)

	outcome, err := s.runBalancedGeminiVision(precisionOrdinaryCtx(), "food_image", geminiOpenLuxUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiA6Upstream, outcome.upstream)
	require.Equal(t, defaultPrecisionOrdinaryModel, outcome.model)
	require.Equal(t, defaultPrecisionOrdinaryModel, (<-c.a6.args).model)
	require.Zero(t, c.openlux.calls.Load(), "ordinary channels wait while the precision model answers in time")
	require.Zero(t, c.wanjie.calls.Load())
}

func TestPrecisionOrdinaryFallsBackToOrdinaryChannelsWhenLeadFails(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("万界米饭")},
		openlux: &channelFixture{result: channelFood("openlux米饭")},
		a6:      &channelFixture{err: errors.New("upstream 503")},
	}
	s := newPrecisionOrdinaryService(t, c, 45)

	outcome, err := s.runBalancedGeminiVision(precisionOrdinaryCtx(), "food_image", geminiOpenLuxUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiOpenLuxUpstream, outcome.upstream)
	require.Equal(t, gemini3FlashModel, outcome.model)
}

func TestPrecisionOrdinaryHedgesSlowLeadWithOrdinaryChannels(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("万界米饭")},
		openlux: &channelFixture{result: channelFood("openlux米饭")},
		a6:      &channelFixture{result: channelFood("米饭"), delay: 5 * time.Second, canceled: make(chan struct{}, 2)},
	}
	s := newPrecisionOrdinaryService(t, c, 1)
	start := time.Now()

	outcome, err := s.runBalancedGeminiVision(precisionOrdinaryCtx(), "food_image", geminiOpenLuxUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiOpenLuxUpstream, outcome.upstream)
	require.True(t, outcome.hedgeLaunched)
	require.Less(t, time.Since(start), 3*time.Second)
}

func TestPrecisionOrdinaryLeadNeedsTheMarker(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("万界米饭")},
		openlux: &channelFixture{result: channelFood("openlux米饭")},
		a6:      &channelFixture{result: channelFood("米饭"), args: make(chan channelCallArgs, 4)},
	}
	s := newPrecisionOrdinaryService(t, c, 45)

	outcome, err := s.runBalancedGeminiVision(standardVisionCtx(), "food_image", geminiOpenLuxUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.NotEqual(t, defaultPrecisionOrdinaryModel, outcome.model, "ordinary photos never use the precision model")
	_, lead := s.precisionOrdinaryLead(precisionOrdinaryCtx(), false)
	require.False(t, lead, "text calls never get the precision lead")
}

func TestPrecisionOrdinarySwitchDefaultsOff(t *testing.T) {
	s := NewAnalyzeService(nil, nil, nil)
	s.ConfigureA6VisionRouting("key", "", config.VisionRoutingConfig{BalancedRoutingEnabled: true})
	require.False(t, s.precisionOrdinaryEnabled())
	s.ConfigureA6VisionRouting("key", "", config.VisionRoutingConfig{BalancedRoutingEnabled: true, PrecisionFlow: " Ordinary "})
	require.True(t, s.precisionOrdinaryEnabled())
	require.Equal(t, defaultPrecisionOrdinaryModel, s.precisionOrdinaryModel())
	require.Equal(t, defaultPrecisionOrdinaryHedge, s.precisionOrdinaryHedge())
}

func TestGeminiBodyForModelRaisesOutputBudgetForGemini4Only(t *testing.T) {
	body := []byte(`{"contents":[],"generationConfig":{"maxOutputTokens":8192,"temperature":0.2}}`)
	var decoded struct {
		GenerationConfig map[string]any `json:"generationConfig"`
	}
	require.NoError(t, json.Unmarshal(geminiBodyForModel("gemini-4-hydrogen", body), &decoded))
	require.EqualValues(t, geminiLargeOutputTokens, decoded.GenerationConfig["maxOutputTokens"])
	require.EqualValues(t, 0.2, decoded.GenerationConfig["temperature"])
	require.Equal(t, string(body), string(geminiBodyForModel("gemini-3.6-flash", body)))
}

func TestTaskServicePrecisionOrdinaryEligibility(t *testing.T) {
	session := "s-1"
	cases := []struct {
		name  string
		flow  string
		mode  string
		input SubmitTaskInput
		want  bool
	}{
		{"single photo", "ordinary", precisionExecutionMode, SubmitTaskInput{ImageURL: "https://x/a.jpg"}, true},
		{"dual angle", "ordinary", precisionExecutionMode, SubmitTaskInput{ImageURLs: []string{"a", "b"}, CaptureProtocol: dualAngleCaptureProtocol}, true},
		{"video keyframes stay legacy", "ordinary", precisionExecutionMode, SubmitTaskInput{ImageURLs: []string{"a"}, CaptureProtocol: videoCaptureProtocol}, false},
		{"split items stay legacy", "ordinary", precisionSeparateExecutionMode, SubmitTaskInput{ImageURL: "https://x/a.jpg"}, false},
		{"continued session stays legacy", "ordinary", precisionExecutionMode, SubmitTaskInput{ImageURL: "https://x/a.jpg", PrecisionSessionID: &session}, false},
		{"text stays legacy", "ordinary", precisionExecutionMode, SubmitTaskInput{}, false},
		{"switch off", "legacy", precisionExecutionMode, SubmitTaskInput{ImageURL: "https://x/a.jpg"}, false},
		{"ordinary photo untouched", "ordinary", defaultExecutionMode, SubmitTaskInput{ImageURL: "https://x/a.jpg"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &TaskService{}
			s.ConfigurePrecisionFlow(tc.flow)
			require.Equal(t, tc.want, s.precisionOrdinaryEligible(tc.mode, tc.input))
		})
	}
}
