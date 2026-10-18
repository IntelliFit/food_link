package worker

import (
	"testing"

	"food_link/backend/internal/analyze/domain"

	"github.com/stretchr/testify/require"
)

func TestAlgorithmSummaryExposesUnchangedCorrection(t *testing.T) {
	item := map[string]any{"name": "羊肉锅", "estimatedWeightGrams": 1500.0, "nutrition_source": "ai_direct", "nutrients": map[string]any{"calories": 950.0}}
	task := &domain.AnalysisTask{Payload: map[string]any{"previousResult": map[string]any{"items": []any{item}}}}
	summary := summarizeAlgorithmResult(task, map[string]any{"items": []any{item}})
	require.Equal(t, 1, summary.items)
	require.Zero(t, summary.changed, "监测不能把状态done当成真的改了")
	require.Equal(t, 1, summary.missingState, "重量口径未报告必须可见")
	renamed := copyAnyMap(item)
	renamed["name"] = "牛肉锅"
	summary = summarizeAlgorithmResult(task, map[string]any{"items": []any{renamed}})
	require.Equal(t, 1, summary.changed)
	require.Equal(t, map[string]int{"ai_direct": 1}, summary.sources)
}

func TestAlgorithmSummaryFailedCorrectionHasNoAppliedChanges(t *testing.T) {
	task := &domain.AnalysisTask{Payload: map[string]any{"previousResult": map[string]any{"items": []any{map[string]any{"name": "羊肉锅"}, map[string]any{"name": "米饭"}}}}}
	summary := summarizeAlgorithmResult(task, nil)
	require.Equal(t, 2, summary.previous)
	require.Zero(t, summary.items)
	require.Zero(t, summary.changed, "失败没有已落库结果，不能记为删除原食物")
}

func TestAlgorithmSummaryPrecisionSingleItemIsObserved(t *testing.T) {
	task := &domain.AnalysisTask{TaskType: "precision_item_estimate", Payload: map[string]any{}}
	summary := summarizeAlgorithmResult(task, map[string]any{"item": map[string]any{"name": "牛肉锅", "estimatedWeightGrams": 1500.0}})
	require.Equal(t, 1, summary.items)
	require.Zero(t, summary.missingWeight)
	require.Equal(t, 1, summary.missingState)
}

func TestAlgorithmSummaryDeletionDoesNotChangeFollowingItems(t *testing.T) {
	for _, useIDs := range []bool{false, true} {
		previous := []map[string]any{{"name": "牛肉锅"}, {"name": "辣子鸡"}, {"name": "米饭"}}
		if useIDs {
			for index := range previous {
				previous[index]["itemId"] = []string{"beef", "chicken", "rice"}[index]
			}
		}
		require.Equal(t, 1, countAlgorithmItemChanges(previous, previous[1:]))
		require.Zero(t, countAlgorithmItemChanges(previous, []map[string]any{previous[2], previous[0], previous[1]}))
	}
}
