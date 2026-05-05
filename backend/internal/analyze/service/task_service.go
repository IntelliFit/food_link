package service

import (
	"context"
	"time"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/repo"
	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/common/errors"
)

type TaskService struct {
	tasks     *repo.TaskRepo
	precision *repo.PrecisionRepo
	users     *authrepo.UserRepo
}

func NewTaskService(tasks *repo.TaskRepo, precision *repo.PrecisionRepo, users *authrepo.UserRepo) *TaskService {
	return &TaskService{tasks: tasks, precision: precision, users: users}
}

type SubmitTaskInput struct {
	ImageURL          string   `json:"image_url"`
	ImageURLs         []string `json:"image_urls"`
	TextInput         string   `json:"text_input"`
	MealType          string   `json:"meal_type"`
	Province          string   `json:"province"`
	City              string   `json:"city"`
	District          string   `json:"district"`
	DietGoal          string   `json:"diet_goal"`
	ActivityTiming    string   `json:"activity_timing"`
	UserGoal          string   `json:"user_goal"`
	RemainingCalories *float64 `json:"remaining_calories"`
	AdditionalContext string   `json:"additionalContext"`
	ModelName         string   `json:"modelName"`
	ExecutionMode     *string  `json:"execution_mode"`
	PrecisionSessionID *string `json:"precision_session_id"`
	AnalysisEngine    string   `json:"analysis_engine"`
}

func (s *TaskService) SubmitAnalyzeTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		return "", &errors.AppError{Code: 10002, Message: "image_url 或 image_urls 不能为空", HTTPStatus: 400}
	}

	mode := normalizeExecutionMode(input.ExecutionMode)
	if userID != "" {
		user, err := s.users.FindByID(ctx, userID)
		if err == nil && user != nil && input.ExecutionMode == nil {
			mode = normalizeExecutionMode(user.ExecutionMode)
		}
	}

	payload := map[string]any{
		"meal_type":       input.MealType,
		"province":        input.Province,
		"city":            input.City,
		"district":        input.District,
		"diet_goal":       input.DietGoal,
		"activity_timing": input.ActivityTiming,
		"user_goal":       input.UserGoal,
		"remaining_calories": input.RemainingCalories,
		"additionalContext":  input.AdditionalContext,
		"modelName":          input.ModelName,
		"execution_mode":     mode,
		"analysis_engine":    input.AnalysisEngine,
	}

	if mode == validExecutionMode || input.PrecisionSessionID != nil {
		return s.submitPrecisionTask(ctx, userID, input, payload)
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
	return task.ID, nil
}

func (s *TaskService) SubmitTextTask(ctx context.Context, userID string, input SubmitTaskInput) (string, error) {
	if input.TextInput == "" {
		return "", &errors.AppError{Code: 10002, Message: "text 不能为空", HTTPStatus: 400}
	}

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
	}

	if mode == validExecutionMode || input.PrecisionSessionID != nil {
		return s.submitPrecisionTask(ctx, userID, input, payload)
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
	return task.ID, nil
}

func (s *TaskService) submitPrecisionTask(ctx context.Context, userID string, input SubmitTaskInput, payload map[string]any) (string, error) {
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
		if existing.Status != "collecting" && existing.Status != "active" {
			return "", &errors.AppError{Code: 10002, Message: "该精准模式会话已结束，无法继续", HTTPStatus: 400}
		}
		nextRound := existing.RoundIndex + 1
		if err := s.precision.UpdateSession(ctx, existing.ID, map[string]any{
			"status":      "collecting",
			"round_index": nextRound,
			"updated_at":  time.Now(),
		}); err != nil {
			return "", err
		}
		if err := s.precision.CreateRound(ctx, &domain.PrecisionSessionRound{
			SessionID:  existing.ID,
			RoundIndex: nextRound,
		}); err != nil {
			return "", err
		}
		session = existing
		session.RoundIndex = nextRound
	} else {
		newSession := &domain.PrecisionSession{
			UserID:     userID,
			Status:     "collecting",
			RoundIndex: 1,
		}
		if err := s.precision.CreateSession(ctx, newSession); err != nil {
			return "", err
		}
		if err := s.precision.CreateRound(ctx, &domain.PrecisionSessionRound{
			SessionID:  newSession.ID,
			RoundIndex: 1,
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

func (s *TaskService) ListTasks(ctx context.Context, userID, taskType, status string, limit int) ([]domain.AnalysisTask, error) {
	return s.tasks.ListTasksByUser(ctx, userID, taskType, status, limit)
}

func (s *TaskService) CountTasks(ctx context.Context, userID string) (int64, error) {
	return s.tasks.CountTasksByUser(ctx, userID)
}

func (s *TaskService) CountTasksByStatus(ctx context.Context, userID string) (map[string]int64, error) {
	return s.tasks.CountTasksByStatus(ctx, userID)
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

// ValidateQuota is a stub for membership/quota validation.
func (s *TaskService) ValidateQuota(ctx context.Context, userID string) error {
	// TODO: integrate with membership service when available
	_ = ctx
	_ = userID
	return nil
}
