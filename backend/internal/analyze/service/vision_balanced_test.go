package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"food_link/backend/pkg/config"
	"github.com/stretchr/testify/require"
)

type balancedChannels struct {
	wanjie, wanjie35, openlux, openluxPrecision, a6 *channelFixture
}

func newBalancedRoutingService(t *testing.T, c balancedChannels) *AnalyzeService {
	t.Helper()
	ordinary, precision := balancedHedgeDelayOrdinary, balancedHedgeDelayPrecision
	balancedHedgeDelayOrdinary, balancedHedgeDelayPrecision = 80*time.Millisecond, 80*time.Millisecond
	t.Cleanup(func() { balancedHedgeDelayOrdinary, balancedHedgeDelayPrecision = ordinary, precision })
	s := NewAnalyzeService(nil, c.wanjie, nil)
	s.ConfigureGemini35LLMClient(c.wanjie35)
	s.ConfigureOpenLuxGeminiLLMClients(c.openlux, c.openluxPrecision)
	s.ConfigureA6VisionRouting("", "", config.VisionRoutingConfig{BalancedRoutingEnabled: true, ResponseWaitSeconds: 5})
	s.visionChannels.a6 = c.a6
	return s
}

func standardVisionCtx() context.Context {
	return WithVisionRequest(context.Background(), defaultExecutionMode, "task-balanced", false)
}

func TestBalancedVisionOrdinaryPrefersOpenLux(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("万界米饭")},
		openlux: &channelFixture{result: channelFood("米饭")},
		a6:      &channelFixture{result: channelFood("a6米饭")},
	}
	s := newBalancedRoutingService(t, c)

	outcome, err := s.runBalancedGeminiVision(standardVisionCtx(), "food_image", geminiPrimaryUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiOpenLuxUpstream, outcome.upstream)
	require.False(t, outcome.hedgeLaunched)
	require.Zero(t, c.wanjie.calls.Load(), "the slowest channel must not be contacted when the leader answers")
	require.Zero(t, c.a6.calls.Load())
}

func TestBalancedVisionPrecisionPrefersOpenLux(t *testing.T) {
	c := balancedChannels{
		wanjie35:         &channelFixture{result: channelFood("红烧肉")},
		openluxPrecision: &channelFixture{result: channelFood("openlux红烧肉")},
		a6:               &channelFixture{result: channelFood("a6红烧肉")},
	}
	s := newBalancedRoutingService(t, c)
	ctx := WithVisionRequest(context.Background(), precisionExecutionMode, "session-1", false)

	outcome, err := s.runBalancedGeminiVision(ctx, "precision", geminiOpenLuxUpstream, relayGemini37FlashModel, "prompt", []string{"image"}, 0, nil)
	require.NoError(t, err)
	require.Equal(t, geminiOpenLuxUpstream, outcome.upstream)
	require.Equal(t, relayGemini37FlashModel, outcome.model)
	require.Zero(t, c.a6.calls.Load())
	require.Zero(t, c.wanjie35.calls.Load(), "Wanjie is only the last resort")
}

func TestBalancedVisionHedgesWhenLeaderIsSlowAndCancelsIt(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("万界米饭")},
		openlux: &channelFixture{delay: 3 * time.Second, result: channelFood("slow"), canceled: make(chan struct{}, 1)},
		a6:      &channelFixture{result: channelFood("米饭")},
	}
	s := newBalancedRoutingService(t, c)
	start := time.Now()

	outcome, err := s.runBalancedGeminiVision(standardVisionCtx(), "food_image", geminiOpenLuxUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiA6Upstream, outcome.upstream)
	require.True(t, outcome.hedgeLaunched)
	require.Less(t, time.Since(start), time.Second, "the hedge must not wait for the slow leader")
	select {
	case <-c.openlux.canceled:
	case <-time.After(time.Second):
		t.Fatal("the slow leader was not cancelled")
	}
	require.Zero(t, c.wanjie.calls.Load())
}

func TestBalancedVisionSwitchesImmediatelyWhenLeaderFails(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("万界米饭")},
		openlux: &channelFixture{err: errors.New("upstream 500")},
		a6:      &channelFixture{result: channelFood("米饭")},
	}
	s := newBalancedRoutingService(t, c)
	balancedHedgeDelayOrdinary = time.Minute

	outcome, err := s.runBalancedGeminiVision(standardVisionCtx(), "food_image", geminiOpenLuxUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiA6Upstream, outcome.upstream)
	require.Error(t, outcome.primaryError)
}

func TestBalancedVisionReportsAllChannelsFailing(t *testing.T) {
	failing := func() *channelFixture { return &channelFixture{result: map[string]any{"items": []any{}}} }
	c := balancedChannels{wanjie: failing(), openlux: failing(), a6: failing()}
	s := newBalancedRoutingService(t, c)

	_, err := s.runBalancedGeminiVision(standardVisionCtx(), "food_image", geminiOpenLuxUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.ErrorIs(t, err, ErrEmptyFoodAnalysisResult)
	for _, f := range []*channelFixture{c.wanjie, c.openlux, c.a6} {
		require.EqualValues(t, 1, f.calls.Load(), "each channel is tried once, never retried")
	}
}

func TestBalancedVisionDemotesRecentlyFailingChannel(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("万界米饭")},
		openlux: &channelFixture{result: channelFood("openlux米饭")},
		a6:      &channelFixture{result: channelFood("米饭")},
	}
	s := newBalancedRoutingService(t, c)
	key := channelKey(defaultExecutionMode, geminiOpenLuxUpstream, gemini3FlashModel)
	now := time.Now()
	// 3 of 10 recent attempts failed, without three in a row tripping the circuit.
	for _, failed := range []bool{true, false, true, false, true, false, false, false, false, false} {
		var err error
		if failed {
			err = errors.New("upstream 500")
		}
		s.visionChannels.record(key, time.Second, err, now)
	}

	require.Equal(t, "a6:"+gemini3FlashModel, s.SelectFoodImageModel(defaultExecutionMode, "task-1"))
	outcome, err := s.runBalancedGeminiVision(standardVisionCtx(), "food_image", geminiA6Upstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiA6Upstream, outcome.upstream)
	require.Zero(t, c.openlux.calls.Load())
}

func TestBalancedVisionSelectsLeadingChannelForEveryTask(t *testing.T) {
	c := balancedChannels{
		wanjie: &channelFixture{}, wanjie35: &channelFixture{}, openlux: &channelFixture{}, openluxPrecision: &channelFixture{}, a6: &channelFixture{},
	}
	s := newBalancedRoutingService(t, c)
	for _, key := range []string{"task-a", "task-b", "task-c", "task-d"} {
		require.Equal(t, openLuxGemini3Route, s.SelectFoodImageModel(defaultExecutionMode, key))
		require.Equal(t, "openlux:"+relayGemini37FlashModel, s.SelectFoodImageModel(precisionExecutionMode, key))
	}
}

func TestBalancedVisionDemotesChannelThatTurnsSlowWithoutFailing(t *testing.T) {
	c := balancedChannels{wanjie35: &channelFixture{}, openluxPrecision: &channelFixture{}, a6: &channelFixture{}}
	s := newBalancedRoutingService(t, c)
	require.Equal(t, "openlux:"+relayGemini37FlashModel, s.SelectFoodImageModel(precisionExecutionMode, "session"), "the production prior leads with OpenLux")

	key := channelKey(precisionExecutionMode, geminiOpenLuxUpstream, relayGemini37FlashModel)
	now := time.Now()
	// OpenLux keeps losing hedges after 35s instead of failing.
	for i := 0; i < 3; i++ {
		s.visionChannels.record(key, 35*time.Second, context.Canceled, now)
	}
	require.Equal(t, "a6:"+relayGemini37FlashModel, s.SelectFoodImageModel(precisionExecutionMode, "session"))
}

func TestBalancedVisionKeepsPriorUntilEnoughSamples(t *testing.T) {
	c := balancedChannels{wanjie: &channelFixture{}, openlux: &channelFixture{}, a6: &channelFixture{}}
	s := newBalancedRoutingService(t, c)
	key := channelKey(defaultExecutionMode, geminiOpenLuxUpstream, gemini3FlashModel)
	s.visionChannels.record(key, 30*time.Second, nil, time.Now())
	s.visionChannels.record(key, 30*time.Second, nil, time.Now())
	require.Equal(t, openLuxGemini3Route, s.SelectFoodImageModel(defaultExecutionMode, "task"), "two slow samples are not yet evidence")
	s.visionChannels.record(key, 30*time.Second, nil, time.Now())
	require.Equal(t, "a6:"+gemini3FlashModel, s.SelectFoodImageModel(defaultExecutionMode, "task"))
}

func newOrdinaryModelRoutingService(t *testing.T, c balancedChannels, ordinaryModel string) *AnalyzeService {
	t.Helper()
	s := newBalancedRoutingService(t, c)
	s.ConfigureA6VisionRouting("", "", config.VisionRoutingConfig{BalancedRoutingEnabled: true, ResponseWaitSeconds: 5, OrdinaryImageModel: ordinaryModel})
	s.visionChannels.a6 = c.a6
	return s
}

func TestBalancedVisionOrdinaryPhotoUsesConfiguredModel(t *testing.T) {
	c := balancedChannels{
		wanjie:           &channelFixture{result: channelFood("万界米饭")},
		wanjie35:         &channelFixture{result: channelFood("万界3.5米饭")},
		openlux:          &channelFixture{result: channelFood("米饭"), args: make(chan channelCallArgs, 1)},
		openluxPrecision: &channelFixture{result: channelFood("精准米饭")},
		a6:               &channelFixture{result: channelFood("a6米饭")},
	}
	s := newOrdinaryModelRoutingService(t, c, precisionGeminiFlashModel)

	require.Equal(t, openLuxPrecisionGeminiRoute, s.SelectFoodImageModel(defaultExecutionMode, "task-1"))
	outcome, err := s.runBalancedGeminiVision(standardVisionCtx(), "food_image", geminiOpenLuxUpstream, precisionGeminiFlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err, "an ordinary payload must pass the ordinary validation")
	require.Equal(t, geminiOpenLuxUpstream, outcome.upstream)
	require.Equal(t, precisionGeminiFlashModel, outcome.model)
	require.Equal(t, precisionGeminiFlashModel, (<-c.openlux.args).model)
	require.Zero(t, c.wanjie35.calls.Load(), "ordinary photos stay off the precision channel family")
	require.Zero(t, c.openluxPrecision.calls.Load())
}

func TestBalancedVisionOrdinaryModelKeepsWanjieOnGemini3(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("万界米饭"), args: make(chan channelCallArgs, 1)},
		openlux: &channelFixture{err: errors.New("upstream 500")},
		a6:      &channelFixture{err: errors.New("upstream 500"), args: make(chan channelCallArgs, 1)},
	}
	s := newOrdinaryModelRoutingService(t, c, precisionGeminiFlashModel)

	outcome, err := s.runBalancedGeminiVision(standardVisionCtx(), "food_image", geminiOpenLuxUpstream, precisionGeminiFlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, precisionGeminiFlashModel, (<-c.a6.args).model)
	require.Equal(t, geminiPrimaryUpstream, outcome.upstream)
	require.Equal(t, gemini3FlashModel, (<-c.wanjie.args).model, "Wanjie cannot serve Gemini 3.6")
}

func TestBalancedVisionOrdinaryModelLeavesTextAndPrecisionAlone(t *testing.T) {
	c := balancedChannels{
		wanjie35:         &channelFixture{result: channelFood("红烧肉")},
		openlux:          &channelFixture{result: channelFood("米饭"), args: make(chan channelCallArgs, 1)},
		openluxPrecision: &channelFixture{result: channelFood("openlux红烧肉")},
		a6:               &channelFixture{result: channelFood("a6红烧肉")},
	}
	s := newOrdinaryModelRoutingService(t, c, precisionGeminiFlashModel)

	_, err := s.runBalancedGeminiChannels(standardVisionCtx(), "food_text", geminiOpenLuxUpstream, gemini3FlashModel, "prompt", nil, 0, nil, nil)
	require.NoError(t, err)
	require.Equal(t, gemini3FlashModel, (<-c.openlux.args).model, "text analysis keeps Gemini 3 Flash")

	ctx := WithVisionRequest(context.Background(), precisionExecutionMode, "session-1", false)
	require.Equal(t, "openlux:"+relayGemini37FlashModel, s.SelectFoodImageModel(precisionExecutionMode, "session-1"))
	outcome, err := s.runBalancedGeminiVision(ctx, "precision", geminiOpenLuxUpstream, relayGemini37FlashModel, "prompt", []string{"image"}, 0, nil)
	require.NoError(t, err)
	require.Equal(t, relayGemini37FlashModel, outcome.model, "precision keeps its own model, not the ordinary one")
}

func TestBalancedVisionNeverHedgesOntoLastResort(t *testing.T) {
	for _, precision := range []bool{false, true} {
		c := balancedChannels{
			wanjie:           &channelFixture{result: channelFood("万界米饭")},
			wanjie35:         &channelFixture{result: channelFood("万界米饭")},
			openlux:          &channelFixture{delay: 300 * time.Millisecond, result: channelFood("米饭")},
			openluxPrecision: &channelFixture{delay: 300 * time.Millisecond, result: channelFood("米饭")},
			a6:               &channelFixture{err: errors.New("upstream 502")},
		}
		s := newBalancedRoutingService(t, c)
		balancedHedgeDelayPrecision = 80 * time.Millisecond
		ctx, model := standardVisionCtx(), gemini3FlashModel
		if precision {
			ctx, model = WithVisionRequest(context.Background(), precisionExecutionMode, "session-1", false), relayGemini37FlashModel
		}

		outcome, err := s.runBalancedGeminiVision(ctx, "food_image", geminiOpenLuxUpstream, model, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
		require.NoError(t, err)
		require.Equal(t, geminiOpenLuxUpstream, outcome.upstream, "the slow leader still answers")
		require.Zero(t, c.wanjie.calls.Load()+c.wanjie35.calls.Load(), "precision=%v: a slow or failed hedge while another channel runs must not reach Wanjie", precision)
	}
}

func TestBalancedVisionUsesLastResortWhenOthersFail(t *testing.T) {
	c := balancedChannels{
		wanjie:  &channelFixture{result: channelFood("米饭")},
		openlux: &channelFixture{err: errors.New("upstream 500")},
		a6:      &channelFixture{err: errors.New("upstream 502")},
	}
	s := newBalancedRoutingService(t, c)

	outcome, err := s.runBalancedGeminiVision(standardVisionCtx(), "food_image", geminiOpenLuxUpstream, gemini3FlashModel, "prompt", []string{"image"}, 0, validateNonEmptyFoodAnalysisResult)
	require.NoError(t, err)
	require.Equal(t, geminiPrimaryUpstream, outcome.upstream)
}

func TestBalancedVisionKeepsLastResortLastWhenOthersLookUnhealthy(t *testing.T) {
	c := balancedChannels{wanjie: &channelFixture{}, wanjie35: &channelFixture{}, openlux: &channelFixture{}, openluxPrecision: &channelFixture{}, a6: &channelFixture{}}
	s := newBalancedRoutingService(t, c)
	now := time.Now()
	for _, precision := range []bool{false, true} {
		mode, model := defaultExecutionMode, gemini3FlashModel
		if precision {
			mode, model = precisionExecutionMode, relayGemini37FlashModel
		}
		for _, upstream := range []string{geminiOpenLuxUpstream, geminiA6Upstream} {
			key := channelKey(mode, upstream, model)
			for i := 0; i < 2; i++ {
				s.visionChannels.record(key, time.Second, errors.New("upstream 500"), now)
			}
		}
		plans := s.orderedBalancedPlans(mode, precision, true)
		require.Equal(t, geminiPrimaryUpstream, plans[len(plans)-1].upstream, "precision=%v", precision)
	}
}

func TestBalancedVisionOrdinaryModelDefaultsToGemini3(t *testing.T) {
	c := balancedChannels{wanjie: &channelFixture{}, openlux: &channelFixture{}, a6: &channelFixture{}}
	for _, configured := range []string{"", "gemini-9-flash", gemini35FlashModel, gemini3FlashModel} {
		s := newOrdinaryModelRoutingService(t, c, configured)
		require.Equal(t, gemini3FlashModel, s.ordinaryImageModel(), configured)
		require.Equal(t, openLuxGemini3Route, s.SelectFoodImageModel(defaultExecutionMode, "task"), configured)
	}
	s := newOrdinaryModelRoutingService(t, c, " "+relayGemini37FlashModel+" ")
	require.Equal(t, "openlux:"+relayGemini37FlashModel, s.SelectFoodImageModel(defaultExecutionMode, "task"))
}

func TestResolveModelConfigMapsA6Gemini36Route(t *testing.T) {
	provider, model := resolveModelConfig("a6:" + precisionGeminiFlashModel)
	require.Equal(t, "gemini", provider)
	require.Equal(t, precisionGeminiFlashModel, model)
}
