package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"food_link/backend/internal/analyze/domain"
	"food_link/backend/internal/analyze/service"
	authmw "food_link/backend/internal/auth"
	errors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"
	apm "food_link/backend/pkg/trace"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel/attribute"
	"log/slog"
)

type AnalyzeService interface {
	Analyze(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
	AnalyzeText(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
	AnalyzeCompare(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
	AnalyzeCompareEngines(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
	AnalyzeBatch(ctx context.Context, userID string, input service.AnalyzeInput) (map[string]any, error)
	ClassifyGooseDuckChicken(ctx context.Context, userID string, input service.GooseDuckChickenInput) (service.GooseDuckChickenResult, error)
}

type TaskService interface {
	SubmitAnalyzeTask(ctx context.Context, userID string, input service.SubmitTaskInput) (string, error)
	SubmitTextTask(ctx context.Context, userID string, input service.SubmitTaskInput) (string, error)
	CreateBatchTask(ctx context.Context, userID string, imageURLs []string, payload map[string]any, result map[string]any) (string, error)
	ListTasks(ctx context.Context, userID, taskType, status, search string, limit int) ([]domain.AnalysisTask, error)
	CountTasks(ctx context.Context, userID string) (int64, error)
	CountTasksByStatus(ctx context.Context, userID string) (map[string]any, error)
	GetTask(ctx context.Context, taskID, userID string) (*domain.AnalysisTask, error)
	UpdateTaskResult(ctx context.Context, taskID, userID string, result map[string]any) error
	RetryTask(ctx context.Context, taskID, userID string) (*service.RetryTaskResult, error)
	DeleteTask(ctx context.Context, taskID, userID string) (map[string]any, error)
	CleanupTimeoutTasks(ctx context.Context, timeoutMinutes int, adminKey, expectedAdminKey string) (int64, error)
	SubmitFeedback(ctx context.Context, userID string, input service.SubmitFeedbackInput) error
}

type paginatedTaskService interface {
	ListTasksPage(ctx context.Context, userID, taskType, status, search string, limit, offset int) (service.TaskListPage, error)
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

func bindTaskIDToRequest(c *gin.Context, taskID string) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return
	}
	c.Set("analysis.task_id", taskID)
	apm.SetAttributes(c.Request.Context(), attribute.String("analysis.task_id", taskID))
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
	logAnalyzeAPI(c, "sync_image_analyze",
		slog.Int("image_count", imageCountForSubmitLog(service.SubmitTaskInput{ImageURL: input.ImageURL, ImageURLs: input.ImageURLs})),
		slog.String("execution_mode", analyzeExecutionMode(input.ExecutionMode)),
	)
	data, err := h.analyzeSvc.Analyze(c.Request.Context(), userID, input)
	if err != nil {
		logAnalyzeAPIError(c, "sync_image_analyze", err)
		response.Error(c, err)
		return
	}
	logAnalyzeAPI(c, "sync_image_analyze_ok", slog.Int("item_count", analyzeItemCount(data)))
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
	logAnalyzeAPI(c, "sync_text_analyze", slog.Bool("has_text", strings.TrimSpace(input.Text) != ""))
	data, err := h.analyzeSvc.AnalyzeText(c.Request.Context(), userID, input)
	if err != nil {
		logAnalyzeAPIError(c, "sync_text_analyze", err)
		response.Error(c, err)
		return
	}
	logAnalyzeAPI(c, "sync_text_analyze_ok", slog.Int("item_count", analyzeItemCount(data)))
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
	if input.TimezoneOffsetMinutes != nil {
		payload["timezone_offset_minutes"] = *input.TimezoneOffsetMinutes
	}
	if input.IsMultiView {
		payload["is_multi_view"] = true
	}
	if len(input.ReferenceObjects) > 0 {
		payload["reference_objects"] = input.ReferenceObjects
	}

	taskID, err := h.taskSvc.CreateBatchTask(c.Request.Context(), userID, input.ImageURLs, payload, result)
	if err != nil {
		response.Error(c, err)
		return
	}
	bindTaskIDToRequest(c, taskID)

	response.Success(c, map[string]any{
		"task_id":     taskID,
		"image_count": len(input.ImageURLs),
		"result":      result,
	})
}

// POST /api/analyze/goose-duck-chicken (jwt_required)
func (h *AnalyzeHandler) ClassifyGooseDuckChicken(c *gin.Context) {
	var input service.GooseDuckChickenInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	if strings.TrimSpace(input.ImageURL) == "" {
		response.Error(c, &errors.AppError{Code: 10002, Message: "image_url 不能为空", HTTPStatus: http.StatusBadRequest})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logAnalyzeAPI(c, "goose_duck_chicken_classify",
		slog.String("lane", "goose_duck_chicken"),
	)
	result, err := h.analyzeSvc.ClassifyGooseDuckChicken(c.Request.Context(), userID, input)
	if err != nil {
		logAnalyzeAPIError(c, "goose_duck_chicken_classify", err)
		response.Error(c, err)
		return
	}
	logAnalyzeAPI(c, "goose_duck_chicken_classify_ok",
		slog.String("species", result.Species),
		slog.Float64("confidence", result.Confidence),
	)
	response.Success(c, result)
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
	logAnalyzeAPI(c, "submit_image_task",
		slog.Int("image_count", imageCountForSubmitLog(input)),
		slog.String("execution_mode", stringFromSubmitExecutionMode(input)),
		slog.String("source_type", strings.TrimSpace(input.SourceType)),
	)
	taskID, err := h.taskSvc.SubmitAnalyzeTask(c.Request.Context(), userID, input)
	if err != nil {
		logAnalyzeAPIError(c, "submit_image_task", err)
		response.Error(c, err)
		return
	}
	bindTaskIDToRequest(c, taskID)
	logAnalyzeAPI(c, "submit_image_task_ok", logger.AnalysisTaskID(taskID))
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
		input.TextInput = input.Text
	}
	if input.TextInput == "" && input.PrecisionSessionID == nil && strings.TrimSpace(input.AdditionalContext) == "" && len(input.ReferenceObjects) == 0 && len(input.CorrectionItems) == 0 && len(input.PreviousResult) == 0 {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logAnalyzeAPI(c, "submit_text_task",
		slog.Bool("has_text", strings.TrimSpace(input.TextInput) != "" || strings.TrimSpace(input.Text) != ""),
		slog.String("execution_mode", stringFromSubmitExecutionMode(input)),
	)
	taskID, err := h.taskSvc.SubmitTextTask(c.Request.Context(), userID, input)
	if err != nil {
		logAnalyzeAPIError(c, "submit_text_task", err)
		response.Error(c, err)
		return
	}
	bindTaskIDToRequest(c, taskID)
	logAnalyzeAPI(c, "submit_text_task_ok", logger.AnalysisTaskID(taskID))
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
	search := c.Query("search")
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	offset := 0
	if rawOffset := strings.TrimSpace(c.Query("offset")); rawOffset != "" {
		parsedOffset, err := strconv.Atoi(rawOffset)
		if err != nil || parsedOffset < 0 {
			response.Error(c, &errors.AppError{
				Code:       10002,
				Message:    "offset 必须是非负整数",
				HTTPStatus: http.StatusBadRequest,
			})
			return
		}
		offset = parsedOffset
	}

	logger.Info(c.Request.Context(), "查询识别记录列表",
		slog.String("user_id", userID),
		slog.Int("limit", limit),
		slog.Int("offset", offset),
		slog.Bool("has_search", strings.TrimSpace(search) != ""),
	)

	var page service.TaskListPage
	var err error
	if paginated, ok := h.taskSvc.(paginatedTaskService); ok {
		page, err = paginated.ListTasksPage(c.Request.Context(), userID, taskType, status, search, limit, offset)
	} else {
		page.Tasks, err = h.taskSvc.ListTasks(c.Request.Context(), userID, taskType, status, search, limit)
		page.NextOffset = offset + len(page.Tasks)
	}
	if err != nil {
		logger.Error(c.Request.Context(), "查询识别记录列表失败", err,
			slog.String("user_id", userID),
			slog.Int("limit", limit),
			slog.Int("offset", offset),
		)
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "查询识别记录列表完成",
		slog.String("user_id", userID),
		slog.Int("returned_count", len(page.Tasks)),
		slog.Int("next_offset", page.NextOffset),
		slog.Bool("has_more", page.HasMore),
	)
	response.Success(c, page)
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
	bindTaskIDToRequest(c, taskID)
	task, err := h.taskSvc.GetTask(c.Request.Context(), taskID, userID)
	if err != nil {
		logAnalyzeAPIError(c, "get_task", err, logger.AnalysisTaskID(taskID))
		response.Error(c, err)
		return
	}
	if task != nil && (task.Status == "failed" || task.Status == "timed_out") {
		logAnalyzeAPI(c, "get_task_terminal",
			logger.AnalysisTaskID(taskID),
			logger.TaskType(task.TaskType),
			slog.String("status", task.Status),
			logger.Truncated("error_message", stringPtrValue(task.ErrorMessage), 300),
		)
	}
	response.Success(c, task)
}

// PATCH /api/analyze/tasks/:task_id/result (jwt_required)
func (h *AnalyzeHandler) UpdateTaskResult(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	taskID := c.Param("task_id")
	bindTaskIDToRequest(c, taskID)
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

// POST /api/analyze/tasks/retry (jwt_required)
func (h *AnalyzeHandler) RetryTask(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	var body struct {
		TaskID string `json:"task_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	taskID := strings.TrimSpace(body.TaskID)
	if taskID == "" {
		response.Error(c, &errors.AppError{Code: 10002, Message: "task_id 不能为空", HTTPStatus: 400})
		return
	}
	bindTaskIDToRequest(c, taskID)
	data, err := h.taskSvc.RetryTask(c.Request.Context(), taskID, userID)
	if err != nil {
		logAnalyzeAPIError(c, "retry_task", err, logger.AnalysisTaskID(taskID))
		response.Error(c, err)
		return
	}
	logAnalyzeAPI(c, "retry_task_ok", logger.AnalysisTaskID(taskID))
	response.Success(c, data)
}

// DELETE /api/analyze/tasks/:task_id (jwt_required)
func (h *AnalyzeHandler) DeleteTask(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	taskID := c.Param("task_id")
	bindTaskIDToRequest(c, taskID)
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

// POST /api/precision-sessions/:session_id/continue
func (h *AnalyzeHandler) ContinuePrecisionSession(c *gin.Context) {
	var body struct {
		SourceType            string           `json:"source_type"`
		ImageURL              string           `json:"image_url"`
		ImageURLs             []string         `json:"image_urls"`
		Text                  string           `json:"text"`
		Date                  *string          `json:"date"`
		AdditionalContext     string           `json:"additionalContext"`
		MealType              string           `json:"meal_type"`
		TimezoneOffsetMinutes *int             `json:"timezone_offset_minutes"`
		Province              string           `json:"province"`
		City                  string           `json:"city"`
		District              string           `json:"district"`
		DietGoal              string           `json:"diet_goal"`
		ActivityTiming        string           `json:"activity_timing"`
		UserGoal              string           `json:"user_goal"`
		RemainingCalories     *float64         `json:"remaining_calories"`
		SuggestRatioEnabled   bool             `json:"suggest_ratio_enabled"`
		IsMultiView           bool             `json:"is_multi_view"`
		PreviousResult        map[string]any   `json:"previousResult"`
		CorrectionItems       []map[string]any `json:"correctionItems"`
		ReferenceObjects      []map[string]any `json:"reference_objects"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	sourceType := strings.ToLower(strings.TrimSpace(body.SourceType))
	if sourceType != "image" && sourceType != "text" {
		response.Error(c, &errors.AppError{Code: 10002, Message: "source_type 必须为 image 或 text", HTTPStatus: 400})
		return
	}
	sessionID := c.Param("session_id")
	mode := "experimental"
	input := service.SubmitTaskInput{
		ImageURL:              strings.TrimSpace(body.ImageURL),
		ImageURLs:             body.ImageURLs,
		TextInput:             strings.TrimSpace(body.Text),
		SourceType:            sourceType,
		MealType:              body.MealType,
		Province:              body.Province,
		City:                  body.City,
		District:              body.District,
		DietGoal:              body.DietGoal,
		ActivityTiming:        body.ActivityTiming,
		UserGoal:              body.UserGoal,
		RemainingCalories:     body.RemainingCalories,
		SuggestRatioEnabled:   body.SuggestRatioEnabled,
		AdditionalContext:     body.AdditionalContext,
		ExecutionMode:         &mode,
		PrecisionSessionID:    &sessionID,
		TimezoneOffsetMinutes: body.TimezoneOffsetMinutes,
		IsMultiView:           body.IsMultiView,
		PreviousResult:        body.PreviousResult,
		CorrectionItems:       body.CorrectionItems,
		ReferenceObjects:      body.ReferenceObjects,
	}
	if body.Date != nil {
		input.Date = strings.TrimSpace(*body.Date)
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	var taskID string
	var err error
	if sourceType == "text" {
		if input.TextInput == "" && input.AdditionalContext == "" && len(body.ReferenceObjects) == 0 {
			response.Error(c, &errors.AppError{Code: 10002, Message: "请至少补充说明、参考物或新的文字描述", HTTPStatus: 400})
			return
		}
		taskID, err = h.taskSvc.SubmitTextTask(c.Request.Context(), userID, input)
	} else {
		if input.ImageURL == "" && len(input.ImageURLs) == 0 && input.AdditionalContext == "" && len(body.ReferenceObjects) == 0 {
			response.Error(c, &errors.AppError{Code: 10002, Message: "请至少补充说明、参考物或新的图片", HTTPStatus: 400})
			return
		}
		taskID, err = h.taskSvc.SubmitAnalyzeTask(c.Request.Context(), userID, input)
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	bindTaskIDToRequest(c, taskID)
	response.Success(c, gin.H{"task_id": taskID, "message": "精准模式已继续，系统正在重新规划本轮估计"})
}

// SubmitFeedback — POST /api/analyze/feedback
// 统一的分析反馈录入接口，用于前端埋点写入 analysis_feedback_samples。
func (h *AnalyzeHandler) SubmitFeedback(c *gin.Context) {
	var input service.SubmitFeedbackInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.taskSvc.SubmitFeedback(c.Request.Context(), userID, input); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "反馈已记录"})
}
