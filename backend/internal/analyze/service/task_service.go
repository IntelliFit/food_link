package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/repo"
	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/common/dateutil"
	"food_link/backend/internal/common/errors"
	"food_link/backend/pkg/storage"
)

type TaskService struct {
	tasks       *repo.TaskRepo
	precision   *repo.PrecisionRepo
	users       *authrepo.UserRepo
	storage     *storage.Client
	creditGuard CreditGuard
}

func NewTaskService(tasks *repo.TaskRepo, precision *repo.PrecisionRepo, users *authrepo.UserRepo, storageClient ...*storage.Client) *TaskService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &TaskService{tasks: tasks, precision: precision, users: users, storage: client}
}

type CreditGuard interface {
	ValidateFoodAnalysisCredits(ctx context.Context, userID, executionMode, recordedOn string) (map[string]any, error)
	ConsumeEarnedCreditsAfterSuccess(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error
}

func (s *TaskService) ConfigureCreditGuard(guard CreditGuard) {
	s.creditGuard = guard
}

type SubmitTaskInput struct {
	ImageURL              string           `json:"image_url"`
	ImageURLs             []string         `json:"image_urls"`
	Text                  string           `json:"text"`
	TextInput             string           `json:"text_input"`
	Date                  string           `json:"date"`
	MealType              string           `json:"meal_type"`
	Province              string           `json:"province"`
	City                  string           `json:"city"`
	District              string           `json:"district"`
	DietGoal              string           `json:"diet_goal"`
	ActivityTiming        string           `json:"activity_timing"`
	UserGoal              string           `json:"user_goal"`
	RemainingCalories     *float64         `json:"remaining_calories"`
	AdditionalContext     string           `json:"additionalContext"`
	ModelName             string           `json:"modelName"`
	ExecutionMode         *string          `json:"execution_mode"`
	PrecisionSessionID    *string          `json:"precision_session_id"`
	AnalysisEngine        string           `json:"analysis_engine"`
	TimezoneOffsetMinutes *int             `json:"timezone_offset_minutes"`
	IsMultiView           bool             `json:"is_multi_view"`
	PreviousResult        map[string]any   `json:"previousResult"`
	CorrectionItems       []map[string]any `json:"correctionItems"`
	ReferenceObjects      []map[string]any `json:"reference_objects"`
	SubscribeStatus       string           `json:"subscribe_status"`
	SourceType            string           `json:"source_type"`
}

func (s *TaskService) SubmitAnalyzeTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		return "", &errors.AppError{Code: 10002, Message: "image_url 或 image_urls 不能为空", HTTPStatus: 400}
	}

	recordedOn, err := dateutil.ResolveRecordedOnDate(input.Date, "date")
	if err != nil {
		return "", err
	}
	input.Date = recordedOn

	mode := normalizeExecutionMode(input.ExecutionMode)
	if userID != "" {
		user, err := s.users.FindByID(ctx, userID)
		if err == nil && user != nil && input.ExecutionMode == nil {
			mode = normalizeExecutionMode(user.ExecutionMode)
		}
	}

	payload := map[string]any{
		"meal_type":          input.MealType,
		"province":           input.Province,
		"city":               input.City,
		"district":           input.District,
		"diet_goal":          input.DietGoal,
		"activity_timing":    input.ActivityTiming,
		"user_goal":          input.UserGoal,
		"remaining_calories": input.RemainingCalories,
		"additionalContext":  input.AdditionalContext,
		"modelName":          input.ModelName,
		"execution_mode":     mode,
		"analysis_engine":    input.AnalysisEngine,
		"recorded_on":        recordedOn,
	}
	applySubmitCompatibilityPayload(payload, input)

	creditMode := mode
	if input.PrecisionSessionID != nil {
		creditMode = validExecutionMode
	}
	creditsInfo, creditCost, err := s.applyFoodCreditGuard(ctx, userID, creditMode, input.Date, payload)
	if err != nil {
		return "", err
	}

	if mode == validExecutionMode || input.PrecisionSessionID != nil {
		taskID, err := s.submitPrecisionTask(ctx, userID, input, payload)
		if err != nil {
			return "", err
		}
		s.consumeFoodCredits(ctx, userID, creditsInfo, creditCost, taskID, "precision_plan")
		return taskID, nil
	}

	var imageURL *string
	if input.ImageURL != "" {
		imageURL = &input.ImageURL
	}

	task := &domain.AnalysisTask{
		UserID:     userID,
		TaskType:   "food",
		Status:     "pending",
		ImageURL:   imageURL,
		ImagePaths: input.ImageURLs,
		Payload:    payload,
	}
	if err := s.tasks.CreateTask(ctx, task); err != nil {
		return "", err
	}
	s.consumeFoodCredits(ctx, userID, creditsInfo, creditCost, task.ID, task.TaskType)
	return task.ID, nil
}

func (s *TaskService) SubmitTextTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	if input.TextInput == "" {
		input.TextInput = input.Text
	}
	if input.TextInput == "" && !hasPrecisionSupplement(input) {
		return "", &errors.AppError{Code: 10002, Message: "text 不能为空", HTTPStatus: 400}
	}

	recordedOn, err := dateutil.ResolveRecordedOnDate(input.Date, "date")
	if err != nil {
		return "", err
	}
	input.Date = recordedOn

	mode := normalizeExecutionMode(input.ExecutionMode)
	if userID != "" {
		user, err := s.users.FindByID(ctx, userID)
		if err == nil && user != nil && input.ExecutionMode == nil {
			mode = normalizeExecutionMode(user.ExecutionMode)
		}
	}

	payload := map[string]any{
		"meal_type":          input.MealType,
		"province":           input.Province,
		"city":               input.City,
		"district":           input.District,
		"diet_goal":          input.DietGoal,
		"activity_timing":    input.ActivityTiming,
		"user_goal":          input.UserGoal,
		"remaining_calories": input.RemainingCalories,
		"additionalContext":  input.AdditionalContext,
		"modelName":          input.ModelName,
		"execution_mode":     mode,
		"analysis_engine":    input.AnalysisEngine,
		"recorded_on":        recordedOn,
	}
	applySubmitCompatibilityPayload(payload, input)

	creditMode := mode
	if input.PrecisionSessionID != nil {
		creditMode = validExecutionMode
	}
	creditsInfo, creditCost, err := s.applyFoodCreditGuard(ctx, userID, creditMode, input.Date, payload)
	if err != nil {
		return "", err
	}

	if mode == validExecutionMode || input.PrecisionSessionID != nil {
		taskID, err := s.submitPrecisionTask(ctx, userID, input, payload)
		if err != nil {
			return "", err
		}
		s.consumeFoodCredits(ctx, userID, creditsInfo, creditCost, taskID, "precision_plan")
		return taskID, nil
	}

	text := input.TextInput
	task := &domain.AnalysisTask{
		UserID:    userID,
		TaskType:  "food_text",
		Status:    "pending",
		TextInput: &text,
		Payload:   payload,
	}
	if err := s.tasks.CreateTask(ctx, task); err != nil {
		return "", err
	}
	s.consumeFoodCredits(ctx, userID, creditsInfo, creditCost, task.ID, task.TaskType)
	return task.ID, nil
}

func (s *TaskService) applyFoodCreditGuard(ctx context.Context, userID, executionMode, recordedOn string, payload map[string]any) (map[string]any, int, error) {
	if s.creditGuard == nil || userID == "" {
		return nil, 0, nil
	}
	creditsInfo, err := s.creditGuard.ValidateFoodAnalysisCredits(ctx, userID, executionMode, recordedOn)
	if err != nil {
		return nil, 0, err
	}
	cost := intFromAny(creditsInfo["credit_cost"])
	if spendPlan, ok := creditsInfo["credit_spend_plan"]; ok {
		payload["credit_usage"] = spendPlan
		if plan, ok := spendPlan.(map[string]any); ok {
			if recorded := stringFromAny(plan["recorded_on"]); recorded != "" {
				payload["recorded_on"] = recorded
			}
		}
	}
	return creditsInfo, cost, nil
}

func applySubmitCompatibilityPayload(payload map[string]any, input SubmitTaskInput) {
	if input.TimezoneOffsetMinutes != nil {
		payload["timezone_offset_minutes"] = *input.TimezoneOffsetMinutes
	}
	if input.IsMultiView {
		payload["is_multi_view"] = true
	}
	if len(input.PreviousResult) > 0 {
		payload["previousResult"] = input.PreviousResult
	}
	if len(input.CorrectionItems) > 0 {
		payload["correctionItems"] = input.CorrectionItems
	}
	if len(input.ReferenceObjects) > 0 {
		payload["reference_objects"] = input.ReferenceObjects
	}
	if strings.TrimSpace(input.SubscribeStatus) != "" {
		payload["subscribe_status"] = strings.TrimSpace(input.SubscribeStatus)
	}
	if strings.TrimSpace(input.SourceType) != "" {
		payload["source_type"] = strings.ToLower(strings.TrimSpace(input.SourceType))
	}
}

func hasPrecisionSupplement(input SubmitTaskInput) bool {
	if input.PrecisionSessionID == nil || strings.TrimSpace(*input.PrecisionSessionID) == "" {
		return false
	}
	return strings.TrimSpace(input.AdditionalContext) != "" ||
		len(input.ReferenceObjects) > 0 ||
		len(input.CorrectionItems) > 0 ||
		len(input.PreviousResult) > 0
}

func (s *TaskService) consumeFoodCredits(ctx context.Context, userID string, creditsInfo map[string]any, cost int, taskID, taskType string) {
	if s.creditGuard == nil || userID == "" || creditsInfo == nil || taskID == "" {
		return
	}
	_ = s.creditGuard.ConsumeEarnedCreditsAfterSuccess(ctx, userID, creditsInfo, cost, "food_analysis_reward_spend", "food_analysis:"+taskID, map[string]any{
		"task_id":   taskID,
		"task_type": taskType,
	})
}

func (s *TaskService) submitPrecisionTask(ctx context.Context, userID string, input SubmitTaskInput, payload map[string]any) (string, error) {
	sourceType := precisionSourceType(input)
	payload["source_type"] = sourceType
	if input.TextInput != "" {
		payload["text"] = input.TextInput
	}
	if input.ImageURL != "" {
		payload["image_url"] = input.ImageURL
	}
	if len(input.ImageURLs) > 0 {
		payload["image_urls"] = input.ImageURLs
	}

	var session *domain.PrecisionSession
	if input.PrecisionSessionID != nil && *input.PrecisionSessionID != "" {
		existing, err := s.precision.GetSessionByID(ctx, *input.PrecisionSessionID)
		if err != nil {
			return "", err
		}
		if existing == nil {
			return "", errors.ErrNotFound
		}
		if existing.UserID != userID {
			return "", errors.ErrForbidden
		}
		if strings.TrimSpace(existing.SourceType) != "" && strings.TrimSpace(existing.SourceType) != sourceType {
			return "", &errors.AppError{Code: 10002, Message: "source_type does not match precision session", HTTPStatus: 400}
		}
		if !precisionSessionCanContinue(existing.Status) {
			return "", &errors.AppError{Code: 10002, Message: "该精准模式会话已结束，无法继续", HTTPStatus: 400}
		}
		nextRound := existing.RoundIndex + 1
		latestInputs := copyMap(existing.LatestInputs)
		for key, value := range payload {
			latestInputs[key] = value
		}
		sessionUpdates := map[string]any{
			"status":        "collecting",
			"round_index":   nextRound,
			"latest_inputs": latestInputs,
			"updated_at":    time.Now(),
		}
		if len(input.ReferenceObjects) > 0 {
			sessionUpdates["reference_objects"] = referenceObjectsAsAny(input.ReferenceObjects)
		}
		if err := s.precision.UpdateSession(ctx, existing.ID, sessionUpdates); err != nil {
			return "", err
		}
		if err := s.precision.CreateRound(ctx, &domain.PrecisionSessionRound{
			SessionID:    existing.ID,
			RoundIndex:   nextRound,
			ActorRole:    "user",
			InputPayload: payload,
		}); err != nil {
			return "", err
		}
		session = existing
		session.RoundIndex = nextRound
		session.LatestInputs = latestInputs
	} else {
		newSession := &domain.PrecisionSession{
			UserID:           userID,
			SourceType:       sourceType,
			ExecutionMode:    "strict",
			Status:           "collecting",
			RoundIndex:       1,
			LatestInputs:     payload,
			ReferenceObjects: referenceObjectsAsAny(input.ReferenceObjects),
		}
		if err := s.precision.CreateSession(ctx, newSession); err != nil {
			return "", err
		}
		if err := s.precision.CreateRound(ctx, &domain.PrecisionSessionRound{
			SessionID:    newSession.ID,
			RoundIndex:   1,
			ActorRole:    "user",
			InputPayload: payload,
		}); err != nil {
			return "", err
		}
		session = newSession
	}

	payload["precision_session_id"] = session.ID
	payload["round_index"] = session.RoundIndex

	var imageURL *string
	if input.ImageURL != "" {
		imageURL = &input.ImageURL
	}

	task := &domain.AnalysisTask{
		UserID:     userID,
		TaskType:   "precision_plan",
		Status:     "pending",
		ImageURL:   imageURL,
		ImagePaths: input.ImageURLs,
		TextInput:  nil,
		Payload:    payload,
	}
	if input.TextInput != "" {
		text := input.TextInput
		task.TextInput = &text
	}
	if err := s.tasks.CreateTask(ctx, task); err != nil {
		return "", err
	}
	if err := s.precision.UpdateSession(ctx, session.ID, map[string]any{
		"current_task_id": task.ID,
		"updated_at":      time.Now(),
	}); err != nil {
		return "", err
	}
	return task.ID, nil
}

func copyMap(in map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range in {
		out[key] = value
	}
	return out
}

func precisionSessionCanContinue(status string) bool {
	switch status {
	case "collecting", "estimating", "needs_user_input", "needs_retake", "active":
		return true
	default:
		return false
	}
}

func precisionSourceType(input SubmitTaskInput) string {
	requested := strings.ToLower(strings.TrimSpace(input.SourceType))
	if requested == "image" || requested == "text" {
		return requested
	}
	if input.TextInput != "" && input.ImageURL == "" && len(input.ImageURLs) == 0 {
		return "text"
	}
	return "image"
}

func referenceObjectsAsAny(items []map[string]any) []any {
	if len(items) == 0 {
		return []any{}
	}
	out := make([]any, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}

func (s *TaskService) ListTasks(ctx context.Context, userID, taskType, status string, limit int) ([]domain.AnalysisTask, error) {
	tasks, err := s.tasks.ListTasksByUser(ctx, userID, taskType, status, limit)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(taskType) == "" {
		tasks = filterAnalyzeHistoryTasks(tasks)
	}
	doneTaskIDs := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.Status == "done" {
			doneTaskIDs = append(doneTaskIDs, task.ID)
		}
	}
	recordedMap, err := s.tasks.RecordedTaskMap(ctx, userID, doneTaskIDs)
	if err != nil {
		return nil, err
	}
	for i := range tasks {
		s.normalizeTaskImages(&tasks[i])
		if tasks[i].Status == "done" {
			if recordID, ok := recordedMap[tasks[i].ID]; ok {
				tasks[i].IsRecorded = true
				tasks[i].RecordID = recordID
			}
		}
	}
	return tasks, nil
}

func (s *TaskService) CountTasks(ctx context.Context, userID string) (int64, error) {
	tasks, err := s.tasks.ListTasksByUser(ctx, userID, "", "", 10000)
	if err != nil {
		return 0, err
	}
	return int64(len(filterAnalyzeHistoryTasks(tasks))), nil
}

func (s *TaskService) CountTasksByStatus(ctx context.Context, userID string) (map[string]any, error) {
	tasks, err := s.tasks.ListTasksByUser(ctx, userID, "", "", 500)
	if err != nil {
		return nil, err
	}
	tasks = filterAnalyzeHistoryTasks(tasks)
	doneTaskIDs := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.Status == "done" {
			doneTaskIDs = append(doneTaskIDs, task.ID)
		}
	}
	recordedMap, err := s.tasks.RecordedTaskMap(ctx, userID, doneTaskIDs)
	if err != nil {
		return nil, err
	}
	var recognizing, waitingRecord, recorded int64
	waitingTasks := make([]domain.AnalysisTask, 0)
	for _, task := range tasks {
		switch task.Status {
		case "pending", "processing":
			recognizing++
		case "done":
			if _, ok := recordedMap[task.ID]; ok {
				recorded++
			} else {
				waitingRecord++
				waitingTasks = append(waitingTasks, task)
			}
		}
	}
	hasUnseen := waitingRecord > 0
	if hasUnseen && s.users != nil {
		if user, err := s.users.FindByID(ctx, userID); err == nil && user != nil && user.LastSeenAnalyzeHistory != nil {
			hasUnseen = false
			for _, task := range waitingTasks {
				if task.CreatedAt != nil && task.CreatedAt.After(*user.LastSeenAnalyzeHistory) {
					hasUnseen = true
					break
				}
			}
		}
	}
	return map[string]any{
		"recognizing":               recognizing,
		"waiting_record":            waitingRecord,
		"recorded":                  recorded,
		"has_unseen_waiting_record": hasUnseen,
	}, nil
}

func (s *TaskService) GetTask(ctx context.Context, taskID, userID string) (*domain.AnalysisTask, error) {
	task, err := s.tasks.GetTaskByID(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, errors.ErrNotFound
	}
	if task.UserID != userID {
		return nil, errors.ErrForbidden
	}
	s.normalizeTaskImages(task)
	if task.Status == "done" {
		recordedMap, err := s.tasks.RecordedTaskMap(ctx, userID, []string{task.ID})
		if err != nil {
			return nil, err
		}
		if recordID, ok := recordedMap[task.ID]; ok {
			task.IsRecorded = true
			task.RecordID = recordID
		}
	}
	return task, nil
}

func (s *TaskService) UpdateTaskResult(ctx context.Context, taskID, userID string, result map[string]any) error {
	task, err := s.tasks.GetTaskByID(ctx, taskID)
	if err != nil {
		return err
	}
	if task == nil {
		return errors.ErrNotFound
	}
	if task.UserID != userID {
		return errors.ErrForbidden
	}
	return s.tasks.UpdateTaskResult(ctx, taskID, result)
}

func (s *TaskService) DeleteTask(ctx context.Context, taskID, userID string) (map[string]any, error) {
	task, err := s.tasks.GetTaskByID(ctx, taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, errors.ErrNotFound
	}
	if task.UserID != userID {
		return nil, errors.ErrForbidden
	}

	// If pending/processing, mark cancelled first
	if task.Status == "pending" || task.Status == "processing" {
		_ = s.tasks.UpdateTaskStatus(ctx, taskID, "cancelled", nil)
		time.Sleep(100 * time.Millisecond)
	}

	if err := s.tasks.DeleteTask(ctx, taskID, userID); err != nil {
		return nil, err
	}

	deletedImages := 0
	if task.ImageURL != nil && *task.ImageURL != "" {
		deletedImages++
	}
	deletedImages += len(task.ImagePaths)

	return map[string]any{
		"deleted":        true,
		"task_id":        taskID,
		"deleted_images": deletedImages,
	}, nil
}

func (s *TaskService) CleanupTimeoutTasks(ctx context.Context, timeoutMinutes int, adminKey, expectedAdminKey string) (int64, error) {
	if adminKey != expectedAdminKey {
		return 0, errors.ErrForbidden
	}
	return s.tasks.MarkTimedOutTasks(ctx, timeoutMinutes)
}

func (s *TaskService) CreateBatchTask(ctx context.Context, userID string, imageURLs []string, payload map[string]any, result map[string]any) (string, error) {
	var imageURL *string
	if len(imageURLs) > 0 {
		imageURL = &imageURLs[0]
	}
	task := &domain.AnalysisTask{
		UserID:     userID,
		TaskType:   "food",
		Status:     "done",
		ImageURL:   imageURL,
		ImagePaths: imageURLs,
		Payload:    payload,
		Result:     result,
	}
	if err := s.tasks.CreateTask(ctx, task); err != nil {
		return "", err
	}
	return task.ID, nil
}

func (s *TaskService) normalizeTaskImages(task *domain.AnalysisTask) {
	if task == nil {
		return
	}
	normalized := make([]string, 0, len(task.ImagePaths))
	seen := make(map[string]struct{}, len(task.ImagePaths))
	for _, path := range task.ImagePaths {
		resolved := s.resolveFoodImageURL(path)
		if resolved == "" {
			continue
		}
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		normalized = append(normalized, resolved)
	}
	task.ImagePaths = normalized
	if len(task.ImagePaths) > 0 {
		first := task.ImagePaths[0]
		task.ImageURL = &first
		return
	}
	if task.ImageURL != nil {
		resolved := s.resolveFoodImageURL(*task.ImageURL)
		if resolved == "" {
			task.ImageURL = nil
			return
		}
		task.ImageURL = &resolved
		task.ImagePaths = []string{resolved}
	}
}

func (s *TaskService) resolveFoodImageURL(path string) string {
	if s.storage == nil {
		return path
	}
	return s.storage.ResolveReferenceURL("food-images", path)
}

func filterAnalyzeHistoryTasks(tasks []domain.AnalysisTask) []domain.AnalysisTask {
	out := make([]domain.AnalysisTask, 0, len(tasks))
	for _, task := range tasks {
		if isTaskExcludedFromAnalyzeHistory(task) {
			continue
		}
		out = append(out, task)
	}
	return out
}

func isTaskExcludedFromAnalyzeHistory(task domain.AnalysisTask) bool {
	if boolFromAny(task.Payload["expiry_recognition"]) || boolFromAny(task.Payload["exercise"]) {
		return true
	}
	taskType := task.TaskType
	if strings.HasPrefix(taskType, "precision_item_estimate") ||
		strings.HasPrefix(taskType, "health_report") ||
		strings.HasPrefix(taskType, "public_food_library_text") ||
		strings.HasPrefix(taskType, "exercise") {
		return true
	}
	if strings.HasPrefix(taskType, "precision_plan") &&
		task.Status == "done" &&
		strings.TrimSpace(stringFromAny(task.Result["redirectTaskId"])) != "" {
		return true
	}
	return false
}

func boolFromAny(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		text := strings.TrimSpace(v)
		return strings.EqualFold(text, "true") || text == "1"
	case int:
		return v != 0
	case int64:
		return v != 0
	case float64:
		return v != 0
	default:
		return false
	}
}

func intFromAny(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case int32:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	case json.Number:
		i, _ := v.Int64()
		return int(i)
	default:
		return 0
	}
}

func stringFromAny(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprintf("%v", value))
	if text == "<nil>" {
		return ""
	}
	return text
}

// ValidateQuota keeps the legacy admin/test hook wired into the same membership
// guard used by normal food submissions.
func (s *TaskService) ValidateQuota(ctx context.Context, userID string) error {
	if s.creditGuard == nil || strings.TrimSpace(userID) == "" {
		return nil
	}
	recordedOn := time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
	_, err := s.creditGuard.ValidateFoodAnalysisCredits(ctx, userID, "standard", recordedOn)
	return err
}
