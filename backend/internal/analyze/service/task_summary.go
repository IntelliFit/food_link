package service

import (
	"context"
	"strings"
	"time"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/repo"
)

const taskSummaryTextPreviewRunes = 80

// TaskSummaryListPage is the lightweight representation used by history lists.
// The default task list response deliberately remains TaskListPage so existing
// consumers can continue to receive the complete payload and result documents.
type TaskSummaryListPage struct {
	Tasks      []TaskSummary `json:"tasks"`
	HasMore    bool          `json:"has_more"`
	NextOffset int           `json:"next_offset"`
}

// TaskSummary contains only fields needed to render and paginate task history.
// Large JSON documents such as payload and result must never be added here.
type TaskSummary struct {
	ID              string             `json:"id"`
	TaskType        string             `json:"task_type"`
	Status          string             `json:"status"`
	ImageURL        *string            `json:"image_url,omitempty"`
	ImagePaths      []string           `json:"image_paths,omitempty"`
	TextPreview     string             `json:"text_preview,omitempty"`
	IsViolated      bool               `json:"is_violated,omitempty"`
	ViolationReason *string            `json:"violation_reason,omitempty"`
	IsRecorded      bool               `json:"is_recorded"`
	RecordID        string             `json:"record_id,omitempty"`
	HistoryGroupKey string             `json:"history_group_key,omitempty"`
	HasResult       bool               `json:"has_result"`
	ExecutionMode   string             `json:"execution_mode,omitempty"`
	SourceType      string             `json:"source_type,omitempty"`
	MealType        string             `json:"meal_type,omitempty"`
	RecordedOn      string             `json:"recorded_on,omitempty"`
	ResultSummary   *TaskResultSummary `json:"result_summary,omitempty"`
	CreatedAt       *time.Time         `json:"created_at,omitempty"`
	UpdatedAt       *time.Time         `json:"updated_at,omitempty"`
}

type TaskResultSummary struct {
	FirstItemName      string  `json:"first_item_name,omitempty"`
	ItemCount          int     `json:"item_count"`
	TotalCalories      float64 `json:"total_calories"`
	RecognitionOutcome string  `json:"recognition_outcome,omitempty"`
}

// SummarizeTaskListPage maps a full page to a transport-safe lightweight page
// while preserving pagination metadata exactly.
func SummarizeTaskListPage(page TaskListPage) TaskSummaryListPage {
	tasks := make([]TaskSummary, 0, len(page.Tasks))
	for i := range page.Tasks {
		tasks = append(tasks, summarizeTask(page.Tasks[i]))
	}
	return TaskSummaryListPage{
		Tasks:      tasks,
		HasMore:    page.HasMore,
		NextOffset: page.NextOffset,
	}
}

// ListTaskSummariesPage executes the history list with a database projection.
// Unlike ListTasksPage, this path never transfers complete payload/result JSONB
// documents to Go, which keeps list latency stable when task results are large.
func (s *TaskService) ListTaskSummariesPage(ctx context.Context, userID, status, search string, limit, offset int) (TaskSummaryListPage, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}

	rows, hasMore, nextOffset, err := collectAnalyzeHistorySummaryPage(offset, limit, func(rawOffset, rawLimit int) ([]repo.TaskHistorySummaryRow, error) {
		return s.tasks.ListTaskHistorySummaryRows(ctx, userID, status, search, rawLimit, rawOffset)
	})
	if err != nil {
		return TaskSummaryListPage{}, err
	}

	doneTaskIDs := make([]string, 0, len(rows))
	for i := range rows {
		if rows[i].Status == "done" {
			doneTaskIDs = append(doneTaskIDs, rows[i].ID)
		}
	}
	recordedMap, err := s.tasks.RecordedTaskMap(ctx, userID, doneTaskIDs)
	if err != nil {
		return TaskSummaryListPage{}, err
	}
	energyNormalizationTaskIDs := make([]string, 0)
	for i := range rows {
		if rows[i].NeedsEnergyNormalization {
			energyNormalizationTaskIDs = append(energyNormalizationTaskIDs, rows[i].ID)
		}
	}
	energyNormalizationResults, err := s.tasks.ListTaskHistoryResultsByIDs(ctx, userID, energyNormalizationTaskIDs)
	if err != nil {
		return TaskSummaryListPage{}, err
	}
	normalizedEnergyByTaskID := make(map[string]float64, len(energyNormalizationResults))
	for i := range energyNormalizationResults {
		result := energyNormalizationResults[i].Result
		normalizeIngredientLabelEnergyInResult(result)
		normalizedEnergyByTaskID[energyNormalizationResults[i].ID] = summarizeTaskResult(result).TotalCalories
	}

	tasks := make([]TaskSummary, 0, len(rows))
	for i := range rows {
		row := rows[i]
		task := TaskSummary{
			ID:              row.ID,
			TaskType:        row.TaskType,
			Status:          row.Status,
			ImageURL:        row.ImageURL,
			ImagePaths:      row.ImagePaths,
			TextPreview:     taskTextPreview(row.TextInput),
			IsViolated:      row.IsViolated,
			ViolationReason: row.ViolationReason,
			HistoryGroupKey: summaryHistoryGroupKey(row),
			HasResult:       row.HasResult,
			ExecutionMode:   row.ExecutionMode,
			SourceType:      row.SourceType,
			MealType:        row.MealType,
			RecordedOn:      row.RecordedOn,
			CreatedAt:       row.CreatedAt,
			UpdatedAt:       row.UpdatedAt,
		}
		if task.SourceType == "" {
			if strings.HasPrefix(task.TaskType, "food_text") {
				task.SourceType = "text"
			} else {
				task.SourceType = "image"
			}
		}
		if row.HasResult {
			totalCalories := row.TotalCalories
			if normalizedCalories, ok := normalizedEnergyByTaskID[row.ID]; ok {
				totalCalories = normalizedCalories
			}
			task.ResultSummary = &TaskResultSummary{
				FirstItemName:      row.FirstItemName,
				ItemCount:          row.ItemCount,
				TotalCalories:      totalCalories,
				RecognitionOutcome: row.RecognitionOutcome,
			}
		}
		if recordID, ok := recordedMap[row.ID]; ok {
			task.IsRecorded = true
			task.RecordID = recordID
		}

		// Resolve only the final page's image references. Summary rows normally
		// contain one to three images, and no payload/result JSON is introduced.
		imageTask := domain.AnalysisTask{ImageURL: task.ImageURL, ImagePaths: task.ImagePaths}
		s.normalizeTaskImages(&imageTask)
		s.useAnalyzeHistoryThumbnail(&imageTask)
		task.ImageURL = imageTask.ImageURL
		task.ImagePaths = imageTask.ImagePaths
		tasks = append(tasks, task)
	}

	return TaskSummaryListPage{Tasks: tasks, HasMore: hasMore, NextOffset: nextOffset}, nil
}

type analyzeHistorySummaryPageFetcher func(offset, limit int) ([]repo.TaskHistorySummaryRow, error)

func collectAnalyzeHistorySummaryPage(offset, limit int, fetch analyzeHistorySummaryPageFetcher) ([]repo.TaskHistorySummaryRow, bool, int, error) {
	cursor := offset
	seen := make(map[string]bool, limit)
	rows := make([]repo.TaskHistorySummaryRow, 0, limit)
	for {
		batchSize := limit - len(rows) + 1
		batch, err := fetch(cursor, batchSize)
		if err != nil {
			return nil, false, offset, err
		}
		if len(batch) == 0 {
			return rows, false, cursor, nil
		}
		for index, row := range batch {
			if isSummaryRowExcludedFromAnalyzeHistory(row) {
				continue
			}
			groupKey := summaryHistoryGroupKey(row)
			if seen[groupKey] {
				continue
			}
			if len(rows) == limit {
				return rows, true, cursor + index, nil
			}
			seen[groupKey] = true
			rows = append(rows, row)
		}
		cursor += len(batch)
		if len(batch) < batchSize {
			return rows, false, cursor, nil
		}
	}
}

func isSummaryRowExcludedFromAnalyzeHistory(row repo.TaskHistorySummaryRow) bool {
	if row.ExpiryRecognition || row.Exercise {
		return true
	}
	if strings.HasPrefix(row.TaskType, "precision_item_estimate") ||
		strings.HasPrefix(row.TaskType, "health_report") ||
		strings.HasPrefix(row.TaskType, "public_food_library_text") ||
		strings.HasPrefix(row.TaskType, "exercise") {
		return true
	}
	return strings.HasPrefix(row.TaskType, "precision_plan") && row.Status == "done" && strings.TrimSpace(row.RedirectTaskID) != ""
}

func summaryHistoryGroupKey(row repo.TaskHistorySummaryRow) string {
	if rootID := strings.TrimSpace(row.CorrectionRootTaskID); rootID != "" {
		return "root:" + rootID
	}
	if sourceID := strings.TrimSpace(row.CorrectionSourceTaskID); sourceID != "" {
		return "root:" + sourceID
	}
	parts := row.ImagePaths
	if len(parts) == 0 && row.ImageURL != nil && strings.TrimSpace(*row.ImageURL) != "" {
		parts = []string{strings.TrimSpace(*row.ImageURL)}
	} else if len(parts) == 0 && len(row.PayloadImageURLs) > 0 {
		parts = row.PayloadImageURLs
	} else if len(parts) == 0 && strings.TrimSpace(row.PayloadImageURL) != "" {
		parts = []string{strings.TrimSpace(row.PayloadImageURL)}
	}
	fingerprint := ""
	if len(parts) > 0 {
		fingerprint = "image:" + strings.Join(parts, "|")
	} else if row.TextInput != nil && strings.TrimSpace(*row.TextInput) != "" {
		fingerprint = "text:" + strings.Join(strings.Fields(*row.TextInput), " ")
	} else if text := strings.TrimSpace(row.PayloadText); text != "" {
		fingerprint = "text:" + strings.Join(strings.Fields(text), " ")
	}
	if fingerprint != "" {
		createdDate := "unknown"
		if row.CreatedAt != nil {
			createdDate = row.CreatedAt.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
		}
		return "input:" + createdDate + ":" + fingerprint
	}
	return "task:" + row.ID
}

func summarizeTask(task domain.AnalysisTask) TaskSummary {
	payload := task.Payload
	hasResult := task.Result != nil
	var resultSummary *TaskResultSummary
	if hasResult {
		resultSummary = summarizeTaskResult(task.Result)
	}

	return TaskSummary{
		ID:              task.ID,
		TaskType:        task.TaskType,
		Status:          task.Status,
		ImageURL:        task.ImageURL,
		ImagePaths:      task.ImagePaths,
		TextPreview:     taskTextPreview(task.TextInput),
		IsViolated:      task.IsViolated,
		ViolationReason: task.ViolationReason,
		IsRecorded:      task.IsRecorded,
		RecordID:        task.RecordID,
		HistoryGroupKey: task.HistoryGroupKey,
		HasResult:       hasResult,
		ExecutionMode:   firstSummaryString(payload, "execution_mode", "executionMode"),
		SourceType:      taskSummarySourceType(task),
		MealType:        firstSummaryString(payload, "meal_type", "mealType"),
		RecordedOn:      firstSummaryString(payload, "date", "recorded_on", "recordedOn"),
		ResultSummary:   resultSummary,
		CreatedAt:       task.CreatedAt,
		UpdatedAt:       task.UpdatedAt,
	}
}

func summarizeTaskResult(result map[string]any) *TaskResultSummary {
	items := toItems(result["items"])
	summary := &TaskResultSummary{
		ItemCount:          len(items),
		RecognitionOutcome: firstSummaryString(result, "recognitionOutcome", "recognition_outcome"),
	}
	if len(items) > 0 {
		summary.FirstItemName = stringFromAny(items[0]["name"])
	}
	for _, item := range items {
		summary.TotalCalories += numberFromAny(mapFromAny(item["nutrients"])["calories"])
	}
	return summary
}

func taskTextPreview(text *string) string {
	if text == nil {
		return ""
	}
	normalized := strings.Join(strings.Fields(*text), " ")
	runes := []rune(normalized)
	if len(runes) <= taskSummaryTextPreviewRunes {
		return normalized
	}
	return string(runes[:taskSummaryTextPreviewRunes]) + "…"
}

func taskSummarySourceType(task domain.AnalysisTask) string {
	if sourceType := firstSummaryString(task.Payload, "source_type", "sourceType"); sourceType != "" {
		return sourceType
	}
	if strings.HasPrefix(task.TaskType, "food_text") {
		return "text"
	}
	return "image"
}

func firstSummaryString(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := stringFromAny(values[key]); value != "" {
			return value
		}
	}
	return ""
}
