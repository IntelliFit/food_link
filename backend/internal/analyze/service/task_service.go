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
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
	apm "food_link/backend/pkg/trace"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"
	"log/slog"
)

type TaskService struct {
	tasks       *repo.TaskRepo
	precision   *repo.PrecisionRepo
	users       *authrepo.UserRepo
	storage     *storage.Client
	creditGuard CreditGuard
	taskQueue   taskqueue.Publisher
}

const (
	waitingRecordBadgeWindow = 24 * time.Hour
	maxFoodAnalyzeImages     = 3
)

const experimentalExecutionMode = "experimental"

func NewTaskService(tasks *repo.TaskRepo, precision *repo.PrecisionRepo, users *authrepo.UserRepo, storageClient ...*storage.Client) *TaskService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &TaskService{tasks: tasks, precision: precision, users: users, storage: client}
}

type CreditGuard interface {
	ValidateFoodAnalysisCredits(ctx context.Context, userID, executionMode, recordedOn string, units ...int) (map[string]any, error)
	ConsumeEarnedCreditsOnTaskCreated(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error
	RefundEarnedCreditsAfterTaskFailure(ctx context.Context, userID string, creditsInfo map[string]any, cost int, spendReason, spendSourceKey, refundReason, refundSourceKey string, meta map[string]any) error
}

func (s *TaskService) ConfigureCreditGuard(guard CreditGuard) {
	s.creditGuard = guard
}

func (s *TaskService) ConfigureTaskPublisher(queue taskqueue.Publisher) {
	s.taskQueue = queue
}

type SubmitTaskInput struct {
	ImageURL               string           `json:"image_url"`
	ImageURLs              []string         `json:"image_urls"`
	Text                   string           `json:"text"`
	TextInput              string           `json:"text_input"`
	Date                   string           `json:"date"`
	MealType               string           `json:"meal_type"`
	Province               string           `json:"province"`
	City                   string           `json:"city"`
	District               string           `json:"district"`
	DietGoal               string           `json:"diet_goal"`
	ActivityTiming         string           `json:"activity_timing"`
	UserGoal               string           `json:"user_goal"`
	RemainingCalories      *float64         `json:"remaining_calories"`
	SuggestRatioEnabled    bool             `json:"suggest_ratio_enabled"`
	AdditionalContext      string           `json:"additionalContext"`
	ModelName              string           `json:"modelName"`
	ExecutionMode          *string          `json:"execution_mode"`
	PrecisionSessionID     *string          `json:"precision_session_id"`
	AnalysisEngine         string           `json:"analysis_engine"`
	TimezoneOffsetMinutes  *int             `json:"timezone_offset_minutes"`
	IsMultiView            bool             `json:"is_multi_view"`
	PreviousResult         map[string]any   `json:"previousResult"`
	CorrectionItems        []map[string]any `json:"correctionItems"`
	CorrectionSourceTaskID string           `json:"correction_source_task_id"`
	CorrectionRootTaskID   string           `json:"correction_root_task_id"`
	ReferenceObjects       []map[string]any `json:"reference_objects"`
	SourceType             string           `json:"source_type"`
}

func (s *TaskService) SubmitAnalyzeTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	s.normalizeSubmitImages(&input)
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		return "", &errors.AppError{Code: 10002, Message: "image_url 或 image_urls 不能为空", HTTPStatus: 400}
	}
	if imageCountForLog(input.ImageURL, input.ImageURLs) > maxFoodAnalyzeImages {
		return "", &errors.AppError{Code: 10002, Message: "最多支持 3 张图片", HTTPStatus: 400}
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
		"meal_type":             input.MealType,
		"province":              input.Province,
		"city":                  input.City,
		"district":              input.District,
		"diet_goal":             input.DietGoal,
		"activity_timing":       input.ActivityTiming,
		"user_goal":             input.UserGoal,
		"remaining_calories":    input.RemainingCalories,
		"suggest_ratio_enabled": input.SuggestRatioEnabled,
		"additionalContext":     input.AdditionalContext,
		"modelName":             input.ModelName,
		"execution_mode":        mode,
		"analysis_engine":       input.AnalysisEngine,
		"recorded_on":           recordedOn,
	}
	applySubmitCompatibilityPayload(payload, input)
	s.attachCorrectionChain(ctx, userID, input, payload)

	creditMode := mode
	if mode == experimentalExecutionMode || input.PrecisionSessionID != nil {
		creditMode = validExecutionMode
	}
	if boolFromAny(payload["is_correction"]) {
		creditMode = correctionCreditMode(creditMode)
	}
	creditsInfo, creditCost, err := s.applyFoodCreditGuard(ctx, userID, creditMode, input.Date, creditUnitsForInput(input), payload)
	if err != nil {
		return "", err
	}
	creditGroupID := ensureCreditGroupID(payload)

	if mode == experimentalExecutionMode || input.PrecisionSessionID != nil {
		taskID, err := s.submitPrecisionTask(ctx, userID, input, payload, creditsInfo, creditCost, creditGroupID)
		if err != nil {
			return "", err
		}
		logAnalyzeTaskSubmitted(ctx, userID, taskID, "precision_plan", input, payload)
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
	if err := s.consumeTaskCredits(ctx, userID, creditsInfo, creditCost, creditGroupID, task.ID, task.TaskType); err != nil {
		_, _ = s.tasks.FailTask(ctx, task.ID, "credit reservation failed")
		return "", err
	}
	if err := s.enqueueTask(ctx, task); err != nil {
		s.refundTaskCredits(ctx, task)
		return "", err
	}
	logAnalyzeTaskSubmitted(ctx, userID, task.ID, task.TaskType, input, payload)
	return task.ID, nil
}

func (s *TaskService) SubmitTextTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	if input.TextInput == "" {
		input.TextInput = input.Text
	}
	s.normalizeSubmitImages(&input)
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
		"meal_type":             input.MealType,
		"province":              input.Province,
		"city":                  input.City,
		"district":              input.District,
		"diet_goal":             input.DietGoal,
		"activity_timing":       input.ActivityTiming,
		"user_goal":             input.UserGoal,
		"remaining_calories":    input.RemainingCalories,
		"suggest_ratio_enabled": input.SuggestRatioEnabled,
		"additionalContext":     input.AdditionalContext,
		"modelName":             input.ModelName,
		"execution_mode":        mode,
		"analysis_engine":       input.AnalysisEngine,
		"recorded_on":           recordedOn,
	}
	applySubmitCompatibilityPayload(payload, input)
	s.attachCorrectionChain(ctx, userID, input, payload)

	creditMode := mode
	if mode == experimentalExecutionMode || input.PrecisionSessionID != nil {
		creditMode = validExecutionMode
	}
	if boolFromAny(payload["is_correction"]) {
		creditMode = correctionCreditMode(creditMode)
	}
	creditsInfo, creditCost, err := s.applyFoodCreditGuard(ctx, userID, creditMode, input.Date, creditUnitsForInput(input), payload)
	if err != nil {
		return "", err
	}
	creditGroupID := ensureCreditGroupID(payload)

	if mode == experimentalExecutionMode || input.PrecisionSessionID != nil {
		taskID, err := s.submitPrecisionTask(ctx, userID, input, payload, creditsInfo, creditCost, creditGroupID)
		if err != nil {
			return "", err
		}
		logAnalyzeTaskSubmitted(ctx, userID, taskID, "precision_plan", input, payload)
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
	if err := s.consumeTaskCredits(ctx, userID, creditsInfo, creditCost, creditGroupID, task.ID, task.TaskType); err != nil {
		_, _ = s.tasks.FailTask(ctx, task.ID, "credit reservation failed")
		return "", err
	}
	if err := s.enqueueTask(ctx, task); err != nil {
		s.refundTaskCredits(ctx, task)
		return "", err
	}
	logAnalyzeTaskSubmitted(ctx, userID, task.ID, task.TaskType, input, payload)
	return task.ID, nil
}

func logAnalyzeTaskSubmitted(ctx context.Context, userID, taskID, taskType string, input SubmitTaskInput, payload map[string]any) {
	modelName := strings.TrimSpace(input.ModelName)
	executionMode := stringFromAny(payload["execution_mode"])
	analysisEngine := stringFromAny(payload["analysis_engine"])
	sourceType := strings.TrimSpace(input.SourceType)
	imageCount := imageCountForLog(input.ImageURL, input.ImageURLs)
	hasText := strings.TrimSpace(input.TextInput) != "" || strings.TrimSpace(input.Text) != ""
	logger.WithTrace(ctx).Info("分析任务已提交",
		slog.String("task_id", taskID),
		logger.AnalysisTaskID(taskID),
		slog.String("task_type", taskType),
		slog.String("user_id", userID),
		slog.String("model_name", modelName),
		slog.String("execution_mode", executionMode),
		slog.String("analysis_engine", analysisEngine),
		slog.String("source_type", sourceType),
		slog.Int("image_count", imageCount),
		slog.Bool("has_text_input", hasText),
	)
	apm.SetAttributes(ctx,
		attribute.String("analysis.task_id", taskID),
		attribute.String("analysis.task_type", taskType),
		attribute.String("analysis.user_id", userID),
		attribute.String("analysis.model_name", modelName),
		attribute.String("analysis.execution_mode", executionMode),
		attribute.String("analysis.engine", analysisEngine),
	)
	apm.AddEvent(ctx, "analysis task submitted",
		attribute.String("analysis.task_id", taskID),
		attribute.String("analysis.task_type", taskType),
		attribute.String("analysis.user_id", userID),
		attribute.String("analysis.model_name", modelName),
		attribute.String("analysis.execution_mode", executionMode),
		attribute.String("analysis.engine", analysisEngine),
		attribute.String("analysis.source_type", sourceType),
		attribute.Int("analysis.image_count", imageCount),
		attribute.Bool("analysis.has_text_input", hasText),
	)
}

func (s *TaskService) applyFoodCreditGuard(ctx context.Context, userID, executionMode, recordedOn string, units int, payload map[string]any) (map[string]any, int, error) {
	if s.creditGuard == nil || userID == "" {
		return nil, 0, nil
	}
	creditsInfo, err := s.creditGuard.ValidateFoodAnalysisCredits(ctx, userID, executionMode, recordedOn, units)
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

func ensureCreditGroupID(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	groupID := stringFromAny(payload["credit_group_id"])
	if groupID == "" {
		if usage := mapFromAny(payload["credit_usage"]); len(usage) > 0 {
			groupID = stringFromAny(usage["credit_group_id"])
		}
	}
	if groupID == "" {
		groupID = uuid.New().String()
	}
	payload["credit_group_id"] = groupID
	if usage := mapFromAny(payload["credit_usage"]); len(usage) > 0 {
		usage["credit_group_id"] = groupID
		payload["credit_usage"] = usage
	}
	return groupID
}

func (s *TaskService) consumeTaskCredits(ctx context.Context, userID string, creditsInfo map[string]any, cost int, groupID, taskID, taskType string) error {
	if s.creditGuard == nil || userID == "" || creditsInfo == nil || groupID == "" {
		return nil
	}
	return s.creditGuard.ConsumeEarnedCreditsOnTaskCreated(ctx, userID, creditsInfo, cost, "food_analysis_reward_spend", "food_analysis:"+groupID, map[string]any{
		"credit_group_id": groupID,
		"task_id":         taskID,
		"task_type":       taskType,
	})
}

func (s *TaskService) refundTaskCredits(ctx context.Context, task *domain.AnalysisTask) {
	if s.creditGuard == nil || task == nil || task.UserID == "" {
		return
	}
	usage := mapFromAny(task.Payload["credit_usage"])
	if len(usage) == 0 {
		return
	}
	groupID := creditGroupIDFromTask(task)
	if groupID == "" {
		return
	}
	cost := intFromAny(usage["cost"])
	if cost <= 0 {
		return
	}
	creditsInfo := map[string]any{
		"credit_cost":       cost,
		"credit_spend_plan": usage,
	}
	_ = s.creditGuard.RefundEarnedCreditsAfterTaskFailure(ctx, task.UserID, creditsInfo, cost,
		"food_analysis_reward_spend", "food_analysis:"+groupID,
		"food_analysis_reward_refund", "food_analysis_refund:"+groupID,
		map[string]any{
			"credit_group_id": groupID,
			"task_id":         task.ID,
			"task_type":       task.TaskType,
		},
	)
}

func creditGroupIDFromTask(task *domain.AnalysisTask) string {
	if task == nil {
		return ""
	}
	if usage := mapFromAny(task.Payload["credit_usage"]); len(usage) > 0 {
		if groupID := stringFromAny(usage["credit_group_id"]); groupID != "" {
			return groupID
		}
	}
	return stringFromAny(task.Payload["credit_group_id"])
}

func creditUnitsForInput(input SubmitTaskInput) int {
	return 1
}

func correctionCreditMode(mode string) string {
	if mode == experimentalExecutionMode || mode == validExecutionMode || mode == gemini35GroupedExecutionMode {
		return "strict_correction"
	}
	return "standard_correction"
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
	if strings.TrimSpace(input.CorrectionSourceTaskID) != "" {
		payload["correction_source_task_id"] = strings.TrimSpace(input.CorrectionSourceTaskID)
	}
	if strings.TrimSpace(input.CorrectionRootTaskID) != "" {
		payload["correction_root_task_id"] = strings.TrimSpace(input.CorrectionRootTaskID)
	}
	if len(input.ReferenceObjects) > 0 {
		payload["reference_objects"] = input.ReferenceObjects
	}
	if strings.TrimSpace(input.SourceType) != "" {
		payload["source_type"] = strings.ToLower(strings.TrimSpace(input.SourceType))
	}
}

func (s *TaskService) attachCorrectionChain(ctx context.Context, userID string, input SubmitTaskInput, payload map[string]any) {
	if len(input.CorrectionItems) == 0 && len(input.PreviousResult) == 0 {
		return
	}
	sourceID := strings.TrimSpace(input.CorrectionSourceTaskID)
	rootID := strings.TrimSpace(input.CorrectionRootTaskID)
	if sourceID == "" {
		return
	}
	sourceTask, err := s.tasks.GetTaskByID(ctx, sourceID)
	if err != nil || sourceTask == nil || sourceTask.UserID != userID {
		return
	}
	if rootID == "" {
		rootID = stringFromAny(sourceTask.Payload["correction_root_task_id"])
	}
	if rootID == "" {
		rootID = sourceID
	}
	payload["is_correction"] = true
	payload["correction_source_task_id"] = sourceID
	payload["correction_root_task_id"] = rootID
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

func (s *TaskService) enqueueTask(ctx context.Context, task *domain.AnalysisTask) error {
	if s.taskQueue == nil || task == nil || task.Status != "pending" {
		return nil
	}
	apm.AddEvent(ctx, "analysis task queue publish started",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
	)
	publishCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	err := s.taskQueue.PublishTask(publishCtx, taskqueue.TaskMessage{
		TaskID:   task.ID,
		TaskType: task.TaskType,
	})
	if err == nil {
		logger.WithTrace(ctx).Info("分析任务已入队",
			slog.String("task_id", task.ID),
			slog.String("task_type", task.TaskType),
		)
		apm.AddEvent(ctx, "analysis task queue publish completed",
			attribute.String("analysis.task_id", task.ID),
			attribute.String("analysis.task_type", task.TaskType),
		)
		return nil
	}
	apm.RecordError(ctx, err,
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
	)
	apm.AddEvent(ctx, "analysis task queue publish failed",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
	)
	failCtx, failCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer failCancel()
	_, failErr := s.tasks.FailTask(failCtx, task.ID, "analysis task enqueue failed")
	logger.WithTrace(ctx).Error("分析任务入队失败",
		slog.String("task_id", task.ID),
		slog.String("task_type", task.TaskType),
		logger.Err(err),
		logger.NamedErr("fail_update_error", failErr),
	)
	return fmt.Errorf("enqueue analysis task: %w", err)
}

func (s *TaskService) submitPrecisionTask(ctx context.Context, userID string, input SubmitTaskInput, payload map[string]any, creditsInfo map[string]any, creditCost int, creditGroupID string) (string, error) {
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
			ExecutionMode:    "experimental",
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
	if err := s.consumeTaskCredits(ctx, userID, creditsInfo, creditCost, creditGroupID, task.ID, task.TaskType); err != nil {
		_, _ = s.tasks.FailTask(ctx, task.ID, "credit reservation failed")
		return "", err
	}
	if err := s.enqueueTask(ctx, task); err != nil {
		s.refundTaskCredits(ctx, task)
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
		tasks = collapseAnalyzeHistoryTasks(tasks)
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
	return int64(len(collapseAnalyzeHistoryTasks(filterAnalyzeHistoryTasks(tasks)))), nil
}

func (s *TaskService) CountTasksByStatus(ctx context.Context, userID string) (map[string]any, error) {
	tasks, err := s.tasks.ListTasksByUser(ctx, userID, "", "", 500)
	if err != nil {
		return nil, err
	}
	tasks = collapseAnalyzeHistoryTasks(filterAnalyzeHistoryTasks(tasks))
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
	recentSince := time.Now().Add(-waitingRecordBadgeWindow)
	for _, task := range tasks {
		switch task.Status {
		case "pending", "processing":
			recognizing++
		case "done":
			if _, ok := recordedMap[task.ID]; ok {
				recorded++
			} else if task.CreatedAt != nil && task.CreatedAt.After(recentSince) {
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
	} else if isCreditRefundStatus(task.Status) {
		s.refundTaskCredits(ctx, task)
	}
	return task, nil
}

func isCreditRefundStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "failed", "timed_out", "cancelled":
		return true
	default:
		return false
	}
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
		task.Status = "cancelled"
		s.refundTaskCredits(ctx, task)
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
		return strings.TrimSpace(path)
	}
	return s.storage.ResolveReferenceURL("food-images", path)
}

func (s *TaskService) normalizeSubmitImages(input *SubmitTaskInput) {
	if input == nil {
		return
	}
	originalHasImageURLs := len(input.ImageURLs) > 0
	resolvedPrimary := s.resolveFoodImageURL(input.ImageURL)
	resolvedURLs := input.ImageURLs
	if s.storage != nil {
		resolvedURLs = s.storage.ResolveReferenceURLs("food-images", input.ImageURLs)
	}
	normalized := make([]string, 0, len(resolvedURLs)+1)
	seen := make(map[string]struct{}, len(resolvedURLs)+1)
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, ok := seen[value]; ok {
			return
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	add(resolvedPrimary)
	for _, value := range resolvedURLs {
		if s.storage == nil {
			value = s.resolveFoodImageURL(value)
		}
		add(value)
	}
	if len(normalized) == 0 {
		input.ImageURL = ""
		input.ImageURLs = nil
		return
	}
	input.ImageURL = normalized[0]
	if originalHasImageURLs || len(normalized) > 1 {
		input.ImageURLs = normalized
	} else {
		input.ImageURLs = nil
	}
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

func collapseAnalyzeHistoryTasks(tasks []domain.AnalysisTask) []domain.AnalysisTask {
	seen := make(map[string]bool, len(tasks))
	out := make([]domain.AnalysisTask, 0, len(tasks))
	for _, task := range tasks {
		key := analyzeHistoryGroupKey(task)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, task)
	}
	return out
}

func analyzeHistoryGroupKey(task domain.AnalysisTask) string {
	if rootID := stringFromAny(task.Payload["correction_root_task_id"]); rootID != "" {
		return "root:" + rootID
	}
	if sourceID := stringFromAny(task.Payload["correction_source_task_id"]); sourceID != "" {
		return "root:" + sourceID
	}
	if fingerprint := analyzeHistoryInputFingerprint(task); fingerprint != "" {
		return "input:" + analyzeHistoryCreatedDate(task) + ":" + fingerprint
	}
	return "task:" + task.ID
}

func analyzeHistoryInputFingerprint(task domain.AnalysisTask) string {
	parts := make([]string, 0)
	if len(task.ImagePaths) > 0 {
		parts = append(parts, task.ImagePaths...)
	} else if task.ImageURL != nil && strings.TrimSpace(*task.ImageURL) != "" {
		parts = append(parts, strings.TrimSpace(*task.ImageURL))
	} else if values := stringSliceFromAny(task.Payload["image_urls"]); len(values) > 0 {
		parts = append(parts, values...)
	} else if imageURL := stringFromAny(task.Payload["image_url"]); imageURL != "" {
		parts = append(parts, imageURL)
	}
	if len(parts) > 0 {
		return "image:" + strings.Join(parts, "|")
	}
	if task.TextInput != nil && strings.TrimSpace(*task.TextInput) != "" {
		return "text:" + strings.Join(strings.Fields(*task.TextInput), " ")
	}
	if text := stringFromAny(task.Payload["text"]); text != "" {
		return "text:" + strings.Join(strings.Fields(text), " ")
	}
	return ""
}

func analyzeHistoryCreatedDate(task domain.AnalysisTask) string {
	if task.CreatedAt == nil {
		return "unknown"
	}
	return task.CreatedAt.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
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

func stringSliceFromAny(value any) []string {
	switch v := value.(type) {
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if text := strings.TrimSpace(item); text != "" {
				out = append(out, text)
			}
		}
		return out
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if text := stringFromAny(item); text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return nil
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

func mapFromAny(value any) map[string]any {
	if value == nil {
		return nil
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return nil
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
