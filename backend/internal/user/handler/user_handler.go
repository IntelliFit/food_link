package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/user/service"

	"github.com/gin-gonic/gin"
)

type UserService interface {
	GetProfile(ctx context.Context, userID string) (map[string]any, error)
	GetPublicProfile(ctx context.Context, viewerUserID, targetUserID string) (map[string]any, error)
	UpdateProfile(ctx context.Context, userID string, input service.UpdateProfileInput) (map[string]any, error)
	GetDashboardTargets(ctx context.Context, userID string) (map[string]float64, error)
	UpdateDashboardTargets(ctx context.Context, userID string, input service.UpdateDashboardTargetsInput) (map[string]float64, error)
	GetHealthProfile(ctx context.Context, userID string) (map[string]any, error)
	UpdateHealthProfile(ctx context.Context, userID string, input service.UpdateHealthProfileInput) (map[string]any, error)
	GetRecordDays(ctx context.Context, userID string) (int64, error)
	UpdateLastSeenAnalyzeHistory(ctx context.Context, userID string) error
	AcknowledgeHealthDisclaimer(ctx context.Context, userID string) error
	DeleteAccount(ctx context.Context, userID string) error
	GetCustomHealthFocuses(ctx context.Context, userID string) ([]service.CustomHealthFocus, error)
	UpdateCustomHealthFocuses(ctx context.Context, userID string, focuses []service.CustomHealthFocus) ([]service.CustomHealthFocus, error)
	AddCustomHealthFocus(ctx context.Context, userID, label string) (*service.AddCustomHealthFocusResult, error)
	RemoveCustomHealthFocus(ctx context.Context, userID, focusID string) ([]service.CustomHealthFocus, error)
}

type BindPhoneService interface {
	BindPhone(ctx context.Context, userID string, input service.BindPhoneInput) (*service.BindPhoneOutput, error)
}

type UploadService interface {
	UploadAvatar(userID string, base64Image string) (string, error)
	UploadReportImage(userID string, base64Image string) (string, error)
	UploadCoverImage(userID string, base64Image string) (string, error)
}

type OCRService interface {
	ExtractFromBase64(ctx context.Context, base64Image string) (map[string]any, error)
	ExtractFromURL(ctx context.Context, imageURL string) (map[string]any, error)
}

type AnalysisTaskService interface {
	CreateHealthReportTask(ctx context.Context, userID string, input service.CreateHealthReportTaskInput) (string, error)
}

type FollowService interface {
	GetFollowStats(ctx context.Context, userID, currentUserID string) (map[string]any, error)
}

type UserHandler struct {
	userSvc         UserService
	bindPhoneSvc    BindPhoneService
	uploadSvc       UploadService
	ocrSvc          OCRService
	analysisTaskSvc AnalysisTaskService
	followSvc       FollowService
}

func NewUserHandler(
	userSvc UserService,
	bindPhoneSvc BindPhoneService,
	uploadSvc UploadService,
	ocrSvc OCRService,
	analysisTaskSvc AnalysisTaskService,
	followSvc FollowService,
) *UserHandler {
	return &UserHandler{
		userSvc:         userSvc,
		bindPhoneSvc:    bindPhoneSvc,
		uploadSvc:       uploadSvc,
		ocrSvc:          ocrSvc,
		analysisTaskSvc: analysisTaskSvc,
		followSvc:       followSvc,
	}
}

// GET /api/user/profile
func (h *UserHandler) GetProfile(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.userSvc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// PUT /api/user/profile
func (h *UserHandler) UpdateProfile(c *gin.Context) {
	var input service.UpdateProfileInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.userSvc.UpdateProfile(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "profile_update_ok", slog.Int("field_count", updateProfileFieldCount(input)))
	response.Success(c, data)
}

// POST /api/user/bind-phone
func (h *UserHandler) BindPhone(c *gin.Context) {
	var input service.BindPhoneInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.bindPhoneSvc.BindPhone(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "bind_phone_ok", slog.Bool("phone.bound", data != nil && data.PurePhoneNumber != ""))
	response.Success(c, data)
}

// POST /api/user/upload-avatar
func (h *UserHandler) UploadAvatar(c *gin.Context) {
	var body struct {
		Base64Image string `json:"base64Image"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.Base64Image == "" {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	imageURL, err := h.uploadSvc.UploadAvatar(userID, body.Base64Image)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "avatar_upload_ok", slog.Int("image.base64.length", len(body.Base64Image)))
	response.Success(c, map[string]string{"imageUrl": imageURL})
}

// GET /api/user/dashboard-targets
func (h *UserHandler) GetDashboardTargets(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.userSvc.GetDashboardTargets(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// PUT /api/user/dashboard-targets
func (h *UserHandler) UpdateDashboardTargets(c *gin.Context) {
	var input service.UpdateDashboardTargetsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.userSvc.UpdateDashboardTargets(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "dashboard_targets_update_ok",
		slog.Int("target_count", 4+len(input.MicroTargets)),
	)
	response.Success(c, data)
}

// GET /api/user/health-profile
func (h *UserHandler) GetHealthProfile(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.userSvc.GetHealthProfile(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// PUT /api/user/health-profile
func (h *UserHandler) UpdateHealthProfile(c *gin.Context) {
	var input service.UpdateHealthProfileInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.userSvc.UpdateHealthProfile(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "health_profile_update_ok",
		slog.Int("field_count", updateHealthProfileFieldCount(input)),
		slog.Bool("has_dashboard_targets", input.DashboardTargets != nil),
		slog.Int("dashboard_target_count", dashboardTargetCount(input.DashboardTargets)),
		slog.Int("medical_history_count", stringListCount(input.MedicalHistory)),
		slog.Int("diet_preference_count", stringListCount(input.DietPreference)),
		slog.Int("allergy_count", stringListCount(input.Allergies)),
		slog.Bool("has_report_extract", len(input.ReportExtract) > 0),
		slog.Bool("has_precision_reference_defaults", input.PrecisionReferenceDefaults != nil),
	)
	response.Success(c, data)
}

// POST /api/user/health-profile/ocr
func (h *UserHandler) HealthReportOCR(c *gin.Context) {
	var body struct {
		Base64Image string `json:"base64Image"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.Base64Image == "" {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	extracted, err := h.ocrSvc.ExtractFromBase64(c.Request.Context(), body.Base64Image)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "health_report_ocr_ok", slog.Int("extracted_field_count", len(extracted)))
	response.Success(c, map[string]any{"extracted": extracted})
}

// POST /api/user/health-profile/ocr-extract
func (h *UserHandler) HealthReportOCRExtract(c *gin.Context) {
	var body struct {
		ImageURL    string `json:"imageUrl"`
		Base64Image string `json:"base64Image"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	var extracted map[string]any
	var err error
	if body.ImageURL != "" {
		extracted, err = h.ocrSvc.ExtractFromURL(c.Request.Context(), body.ImageURL)
	} else if body.Base64Image != "" {
		extracted, err = h.ocrSvc.ExtractFromBase64(c.Request.Context(), body.Base64Image)
	} else {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	source := "base64"
	if body.ImageURL != "" {
		source = "url"
	}
	logUserAPI(c, "health_report_ocr_extract_ok",
		slog.String("image.source", source),
		slog.Int("extracted_field_count", len(extracted)),
	)
	response.Success(c, map[string]any{"extracted": extracted})
}

// POST /api/user/health-profile/submit-report-extraction-task
func (h *UserHandler) SubmitReportExtractionTask(c *gin.Context) {
	var input service.CreateHealthReportTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	if input.ImageURL == "" && len(input.ImageURLs) == 0 {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	taskID, err := h.analysisTaskSvc.CreateHealthReportTask(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	c.Set("analysis.task_id", taskID)
	logUserAPI(c, "health_report_task_submit_ok",
		slog.String("analysis.task_id", taskID),
		slog.Int("image_count", len(input.ImageURLs)),
		slog.Bool("has_primary_image", input.ImageURL != ""),
	)
	response.Success(c, map[string]string{"taskId": taskID})
}

// POST /api/user/upload-cover
func (h *UserHandler) UploadCoverImage(c *gin.Context) {
	var body struct {
		Base64Image string `json:"base64Image"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.Base64Image == "" {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	imageURL, err := h.uploadSvc.UploadCoverImage(userID, body.Base64Image)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "cover_image_upload_ok", slog.Int("image.base64.length", len(body.Base64Image)))
	response.Success(c, map[string]string{"imageUrl": imageURL})
}

// POST /api/user/health-profile/upload-report-image
func (h *UserHandler) UploadReportImage(c *gin.Context) {
	var body struct {
		Base64Image string `json:"base64Image"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.Base64Image == "" {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	imageURL, err := h.uploadSvc.UploadReportImage(userID, body.Base64Image)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "health_report_image_upload_ok", slog.Int("image.base64.length", len(body.Base64Image)))
	response.Success(c, map[string]string{"imageUrl": imageURL})
}

// GET /api/user/record-days
func (h *UserHandler) GetRecordDays(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	count, err := h.userSvc.GetRecordDays(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]int64{"record_days": count})
}

// POST /api/user/last-seen-analyze-history
func (h *UserHandler) UpdateLastSeenAnalyzeHistory(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.userSvc.UpdateLastSeenAnalyzeHistory(c.Request.Context(), userID); err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "last_seen_analyze_history_update_ok")
	response.Success(c, map[string]bool{"success": true})
}

func (h *UserHandler) AcknowledgeHealthDisclaimer(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.userSvc.AcknowledgeHealthDisclaimer(c.Request.Context(), userID); err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "health_disclaimer_ack_ok")
	response.Success(c, map[string]bool{"success": true})
}

func (h *UserHandler) DeleteAccount(c *gin.Context) {
	var input struct {
		Confirmation string `json:"confirmation"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "请准确输入“注销账号”以确认操作", HTTPStatus: http.StatusBadRequest})
		return
	}
	if strings.TrimSpace(input.Confirmation) != "注销账号" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "请准确输入“注销账号”以确认操作", HTTPStatus: http.StatusBadRequest})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.userSvc.DeleteAccount(c.Request.Context(), userID); err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "delete_account_ok")
	response.Success(c, map[string]bool{"success": true})
}

// GET /api/user/health-focuses
func (h *UserHandler) GetHealthFocuses(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	focuses, err := h.userSvc.GetCustomHealthFocuses(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"focuses":     focuses,
		"max_focuses": service.CustomHealthFocusMaxCountExport(),
	})
}

// PUT /api/user/health-focuses
func (h *UserHandler) UpdateHealthFocuses(c *gin.Context) {
	var body struct {
		Focuses []service.CustomHealthFocus `json:"focuses"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	focuses, err := h.userSvc.UpdateCustomHealthFocuses(c.Request.Context(), userID, body.Focuses)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "health_focuses_update_ok", slog.Int("focus_count", len(focuses)))
	response.Success(c, gin.H{"focuses": focuses})
}

// POST /api/user/health-focuses
func (h *UserHandler) AddHealthFocus(c *gin.Context) {
	var body struct {
		Label string `json:"label"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.userSvc.AddCustomHealthFocus(c.Request.Context(), userID, body.Label)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "health_focus_add_ok",
		slog.String("focus_id", result.FocusID),
		slog.Bool("already_exists", result.AlreadyExists),
		slog.Int("focus_count", len(result.Focuses)),
	)
	response.Success(c, gin.H{
		"focuses":        result.Focuses,
		"focus_id":       result.FocusID,
		"already_exists": result.AlreadyExists,
	})
}

// DELETE /api/user/health-focuses/:focus_id
func (h *UserHandler) RemoveHealthFocus(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	focusID := c.Param("focus_id")
	focuses, err := h.userSvc.RemoveCustomHealthFocus(c.Request.Context(), userID, focusID)
	if err != nil {
		response.Error(c, err)
		return
	}
	logUserAPI(c, "health_focus_remove_ok",
		slog.String("focus_id", focusID),
		slog.Int("focus_count", len(focuses)),
	)
	response.Success(c, gin.H{"focuses": focuses})
}

// GET /api/user/:user_id/public-profile
func (h *UserHandler) GetPublicProfile(c *gin.Context) {
	targetUserID := c.Param("user_id")
	currentUserID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.userSvc.GetPublicProfile(c.Request.Context(), currentUserID, targetUserID)
	if err != nil {
		response.Error(c, err)
		return
	}
	followStats, _ := h.followSvc.GetFollowStats(c.Request.Context(), targetUserID, currentUserID)
	if followStats != nil {
		for k, v := range followStats {
			data[k] = v
		}
	}
	response.Success(c, data)
}
