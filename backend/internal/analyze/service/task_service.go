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
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"
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
	recordRepo  *foodrecordrepo.FoodRecordRepo
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

func (s *TaskService) ConfigureRecordRepo(repo *foodrecordrepo.FoodRecordRepo) {
	s.recordRepo = repo
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
	ExtraPayload           map[string]any   `json:"-"`
	RetrySourceTaskID      string           `json:"-"`
}

type RetryTaskResult struct {
	TaskID       string `json:"task_id"`
	Message      string `json:"message"`
	SourceTaskID string `json:"source_task_id"`
}

type TaskListPage struct {
	Tasks      []domain.AnalysisTask `json:"tasks"`
	HasMore    bool                  `json:"has_more"`
	NextOffset int                   `json:"next_offset"`
}

// SubmitAnalyzeTask 是面向用户 API 的入口，必须走积分检查。
func (s *TaskService) SubmitAnalyzeTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	s.normalizeSubmitImages(&input)
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		return "", &errors.AppError{Code: 10002, Message: "image_url 或 image_urls 不能为空", HTTPStatus: 400}
	}
	if imageCountForLog(input.ImageURL, input.ImageURLs) > maxFoodAnalyzeImages {
		return "", &errors.AppError{Code: 10002, Message: "最多支持 3 张图片", HTTPStatus: 400}
	}

	recordedOn, mode, err := s.resolveSubmitContext(ctx, userID, input)
	if err != nil {
		return "", err
	}
	payload := buildSubmitTaskPayload(input, recordedOn, mode)
	s.attachCorrectionChain(ctx, userID, input, payload)

	creditMode := s.resolveCreditMode(mode, input, payload)
	creditsInfo, creditCost, err := s.applyFoodCreditGuard(ctx, userID, creditMode, input.Date, creditUnitsForInput(input), payload)
	if err != nil {
		return "", err
	}
	creditGroupID := ensureCreditGroupID(payload)

	return s.createAndEnqueueAnalyzeTask(ctx, userID, input, payload, mode, creditsInfo, creditCost, creditGroupID)
}

// SubmitInternalAnalyzeTask 仅用于内部系统（如 Admin Benchmark），不参与积分系统。
// 调用方必须是可信内部服务；payload 会标记 internal_benchmark 以便追踪。
func (s *TaskService) SubmitInternalAnalyzeTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	s.normalizeSubmitImages(&input)
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		return "", &errors.AppError{Code: 10002, Message: "image_url 或 image_urls 不能为空", HTTPStatus: 400}
	}
	if imageCountForLog(input.ImageURL, input.ImageURLs) > maxFoodAnalyzeImages {
		return "", &errors.AppError{Code: 10002, Message: "最多支持 3 张图片", HTTPStatus: 400}
	}

	recordedOn, mode, err := s.resolveSubmitContext(ctx, userID, input)
	if err != nil {
		return "", err
	}
	payload := buildSubmitTaskPayload(input, recordedOn, mode)
	s.attachCorrectionChain(ctx, userID, input, payload)
	payload["internal_benchmark"] = true

	logger.Info(ctx, "内部基准评测分析任务提交",
		slog.String("user_id", userID),
		slog.String("execution_mode", mode),
		slog.String("source", "benchmark"),
	)

	return s.createAndEnqueueAnalyzeTask(ctx, userID, input, payload, mode, nil, 0, "")
}

// SubmitTextTask 是面向用户 API 的入口，必须走积分检查。
func (s *TaskService) SubmitTextTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	if input.TextInput == "" {
		input.TextInput = input.Text
	}
	s.normalizeSubmitImages(&input)
	if input.TextInput == "" && !hasPrecisionSupplement(input) {
		return "", &errors.AppError{Code: 10002, Message: "text 不能为空", HTTPStatus: 400}
	}

	recordedOn, mode, err := s.resolveSubmitContext(ctx, userID, input)
	if err != nil {
		return "", err
	}
	payload := buildSubmitTaskPayload(input, recordedOn, mode)
	s.attachCorrectionChain(ctx, userID, input, payload)

	creditMode := s.resolveCreditMode(mode, input, payload)
	creditsInfo, creditCost, err := s.applyFoodCreditGuard(ctx, userID, creditMode, input.Date, creditUnitsForInput(input), payload)
	if err != nil {
		return "", err
	}
	creditGroupID := ensureCreditGroupID(payload)

	return s.createAndEnqueueTextTask(ctx, userID, input, payload, mode, creditsInfo, creditCost, creditGroupID)
}

// SubmitInternalTextTask 仅用于内部系统（如 Admin Benchmark），不参与积分系统。
func (s *TaskService) SubmitInternalTextTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	if input.TextInput == "" {
		input.TextInput = input.Text
	}
	s.normalizeSubmitImages(&input)
	if input.TextInput == "" && !hasPrecisionSupplement(input) {
		return "", &errors.AppError{Code: 10002, Message: "text 不能为空", HTTPStatus: 400}
	}

	recordedOn, mode, err := s.resolveSubmitContext(ctx, userID, input)
	if err != nil {
		return "", err
	}
	payload := buildSubmitTaskPayload(input, recordedOn, mode)
	s.attachCorrectionChain(ctx, userID, input, payload)
	payload["internal_benchmark"] = true

	logger.Info(ctx, "内部基准评测文本任务提交",
		slog.String("user_id", userID),
		slog.String("execution_mode", mode),
		slog.String("source", "benchmark"),
	)

	return s.createAndEnqueueTextTask(ctx, userID, input, payload, mode, nil, 0, "")
}

func (s *TaskService) resolveSubmitContext(ctx context.Context, userID string, input SubmitTaskInput) (recordedOn, mode string, err error) {
	recordedOn, err = dateutil.ResolveRecordedOnDate(input.Date, "date")
	if err != nil {
		return "", "", err
	}
	input.Date = recordedOn

	mode = normalizeExecutionMode(input.ExecutionMode)
	if userID != "" {
		user, err := s.users.FindByID(ctx, userID)
		if err == nil && user != nil && input.ExecutionMode == nil {
			mode = normalizeExecutionMode(user.ExecutionMode)
		}
	}
	return recordedOn, mode, nil
}

func (s *TaskService) resolveCreditMode(mode string, input SubmitTaskInput, payload map[string]any) string {
	creditMode := mode
	if mode == experimentalExecutionMode || mode == precisionSeparateExecutionMode || input.PrecisionSessionID != nil {
		creditMode = validExecutionMode
	}
	if mode == precisionSeparateExecutionMode {
		creditMode = precisionSeparateExecutionMode
	}
	if boolFromAny(payload["is_correction"]) {
		creditMode = correctionCreditMode(creditMode)
	}
	return creditMode
}

func (s *TaskService) createAndEnqueueAnalyzeTask(ctx context.Context, userID string, input SubmitTaskInput, payload map[string]any, mode string, creditsInfo map[string]any, creditCost int, creditGroupID string) (string, error) {
	if mode == experimentalExecutionMode || mode == precisionSeparateExecutionMode || input.PrecisionSessionID != nil {
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

func (s *TaskService) createAndEnqueueTextTask(ctx context.Context, userID string, input SubmitTaskInput, payload map[string]any, mode string, creditsInfo map[string]any, creditCost int, creditGroupID string) (string, error) {
	if mode == experimentalExecutionMode || mode == precisionSeparateExecutionMode || input.PrecisionSessionID != nil {
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
	logger.Info(ctx, "分析任务已提交",
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
	apm.AddEvent(ctx, "分析任务已提交",
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
	if mode == experimentalExecutionMode || mode == validExecutionMode || mode == precisionSeparateExecutionMode || mode == gemini35GroupedExecutionMode {
		return "strict_correction"
	}
	return "standard_correction"
}

func buildSubmitTaskPayload(input SubmitTaskInput, recordedOn, mode string) map[string]any {
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
	return payload
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
	for key, value := range input.ExtraPayload {
		if strings.TrimSpace(key) == "" {
			continue
		}
		payload[key] = value
	}
	if strings.TrimSpace(input.RetrySourceTaskID) != "" {
		payload["retry_source_task_id"] = strings.TrimSpace(input.RetrySourceTaskID)
		payload["is_retry"] = true
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
	apm.AddEvent(ctx, "分析任务入队开始",
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
		logger.Info(ctx, "分析任务已入队",
			slog.String("task_id", task.ID),
			slog.String("task_type", task.TaskType),
		)
		apm.AddEvent(ctx, "分析任务入队完成",
			attribute.String("analysis.task_id", task.ID),
			attribute.String("analysis.task_type", task.TaskType),
		)
		return nil
	}
	apm.RecordError(ctx, err,
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
	)
	apm.AddEvent(ctx, "分析任务入队失败",
		attribute.String("analysis.task_id", task.ID),
		attribute.String("analysis.task_type", task.TaskType),
	)
	failCtx, failCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer failCancel()
	_, failErr := s.tasks.FailTask(failCtx, task.ID, "analysis task enqueue failed")
	logger.Error(ctx, "分析任务入队失败", err,
		slog.String("task_id", task.ID),
		slog.String("task_type", task.TaskType),
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

func (s *TaskService) ListTasks(ctx context.Context, userID, taskType, status, search string, limit int) ([]domain.AnalysisTask, error) {
	page, err := s.ListTasksPage(ctx, userID, taskType, status, search, limit, 0)
	if err != nil {
		return nil, err
	}
	return page.Tasks, nil
}

func (s *TaskService) ListTasksPage(ctx context.Context, userID, taskType, status, search string, limit, offset int) (TaskListPage, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}

	var (
		tasks      []domain.AnalysisTask
		hasMore    bool
		nextOffset int
		err        error
	)
	if strings.TrimSpace(taskType) == "" {
		tasks, hasMore, nextOffset, err = collectAnalyzeHistoryPage(offset, limit, func(rawOffset, rawLimit int) ([]domain.AnalysisTask, error) {
			return s.tasks.ListTasksByUserPage(ctx, userID, taskType, status, search, rawLimit, rawOffset)
		})
	} else {
		tasks, err = s.tasks.ListTasksByUserPage(ctx, userID, taskType, status, search, limit+1, offset)
		if err == nil {
			hasMore = len(tasks) > limit
			if hasMore {
				tasks = tasks[:limit]
			}
			nextOffset = offset + len(tasks)
		}
	}
	if err != nil {
		return TaskListPage{}, err
	}
	doneTaskIDs := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.Status == "done" {
			doneTaskIDs = append(doneTaskIDs, task.ID)
		}
	}
	recordedMap, err := s.tasks.RecordedTaskMap(ctx, userID, doneTaskIDs)
	if err != nil {
		return TaskListPage{}, err
	}
	for i := range tasks {
		s.normalizeTaskImages(&tasks[i])
		normalizeIngredientLabelEnergyInResult(tasks[i].Result)
		if tasks[i].Status == "done" {
			if recordID, ok := recordedMap[tasks[i].ID]; ok {
				tasks[i].IsRecorded = true
				tasks[i].RecordID = recordID
			}
		}
	}
	return TaskListPage{
		Tasks:      tasks,
		HasMore:    hasMore,
		NextOffset: nextOffset,
	}, nil
}

func (s *TaskService) CountTasks(ctx context.Context, userID string) (int64, error) {
	tasks, err := s.tasks.ListTasksByUser(ctx, userID, "", "", "", 10000)
	if err != nil {
		return 0, err
	}
	return int64(len(collapseAnalyzeHistoryTasks(filterAnalyzeHistoryTasks(tasks)))), nil
}

func (s *TaskService) CountTasksByStatus(ctx context.Context, userID string) (map[string]any, error) {
	tasks, err := s.tasks.ListTasksByUser(ctx, userID, "", "", "", 500)
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
	if task.ErrorMessage != nil {
		safeMessage := SanitizeAIUpstreamErrorMessage(*task.ErrorMessage)
		task.ErrorMessage = &safeMessage
	}
	s.normalizeTaskImages(task)
	normalizeIngredientLabelEnergyInResult(task.Result)
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
		logger.Warn(ctx, "查询到终态分析任务",
			logger.AnalysisTaskID(task.ID),
			logger.TaskType(task.TaskType),
			logger.UserID(userID),
			slog.String("status", task.Status),
			logger.Truncated("error_message", stringFromTaskError(task), 300),
		)
	}
	return task, nil
}

func stringFromTaskError(task *domain.AnalysisTask) string {
	if task == nil || task.ErrorMessage == nil {
		return ""
	}
	return strings.TrimSpace(*task.ErrorMessage)
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

func (s *TaskService) RetryTask(ctx context.Context, taskID, userID string) (*RetryTaskResult, error) {
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
	if !isRetryableTaskStatus(task.Status) {
		return nil, &errors.AppError{Code: 10002, Message: "只有识别失败或超时的任务可以重新识别", HTTPStatus: 400}
	}
	input, err := s.retryInputFromTask(task)
	if err != nil {
		return nil, err
	}
	s.refundTaskCredits(ctx, task)
	var newTaskID string
	if retrySourceType(task) == "food_text" {
		newTaskID, err = s.SubmitTextTask(ctx, userID, input)
	} else {
		newTaskID, err = s.SubmitAnalyzeTask(ctx, userID, input)
	}
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "分析任务重新识别已提交",
		slog.String("user_id", userID),
		slog.String("source_task_id", task.ID),
		slog.String("new_task_id", newTaskID),
		slog.String("task_type", task.TaskType),
	)
	return &RetryTaskResult{
		TaskID:       newTaskID,
		Message:      "已重新提交识别任务",
		SourceTaskID: task.ID,
	}, nil
}

func isRetryableTaskStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "failed", "timed_out":
		return true
	default:
		return false
	}
}

func retrySourceType(task *domain.AnalysisTask) string {
	if task == nil {
		return ""
	}
	taskType := strings.TrimSpace(task.TaskType)
	if taskType == "food_text" || strings.HasPrefix(taskType, "food_text") {
		return "food_text"
	}
	return "food"
}

func (s *TaskService) retryInputFromTask(task *domain.AnalysisTask) (SubmitTaskInput, error) {
	if task == nil {
		return SubmitTaskInput{}, errors.ErrNotFound
	}
	payload := copyMap(task.Payload)
	removeRetryIncompatiblePayload(payload)
	input := SubmitTaskInput{
		ImageURL:               firstImageURL(task),
		ImageURLs:              task.ImagePaths,
		TextInput:              stringFromPtr(task.TextInput),
		Text:                   stringFromPtr(task.TextInput),
		Date:                   stringFromAny(firstPayloadValue(payload, "date", "recorded_on", "recordedOn")),
		MealType:               stringFromAny(firstPayloadValue(payload, "meal_type", "mealType")),
		Province:               stringFromAny(payload["province"]),
		City:                   stringFromAny(payload["city"]),
		District:               stringFromAny(payload["district"]),
		DietGoal:               stringFromAny(payload["diet_goal"]),
		ActivityTiming:         stringFromAny(payload["activity_timing"]),
		UserGoal:               stringFromAny(payload["user_goal"]),
		SuggestRatioEnabled:    boolFromAny(payload["suggest_ratio_enabled"]),
		AdditionalContext:      stringFromAny(payload["additionalContext"]),
		ModelName:              stringFromAny(payload["modelName"]),
		AnalysisEngine:         stringFromAny(payload["analysis_engine"]),
		IsMultiView:            boolFromAny(payload["is_multi_view"]),
		PreviousResult:         mapFromAny(payload["previousResult"]),
		CorrectionItems:        mapSliceFromAny(payload["correctionItems"]),
		CorrectionSourceTaskID: stringFromAny(payload["correction_source_task_id"]),
		CorrectionRootTaskID:   stringFromAny(payload["correction_root_task_id"]),
		ReferenceObjects:       mapSliceFromAny(payload["reference_objects"]),
		SourceType:             stringFromAny(payload["source_type"]),
		RetrySourceTaskID:      task.ID,
	}
	if input.Date == "" && task.CreatedAt != nil {
		input.Date = task.CreatedAt.In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format("2006-01-02")
	}
	if v, ok := float64PtrFromAny(payload["remaining_calories"]); ok {
		input.RemainingCalories = v
	}
	if v, ok := intPtrFromAny(payload["timezone_offset_minutes"]); ok {
		input.TimezoneOffsetMinutes = v
	}
	if mode := stringFromAny(payload["execution_mode"]); mode != "" {
		input.ExecutionMode = &mode
	}
	if sessionID := stringFromAny(payload["precision_session_id"]); sessionID != "" {
		input.PrecisionSessionID = &sessionID
	}
	if retrySourceType(task) == "food_text" {
		if strings.TrimSpace(input.TextInput) == "" {
			return SubmitTaskInput{}, &errors.AppError{Code: 10002, Message: "原任务缺少文字内容，无法重新识别", HTTPStatus: 400}
		}
		return input, nil
	}
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		return SubmitTaskInput{}, &errors.AppError{Code: 10002, Message: "原任务缺少图片，无法重新识别", HTTPStatus: 400}
	}
	return input, nil
}

func removeRetryIncompatiblePayload(payload map[string]any) {
	if payload == nil {
		return
	}
	delete(payload, "credit_usage")
	delete(payload, "credit_group_id")
	delete(payload, "retry_source_task_id")
	delete(payload, "is_retry")
}

func firstImageURL(task *domain.AnalysisTask) string {
	if task == nil {
		return ""
	}
	if len(task.ImagePaths) > 0 {
		return strings.TrimSpace(task.ImagePaths[0])
	}
	if task.ImageURL != nil {
		return strings.TrimSpace(*task.ImageURL)
	}
	return ""
}

func stringFromPtr(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func firstPayloadValue(payload map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := payload[key]; ok && stringFromAny(value) != "" {
			return value
		}
	}
	return nil
}

func float64PtrFromAny(value any) (*float64, bool) {
	switch v := value.(type) {
	case float64:
		return &v, true
	case float32:
		out := float64(v)
		return &out, true
	case int:
		out := float64(v)
		return &out, true
	case int64:
		out := float64(v)
		return &out, true
	case json.Number:
		out, err := v.Float64()
		return &out, err == nil
	default:
		return nil, false
	}
}

func intPtrFromAny(value any) (*int, bool) {
	switch v := value.(type) {
	case int:
		return &v, true
	case int64:
		out := int(v)
		return &out, true
	case float64:
		out := int(v)
		return &out, true
	case json.Number:
		i, err := v.Int64()
		out := int(i)
		return &out, err == nil
	default:
		return nil, false
	}
}

func mapSliceFromAny(value any) []map[string]any {
	switch v := value.(type) {
	case []map[string]any:
		return v
	case []any:
		out := make([]map[string]any, 0, len(v))
		for _, item := range v {
			if m := mapFromAny(item); len(m) > 0 {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
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

	// Delete associated food record if exists
	if s.recordRepo != nil {
		if record, err := s.recordRepo.GetByUserSourceTaskID(ctx, userID, taskID); err == nil && record != nil {
			_ = s.recordRepo.Delete(ctx, userID, record.ID)
		}
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

type analyzeHistoryPageFetcher func(offset, limit int) ([]domain.AnalysisTask, error)

// collectAnalyzeHistoryPage paginates the visible history rather than the raw
// analysis_tasks rows. History-only tasks and duplicate correction/input groups
// must not consume a visible page slot, otherwise clients can receive a short or
// empty page while older records still exist.
func collectAnalyzeHistoryPage(offset, limit int, fetch analyzeHistoryPageFetcher) ([]domain.AnalysisTask, bool, int, error) {
	cursor := offset
	seen := make(map[string]bool, limit)
	tasks := make([]domain.AnalysisTask, 0, limit)

	for {
		// Only ask for the visible rows still needed plus one look-ahead row.
		// If exclusions or duplicate groups consume that batch, the next loop
		// continues from the raw cursor without repeatedly over-reading a full page.
		batchSize := limit - len(tasks) + 1
		batch, err := fetch(cursor, batchSize)
		if err != nil {
			return nil, false, offset, err
		}
		if len(batch) == 0 {
			return tasks, false, cursor, nil
		}

		for index, task := range batch {
			if isTaskExcludedFromAnalyzeHistory(task) {
				continue
			}
			groupKey := analyzeHistoryGroupKey(task)
			if seen[groupKey] {
				continue
			}
			if len(tasks) == limit {
				// Do not consume the look-ahead task. The next page starts from
				// this raw row so no visible history item is skipped.
				return tasks, true, cursor + index, nil
			}
			seen[groupKey] = true
			task.HistoryGroupKey = groupKey
			tasks = append(tasks, task)
		}

		cursor += len(batch)
		if len(batch) < batchSize {
			return tasks, false, cursor, nil
		}
	}
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

// SubmitFeedbackInput 是用户主动埋点反馈的入参。
type SubmitFeedbackInput struct {
	FeedbackType        string           `json:"feedback_type"`
	ResolutionState     string           `json:"resolution_state"`
	SourceTaskID        string           `json:"source_task_id"`
	SourceRecordID      string           `json:"source_record_id"`
	BeforeResult        map[string]any   `json:"before_result"`
	AfterResult         map[string]any   `json:"after_result"`
	UserCorrectionItems []map[string]any `json:"user_correction_items"`
	PayloadSnapshot     map[string]any   `json:"payload_snapshot"`
	ModelName           string           `json:"model_name"`
	AnalysisEngine      string           `json:"analysis_engine"`
}

// SubmitFeedback 是写入 analysis_feedback_samples 的唯一入口。
// 旧的 correction/failed 仍由 worker 自动采集，其余前端埋点均通过此处写入。
func (s *TaskService) SubmitFeedback(ctx context.Context, userID string, input SubmitFeedbackInput) error {
	feedbackType := strings.TrimSpace(input.FeedbackType)
	if !domain.IsValidFeedbackType(feedbackType) {
		return &errors.AppError{Code: 10001, Message: "feedback_type 不合法", HTTPStatus: 400}
	}
	resolutionState := strings.TrimSpace(input.ResolutionState)
	if resolutionState == "" {
		resolutionState = domain.ResolutionStateStillDistrust
	}
	if !domain.IsValidResolutionState(resolutionState) {
		return &errors.AppError{Code: 10001, Message: "resolution_state 不合法", HTTPStatus: 400}
	}
	sourceTaskID := strings.TrimSpace(input.SourceTaskID)
	sourceRecordID := strings.TrimSpace(input.SourceRecordID)
	if sourceTaskID == "" && sourceRecordID == "" {
		return &errors.AppError{Code: 10001, Message: "source_task_id 与 source_record_id 不能同时为空", HTTPStatus: 400}
	}

	sample := &domain.AnalysisFeedbackSample{
		UserID:              userID,
		FeedbackType:        feedbackType,
		ResolutionState:     resolutionState,
		SourceTaskID:        emptyToNil(sourceTaskID),
		SourceRecordID:      emptyToNil(sourceRecordID),
		BeforeResult:        input.BeforeResult,
		UserCorrectionItems: input.UserCorrectionItems,
		AfterResult:         input.AfterResult,
		PayloadSnapshot:     input.PayloadSnapshot,
		ModelName:           emptyToNil(input.ModelName),
		AnalysisEngine:      emptyToNil(input.AnalysisEngine),
	}

	// 如果前端没传 model_name / analysis_engine / task_type，尝试从关联任务补齐。
	if sourceTaskID != "" {
		task, err := s.tasks.GetTaskByID(ctx, sourceTaskID)
		if err != nil {
			logger.Error(ctx, "查询反馈关联任务失败", err,
				slog.String("user_id", userID),
				slog.String("source_task_id", sourceTaskID),
			)
		}
		if task != nil {
			sample.TaskType = task.TaskType
			if sample.ModelName == nil && task.Payload != nil {
				if m := stringFromAny(task.Payload["modelName"]); m != "" {
					sample.ModelName = &m
				}
			}
			if sample.AnalysisEngine == nil && task.Payload != nil {
				if e := stringFromAny(task.Payload["analysis_engine"]); e != "" {
					sample.AnalysisEngine = &e
				}
			}
		}
	}
	if sample.TaskType == "" {
		sample.TaskType = "food"
	}

	return s.tasks.UpsertFeedbackSample(ctx, sample)
}

func emptyToNil(s string) *string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return &s
}
