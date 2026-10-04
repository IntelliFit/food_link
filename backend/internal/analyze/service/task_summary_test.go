package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/repo"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWaitingRecordSummaryFiltersBeforePaginationAndCountsAllRows(t *testing.T) {
	db, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	require.NoError(t, db.Exec(`ALTER TABLE analysis_tasks ALTER COLUMN payload TYPE jsonb USING payload::jsonb, ALTER COLUMN result TYPE jsonb USING result::jsonb`).Error)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()
	date := "2026-10-02"
	now := time.Now()
	makeTask := func(id, user, targetDate string) domain.AnalysisTask {
		return domain.AnalysisTask{ID: id, UserID: user, TaskType: "food", Status: "done", Payload: map[string]any{"date": targetDate}, Result: map[string]any{"items": []any{map[string]any{"name": "米饭"}}}, CreatedAt: &now}
	}
	rows := make([]domain.AnalysisTask, 0, 215)
	for i := 0; i < 205; i++ {
		rows = append(rows, makeTask(fmt.Sprintf("waiting-%03d", i), "waiting-user", date))
	}
	rows = append(rows, makeTask("today", "waiting-user", "2026-10-03"), makeTask("other-user", "other-user", date), makeTask("saved", "waiting-user", date), makeTask("corrected-root", "waiting-user", date))
	child := makeTask("saved-correction", "waiting-user", date)
	child.Payload["correction_root_task_id"] = "corrected-root"
	rows = append(rows, child)
	failed := makeTask("failed", "waiting-user", date)
	failed.Status = "failed"
	violated := makeTask("violated", "waiting-user", date)
	violated.IsViolated = true
	empty := makeTask("empty", "waiting-user", date)
	empty.Result = map[string]any{}
	exercise := makeTask("exercise", "waiting-user", date)
	exercise.Payload["exercise"] = true
	precision := makeTask("precision", "waiting-user", date)
	precision.Payload = map[string]any{"date": "", "recorded_on": date}
	precision.TaskType = "precision_plan"
	precision.Result = map[string]any{"userActionRequired": true}
	rows = append(rows, failed, violated, empty, exercise, precision)
	require.NoError(t, db.CreateInBatches(&rows, 100).Error)
	for _, taskID := range []string{"saved", "saved-correction"} {
		require.NoError(t, db.Create(&foodrecorddomain.FoodRecord{ID: "record-" + taskID, UserID: "waiting-user", SourceTaskID: &taskID}).Error)
	}

	page, err := svc.ListWaitingRecordTaskSummariesPage(ctx, "waiting-user", date, "", 2, 0)
	require.NoError(t, err)
	require.NotNil(t, page.Total)
	assert.Equal(t, 206, *page.Total)
	assert.True(t, page.FilterApplied)
	assert.True(t, page.HasMore)
	assert.Equal(t, 2, page.NextOffset)
	require.Len(t, page.Tasks, 2)
	for _, task := range page.Tasks {
		assert.Equal(t, date, task.RecordedOn)
		assert.False(t, task.IsRecorded)
	}
	last, err := svc.ListWaitingRecordTaskSummariesPage(ctx, "waiting-user", date, "", 10, 200)
	require.NoError(t, err)
	assert.Len(t, last.Tasks, 6)
	assert.False(t, last.HasMore)
	assert.Equal(t, 206, last.NextOffset)
	otherDay, err := svc.ListWaitingRecordTaskSummariesPage(ctx, "waiting-user", "2026-10-03", "", 2, 0)
	require.NoError(t, err)
	require.Len(t, otherDay.Tasks, 1)
	assert.Equal(t, "today", otherDay.Tasks[0].ID)
}

func TestSummarizeTaskListPage(t *testing.T) {
	createdAt := time.Date(2026, 8, 12, 10, 30, 0, 0, time.UTC)
	updatedAt := createdAt.Add(time.Minute)
	imageURL := "https://example.com/normalized.jpg"
	textInput := strings.Repeat("这是一段需要限制长度的识别文本 ", 20)
	violationReason := "内容不符合要求"
	page := TaskListPage{
		Tasks: []domain.AnalysisTask{{
			ID:              "task-1",
			UserID:          "user-must-not-be-serialized",
			TaskType:        "food_text_debug",
			Status:          "done",
			ImageURL:        &imageURL,
			ImagePaths:      []string{imageURL},
			TextInput:       &textInput,
			ErrorMessage:    &violationReason,
			IsViolated:      true,
			ViolationReason: &violationReason,
			IsRecorded:      true,
			RecordID:        "record-1",
			HistoryGroupKey: "group-1",
			CreatedAt:       &createdAt,
			UpdatedAt:       &updatedAt,
			Payload: map[string]any{
				"execution_mode": "strict",
				"source_type":    "text",
				"mealType":       "dinner",
				"date":           "2026-08-11",
				"large_value":    strings.Repeat("p", 32*1024),
			},
			Result: map[string]any{
				"items": []any{
					map[string]any{"name": "牛肉面", "nutrients": map[string]any{"calories": 410.5}},
					map[string]any{"name": "青菜", "nutrients": map[string]any{"calories": 35.0}},
				},
				"recognitionOutcome": "ok",
				"large_value":        strings.Repeat("r", 32*1024),
			},
		}},
		HasMore:    true,
		NextOffset: 42,
	}

	summaryPage := SummarizeTaskListPage(page)
	require.Len(t, summaryPage.Tasks, 1)
	assert.True(t, summaryPage.HasMore)
	assert.Equal(t, 42, summaryPage.NextOffset)

	summary := summaryPage.Tasks[0]
	assert.Equal(t, "task-1", summary.ID)
	assert.Equal(t, "strict", summary.ExecutionMode)
	assert.Equal(t, "text", summary.SourceType)
	assert.Equal(t, "dinner", summary.MealType)
	assert.Equal(t, "2026-08-11", summary.RecordedOn)
	assert.True(t, summary.HasResult)
	assert.LessOrEqual(t, len([]rune(summary.TextPreview)), taskSummaryTextPreviewRunes+1)
	require.NotNil(t, summary.ResultSummary)
	assert.Equal(t, "牛肉面", summary.ResultSummary.FirstItemName)
	assert.Equal(t, 2, summary.ResultSummary.ItemCount)
	assert.Equal(t, 445.5, summary.ResultSummary.TotalCalories)
	assert.Equal(t, "ok", summary.ResultSummary.RecognitionOutcome)

	wireJSON, err := json.Marshal(summaryPage)
	require.NoError(t, err)
	var wire map[string]any
	require.NoError(t, json.Unmarshal(wireJSON, &wire))
	wireTask := wire["tasks"].([]any)[0].(map[string]any)
	assert.NotContains(t, wireTask, "payload")
	assert.NotContains(t, wireTask, "result")
	assert.NotContains(t, wireTask, "user_id")
	assert.NotContains(t, wireTask, "error_message")
	assert.Contains(t, wireTask, "result_summary")

	// Mapping is read-only: the default full-response source remains untouched.
	assert.Contains(t, page.Tasks[0].Payload, "large_value")
	assert.Contains(t, page.Tasks[0].Result, "large_value")
}

func TestTaskServiceListTaskSummariesPageUsesProjectionAndNormalizesLegacyEnergy(t *testing.T) {
	db, taskRepo, precisionRepo, userRepo := setupTaskServiceTestDB(t)
	// The lightweight projection intentionally uses PostgreSQL JSONB operators.
	// The shared legacy test helper AutoMigrates the domain model as text, while
	// the production migration DO correctly declares both columns as jsonb.
	require.NoError(t, db.Exec(`
		ALTER TABLE analysis_tasks
			ALTER COLUMN payload TYPE jsonb USING payload::jsonb,
			ALTER COLUMN result TYPE jsonb USING result::jsonb
	`).Error)
	svc := NewTaskService(taskRepo, precisionRepo, userRepo)
	ctx := context.Background()
	createdAt := time.Date(2026, 8, 12, 10, 0, 0, 0, time.UTC)
	imageURL := "https://example.com/label.jpg"
	result := map[string]any{
		"recognitionOutcome": "ok",
		"large_value":        strings.Repeat("x", 64*1024),
		"items": []any{map[string]any{
			"name":                 "测试包装食品",
			"nutrition_source":     "ingredient_label",
			"resolve_status":       "ingredient_label",
			"estimatedWeightGrams": 100.0,
			"nutrients": map[string]any{
				"calories": 1674.0,
				"protein":  20.0,
				"carbs":    57.0,
				"fat":      10.0,
			},
			"unit_nutrition_per_100g": map[string]any{
				"energyKj": 1674.0,
				"calories": 1674.0,
				"protein":  20.0,
				"carbs":    57.0,
				"fat":      10.0,
			},
		}},
	}
	require.NoError(t, db.Create(&domain.AnalysisTask{
		ID:         "legacy-label-task",
		UserID:     "summary-user",
		TaskType:   "food",
		Status:     "done",
		ImageURL:   &imageURL,
		ImagePaths: []string{imageURL},
		Payload:    map[string]any{"execution_mode": "standard", "large_value": strings.Repeat("p", 64*1024)},
		Result:     result,
		CreatedAt:  &createdAt,
		UpdatedAt:  &createdAt,
	}).Error)

	page, err := svc.ListTaskSummariesPage(ctx, "summary-user", "", "", 20, 0)
	require.NoError(t, err)
	require.Len(t, page.Tasks, 1)
	require.NotNil(t, page.Tasks[0].ResultSummary)
	assert.Equal(t, "legacy-label-task", page.Tasks[0].ID)
	assert.Equal(t, "测试包装食品", page.Tasks[0].ResultSummary.FirstItemName)
	assert.InDelta(t, 400.1, page.Tasks[0].ResultSummary.TotalCalories, 0.01)
	assert.False(t, page.HasMore)
	assert.Equal(t, 1, page.NextOffset)
}

func TestSummarizeTaskListPageWithoutResult(t *testing.T) {
	summaryPage := SummarizeTaskListPage(TaskListPage{
		Tasks:      []domain.AnalysisTask{{ID: "pending-1", TaskType: "food", Status: "pending"}},
		HasMore:    false,
		NextOffset: 1,
	})

	require.Len(t, summaryPage.Tasks, 1)
	assert.False(t, summaryPage.Tasks[0].HasResult)
	assert.Nil(t, summaryPage.Tasks[0].ResultSummary)
	assert.Equal(t, "image", summaryPage.Tasks[0].SourceType)
	assert.False(t, summaryPage.HasMore)
	assert.Equal(t, 1, summaryPage.NextOffset)
}

func TestTaskServiceUseAnalyzeHistoryThumbnailPreservesOriginalPaths(t *testing.T) {
	original := "https://cdn.example.com/food/users/u1/meal.jpg"
	svc := &TaskService{storage: storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL: "https://cdn.example.com/food",
	})}
	task := domain.AnalysisTask{
		ImageURL:   &original,
		ImagePaths: []string{original, "https://cdn.example.com/food/users/u1/label.jpg"},
	}

	svc.useAnalyzeHistoryThumbnail(&task)

	require.NotNil(t, task.ImageURL)
	assert.Equal(t, "https://cdn.example.com/food/users/u1/meal.jpg?imageMogr2/thumbnail/240x", *task.ImageURL)
	assert.Equal(t, []string{
		"https://cdn.example.com/food/users/u1/meal.jpg",
		"https://cdn.example.com/food/users/u1/label.jpg",
	}, task.ImagePaths)
}

func TestCollectAnalyzeHistorySummaryPagePreservesVisiblePagination(t *testing.T) {
	now := time.Date(2026, 8, 12, 10, 0, 0, 0, time.UTC)
	image := "meal.jpg"
	all := []repo.TaskHistorySummaryRow{
		{ID: "excluded", TaskType: "food", Status: "done", Exercise: true, CreatedAt: &now},
		{ID: "root-new", TaskType: "food", Status: "done", CorrectionRootTaskID: "root", CreatedAt: &now},
		{ID: "root-old", TaskType: "food", Status: "done", CorrectionSourceTaskID: "root", CreatedAt: &now},
		{ID: "image-new", TaskType: "food", Status: "done", ImageURL: &image, CreatedAt: &now},
		{ID: "image-old", TaskType: "food", Status: "done", ImageURL: &image, CreatedAt: &now},
		{ID: "visible-1", TaskType: "food_text", Status: "done", PayloadText: "一碗米饭", CreatedAt: &now},
		{ID: "visible-2", TaskType: "food", Status: "done", CreatedAt: &now},
	}
	var limits []int
	rows, hasMore, nextOffset, err := collectAnalyzeHistorySummaryPage(0, 3, func(offset, limit int) ([]repo.TaskHistorySummaryRow, error) {
		limits = append(limits, limit)
		if offset >= len(all) {
			return nil, nil
		}
		end := offset + limit
		if end > len(all) {
			end = len(all)
		}
		return all[offset:end], nil
	})
	require.NoError(t, err)
	require.Len(t, rows, 3)
	assert.Equal(t, []string{"root-new", "image-new", "visible-1"}, []string{rows[0].ID, rows[1].ID, rows[2].ID})
	assert.True(t, hasMore)
	assert.Equal(t, 6, nextOffset)
	assert.Equal(t, []int{4, 2, 1}, limits)
}

func TestSummarizeTaskResultMatchesIngredientLabelEnergyNormalization(t *testing.T) {
	result := map[string]any{
		"items": []any{map[string]any{
			"name":                 "测试包装食品",
			"nutrition_source":     "ingredient_label",
			"resolve_status":       "ingredient_label",
			"estimatedWeightGrams": 100.0,
			"nutrients": map[string]any{
				"calories": 1674.0,
				"protein":  20.0,
				"carbs":    57.0,
				"fat":      10.0,
			},
			"unit_nutrition_per_100g": map[string]any{
				"energyKj": 1674.0,
				"calories": 1674.0,
				"protein":  20.0,
				"carbs":    57.0,
				"fat":      10.0,
			},
		}},
	}

	normalizeIngredientLabelEnergyInResult(result)
	summary := summarizeTaskResult(result)
	require.NotNil(t, summary)
	assert.InDelta(t, 400.1, summary.TotalCalories, 0.01)
}
