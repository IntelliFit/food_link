package service

import (
	"fmt"
	"testing"
	"time"

	"food_link/backend/internal/analyze/domain"
	"github.com/stretchr/testify/require"
)

func TestCollectAnalyzeHistoryPageSkipsExcludedRowsAndFillsVisiblePage(t *testing.T) {
	raw := make([]domain.AnalysisTask, 0, 205)
	for index := 0; index < analyzeHistoryScanBatch; index++ {
		raw = append(raw, historyTask(fmt.Sprintf("excluded-%03d", index), "health_report", nil))
	}
	raw = append(raw,
		historyTask("visible-1", "food", nil),
		historyTask("visible-2", "food", nil),
		historyTask("visible-3", "food", nil),
	)

	tasks, hasMore, nextOffset, err := collectAnalyzeHistoryPage(0, 2, sliceHistoryFetcher(raw))

	require.NoError(t, err)
	require.True(t, hasMore)
	require.Equal(t, []string{"visible-1", "visible-2"}, historyTaskIDs(tasks))
	require.Equal(t, analyzeHistoryScanBatch+2, nextOffset)
}

func TestCollectAnalyzeHistoryPageDoesNotSkipLookAheadTask(t *testing.T) {
	raw := []domain.AnalysisTask{
		historyTask("visible-1", "food", nil),
		historyTask("visible-2", "food", nil),
		historyTask("visible-3", "food", nil),
	}

	first, hasMore, nextOffset, err := collectAnalyzeHistoryPage(0, 2, sliceHistoryFetcher(raw))
	require.NoError(t, err)
	require.True(t, hasMore)
	require.Equal(t, []string{"visible-1", "visible-2"}, historyTaskIDs(first))
	require.Equal(t, 2, nextOffset)

	second, hasMore, finalOffset, err := collectAnalyzeHistoryPage(nextOffset, 2, sliceHistoryFetcher(raw))
	require.NoError(t, err)
	require.False(t, hasMore)
	require.Equal(t, []string{"visible-3"}, historyTaskIDs(second))
	require.Equal(t, len(raw), finalOffset)
}

func TestCollectAnalyzeHistoryPageCollapsesDuplicateGroupsBeforePaging(t *testing.T) {
	rootPayload := map[string]any{"correction_root_task_id": "root-task"}
	raw := []domain.AnalysisTask{
		historyTask("correction-new", "food", rootPayload),
		historyTask("correction-old", "food", rootPayload),
		historyTask("visible-2", "food", nil),
		historyTask("visible-3", "food", nil),
	}

	tasks, hasMore, nextOffset, err := collectAnalyzeHistoryPage(0, 2, sliceHistoryFetcher(raw))

	require.NoError(t, err)
	require.True(t, hasMore)
	require.Equal(t, []string{"correction-new", "visible-2"}, historyTaskIDs(tasks))
	require.Equal(t, "root:root-task", tasks[0].HistoryGroupKey)
	require.Equal(t, 3, nextOffset)
}

func TestCollectAnalyzeHistoryPageReturnsRawEndOffsetWhenExhausted(t *testing.T) {
	raw := []domain.AnalysisTask{
		historyTask("excluded", "exercise", nil),
		historyTask("visible", "food", nil),
	}

	tasks, hasMore, nextOffset, err := collectAnalyzeHistoryPage(0, 10, sliceHistoryFetcher(raw))

	require.NoError(t, err)
	require.False(t, hasMore)
	require.Equal(t, []string{"visible"}, historyTaskIDs(tasks))
	require.Equal(t, len(raw), nextOffset)
}

func sliceHistoryFetcher(tasks []domain.AnalysisTask) analyzeHistoryPageFetcher {
	return func(offset, limit int) ([]domain.AnalysisTask, error) {
		if offset >= len(tasks) {
			return nil, nil
		}
		end := offset + limit
		if end > len(tasks) {
			end = len(tasks)
		}
		return tasks[offset:end], nil
	}
}

func historyTask(id, taskType string, payload map[string]any) domain.AnalysisTask {
	createdAt := time.Date(2026, 7, 30, 12, 0, 0, 0, time.FixedZone("Asia/Shanghai", 8*60*60))
	return domain.AnalysisTask{
		ID:        id,
		TaskType:  taskType,
		Payload:   payload,
		CreatedAt: &createdAt,
	}
}

func historyTaskIDs(tasks []domain.AnalysisTask) []string {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	return ids
}
