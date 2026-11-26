package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// 纠错的两次看图调用（重估分量或营养、结合照片理解说明）返回的不是“带菜名和重量的识别清单”，
// 均衡路由下不能再用识别清单的规则判断渠道回答是否有效。

func correctionReestimateAnswer() map[string]any {
	return map[string]any{"items": []any{map[string]any{"index": 1.0, "weight_grams": 260.0, "reason": "碗里约一半是汤"}}}
}

func precisionChannels(openlux, a6, wanjie map[string]any) balancedChannels {
	return balancedChannels{
		openluxPrecision: &channelFixture{result: openlux},
		a6:               &channelFixture{result: a6},
		wanjie35:         &channelFixture{result: wanjie},
	}
}

func channelCalls(c balancedChannels) int32 {
	return c.openluxPrecision.calls.Load() + c.a6.calls.Load() + c.wanjie35.calls.Load()
}

func TestRunPrecisionJSONWithoutValidatorStillRequiresNamedFoods(t *testing.T) {
	answer := correctionReestimateAnswer()
	c := precisionChannels(answer, answer, answer)
	s := newBalancedRoutingService(t, c)

	_, err := s.RunPrecisionJSONWithImagesTemperatureNoFallback(standardVisionCtx(), "image", "prompt", []string{"image"}, gemini35FlashModel, 0.1)
	require.ErrorIs(t, err, ErrEmptyFoodAnalysisResult, "精准估算的回答仍必须是带菜名和重量的食物清单")
	require.EqualValues(t, 3, channelCalls(c))
}

func TestRunPrecisionJSONValidatedAcceptsAnswerThatIsNotAFoodList(t *testing.T) {
	answer := correctionReestimateAnswer()
	c := precisionChannels(answer, answer, answer)
	s := newBalancedRoutingService(t, c)
	seen := 0

	parsed, err := s.RunPrecisionJSONWithImagesValidated(standardVisionCtx(), "image", "prompt", []string{"image"}, gemini35FlashModel, 0.1, func(result map[string]any) error {
		seen++
		require.Equal(t, answer, result)
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, answer, parsed)
	require.Equal(t, 1, seen)
	require.EqualValues(t, 1, channelCalls(c), "首选渠道的回答有效，不再换渠道")
}

func TestRunPrecisionJSONValidatedSwitchesChannelWhenAnswerIsRejected(t *testing.T) {
	notice := map[string]any{"message": "this model has been retired"}
	c := precisionChannels(notice, correctionReestimateAnswer(), notice)
	s := newBalancedRoutingService(t, c)

	parsed, err := s.RunPrecisionJSONWithImagesValidated(standardVisionCtx(), "image", "prompt", []string{"image"}, gemini35FlashModel, 0.1, func(result map[string]any) error {
		if len(toItems(result["items"])) == 0 {
			return ErrUnusableVisionAnswer
		}
		return nil
	})
	require.NoError(t, err)
	require.Equal(t, correctionReestimateAnswer(), parsed)
	require.EqualValues(t, 1, c.openluxPrecision.calls.Load())
	require.EqualValues(t, 1, c.a6.calls.Load())
}

func TestRunPrecisionJSONValidatedReportsWhenEveryChannelIsRejected(t *testing.T) {
	notice := map[string]any{"message": "this model has been retired"}
	c := precisionChannels(notice, notice, notice)
	s := newBalancedRoutingService(t, c)

	_, err := s.RunPrecisionJSONWithImagesValidated(standardVisionCtx(), "image", "prompt", []string{"image"}, gemini35FlashModel, 0.1, func(map[string]any) error {
		return ErrUnusableVisionAnswer
	})
	require.ErrorIs(t, err, ErrUnusableVisionAnswer)
	require.Equal(t, "invalid_result", visionChannelStatus(err))
}

func TestCorrectionPhotoPlanAcceptsPlanAnswerUnderBalancedRouting(t *testing.T) {
	plan := map[string]any{"needs_clarification": false, "edits": []any{}, "remove": []any{},
		"add": []any{map[string]any{"name": "冰粉", "weight_grams": 200.0}}}
	c := precisionChannels(plan, plan, plan)
	s := newBalancedRoutingService(t, c)

	parsed, err := runCorrectionPhotoPlan(s, standardVisionCtx(), "prompt", []string{"image"}, gemini35FlashModel)
	require.NoError(t, err, "修改计划没有食物清单，不能按识别结果的规则判为无效")
	require.Equal(t, plan, parsed)
	require.EqualValues(t, 1, channelCalls(c))
}

func TestCorrectionPhotoPlanRejectsAnswerWithoutPlan(t *testing.T) {
	notice := map[string]any{"message": "this model has been retired"}
	plan := map[string]any{"needs_clarification": true}
	c := precisionChannels(notice, plan, notice)
	s := newBalancedRoutingService(t, c)

	parsed, err := runCorrectionPhotoPlan(s, standardVisionCtx(), "prompt", []string{"image"}, gemini35FlashModel)
	require.NoError(t, err)
	require.Equal(t, plan, parsed, "不是修改计划的回答换下一个渠道")

	_, err = runCorrectionPhotoPlan(newBalancedRoutingService(t, precisionChannels(notice, notice, notice)), context.Background(), "prompt", []string{"image"}, gemini35FlashModel)
	require.Error(t, err)
}
