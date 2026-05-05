package handler

import (
	"context"
	"net/http"
	"strconv"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/service"

	"github.com/gin-gonic/gin"
)

type AnalyzeService interface {
	Analyze(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
	AnalyzeText(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
	AnalyzeCompare(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
	AnalyzeCompareEngines(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
	AnalyzeBatch(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
}

type TaskService interface {
	SubmitAnalyzeTask(ctx context.Context, userID string, input service.SubmitTaskInput) (string, error)
	SubmitTextTask(ctx context.Context, userID string, input service.SubmitTaskInput) (string, error)
	CreateBatchTask(ctx context.Context, userID string, imageURLs []string, payload map[string]any, result map[string]any) (string, error)
	ListTasks(ctx context.Context, userID, taskType, status string, limit int) ([]domain.AnalysisTask, error)
	CountTasks(ctx context.Context, userID string) (int64, error)
	CountTasksByStatus(ctx context.Context, userID string) (map[string]int64, error)
	GetTask(ctx context.Context, taskID, userID string) (*domain.AnalysisTask, error)
	UpdateTaskResult(ctx context.Context, taskID, userID string, result map[string]any) error
	DeleteTask(ctx context.Context, taskID, userID string) (map[string]any, error)
	CleanupTimeoutTasks(ctx context.Context, timeoutMinutes int, adminKey, expectedAdminKey string) (int64, error)
}

type AnalyzeHandler struct {
	analyzeSvc AnalyzeService
	taskSvc    TaskService
	adminKey   string
}

func NewAnalyzeHandler(analyzeSvc AnalyzeService, taskSvc TaskService, adminKey string) *AnalyzeHandler {
	return &AnalyzeHandler{
		analyzeSvc: analyzeSvc,
		taskSvc:    taskSvc,
		adminKey:   adminKey,
	}
}

func (h *AnalyzeHandler) bindAnalyzeInput(c *gin.Context) (service.AnalyzeInput, error) {
	var input service.AnalyzeInput
	if err := c.ShouldBindJSON(&input); err != nil {
		return input, err
	}
	return input, nil
}

func (h *AnalyzeHandler) bindSubmitInput(c *gin.Context) (service.SubmitTaskInput, error) {
	var input service.SubmitTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		return input, err
	}
	return input, nil
}

// POST /api/analyze (jwt_optional)
func (h *AnalyzeHandler) Analyze(c *gin.Context) {
	input, err := h.bindAnalyzeInput(c)
	if err != nil {
		response.Error(c, err)
		return
	}
	if input.Base64Image == "" && input.ImageURL == "" && len(input.ImageURLs) == 0 {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.analyzeSvc.Analyze(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/analyze-text (jwt_optional)
func (h *AnalyzeHandler) AnalyzeText(c *gin.Context) {
	input, err := h.bindAnalyzeInput(c)
	if err != nil {
		response.Error(c, err)
		return
	}
	if input.Text == "" {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.analyzeSvc.AnalyzeText(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/analyze-compare (jwt_optional)
func (h *AnalyzeHandler) AnalyzeCompare(c *gin.Context) {
	input, err := h.bindAnalyzeInput(c)
	if err != nil {
		response.Error(c, err)
		return
	}
	if input.Base64Image == "" && input.ImageURL == "" && len(input.ImageURLs) == 0 {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.analyzeSvc.AnalyzeCompare(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/analyze-compare-engines (jwt_optional)
func (h *AnalyzeHandler) AnalyzeCompareEngines(c *gin.Context) {
	input, err := h.bindAnalyzeInput(c)
	if err != nil {
		response.Error(c, err)
		return
	}
	if input.Base64Image == "" && input.ImageURL == "" && len(input.ImageURLs) == 0 {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.analyzeSvc.AnalyzeCompareEngines(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/analyze/batch (jwt_required)
func (h *AnalyzeHandler) AnalyzeBatch(c *gin.Context) {
	input, err := h.bindAnalyzeInput(c)
	if err != nil {
		response.Error(c, err)
		return
	}
	if len(input.ImageURLs) == 0 && input.ImageURL == "" {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	if input.ImageURL != "" && len(input.ImageURLs) == 0 {
		input.ImageURLs = []string{input.ImageURL}
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.analyzeSvc.AnalyzeBatch(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}

	payload := map[string]any{
		"meal_type":          input.MealType,
		"diet_goal":          input.DietGoal,
		"activity_timing":    input.ActivityTiming,
		"user_goal":          input.UserGoal,
		"remaining_calories": input.RemainingCalories,
		"additionalContext":  input.AdditionalContext,
		"modelName":          input.ModelName,
		"execution_mode":     input.ExecutionMode,
		"batch_image_count":  len(input.ImageURLs),
	}

	taskID, err := h.taskSvc.CreateBatchTask(c.Request.Context(), userID, input.ImageURLs, payload, result)
	if err != nil {
		response.Error(c, err)
		return
	}

	response.Success(c, map[string]any{
		"task_id":     taskID,
		"image_count": len(input.ImageURLs),
		"result":      result,
	})
}

// POST /api/analyze/submit (jwt_required)
func (h *AnalyzeHandler) SubmitAnalyzeTask(c *gin.Context) {
	input, err := h.bindSubmitInput(c)
	if err != nil {
		response.Error(c, err)
		return
	}
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	taskID, err := h.taskSvc.SubmitAnalyzeTask(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]string{
		"task_id": taskID,
		"message": "任务已提交，可在任务列表中查看进度",
	})
}

// POST /api/analyze-text/submit (jwt_required)
func (h *AnalyzeHandler) SubmitTextTask(c *gin.Context) {
	input, err := h.bindSubmitInput(c)
	if err != nil {
		response.Error(c, err)
		return
	}
	if input.TextInput == "" {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	taskID, err := h.taskSvc.SubmitTextTask(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]string{
		"task_id": taskID,
		"message": "任务已提交，可在任务列表中查看进度",
	})
}

// GET /api/analyze/tasks (jwt_required)
func (h *AnalyzeHandler) ListTasks(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	taskType := c.Query("task_type")
	status := c.Query("status")
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 {
		limit = 50
	}
	tasks, err := h.taskSvc.ListTasks(c.Request.Context(), userID, taskType, status, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]any{"tasks": tasks})
}

// GET /api/analyze/tasks/count (jwt_required)
func (h *AnalyzeHandler) CountTasks(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	count, err := h.taskSvc.CountTasks(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]int64{"count": count})
}

// GET /api/analyze/tasks/status-count (jwt_required)
func (h *AnalyzeHandler) CountTasksByStatus(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	counts, err := h.taskSvc.CountTasksByStatus(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, counts)
}

// GET /api/analyze/tasks/:task_id (jwt_required)
func (h *AnalyzeHandler) GetTask(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	taskID := c.Param("task_id")
	task, err := h.taskSvc.GetTask(c.Request.Context(), taskID, userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, task)
}

// PATCH /api/analyze/tasks/:task_id/result (jwt_required)
func (h *AnalyzeHandler) UpdateTaskResult(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	taskID := c.Param("task_id")
	var body struct {
		Result map[string]any `json:"result"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if err := h.taskSvc.UpdateTaskResult(c.Request.Context(), taskID, userID, body.Result); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]bool{"success": true})
}

// DELETE /api/analyze/tasks/:task_id (jwt_required)
func (h *AnalyzeHandler) DeleteTask(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	taskID := c.Param("task_id")
	data, err := h.taskSvc.DeleteTask(c.Request.Context(), taskID, userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/analyze/tasks/cleanup-timeout (public, admin only)
func (h *AnalyzeHandler) CleanupTimeoutTasks(c *gin.Context) {
	adminKey := c.Query("admin_key")
	timeoutMinutes, _ := strconv.Atoi(c.Query("timeout_minutes"))
	if timeoutMinutes <= 0 {
		timeoutMinutes = 5
	}
	affected, err := h.taskSvc.CleanupTimeoutTasks(c.Request.Context(), timeoutMinutes, adminKey, h.adminKey)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]any{"affected": affected})
}
