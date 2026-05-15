package handler

import (
	"context"
	"net/http"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/user/service"

	"github.com/gin-gonic/gin"
)

type UserService interface {
	GetProfile(ctx context.Context, userID string) (map[string]any, error)
	UpdateProfile(ctx context.Context, userID string, input service.UpdateProfileInput) (map[string]any, error)
	GetDashboardTargets(ctx context.Context, userID string) (map[string]float64, error)
	UpdateDashboardTargets(ctx context.Context, userID string, input service.UpdateDashboardTargetsInput) (map[string]float64, error)
	GetHealthProfile(ctx context.Context, userID string) (map[string]any, error)
	UpdateHealthProfile(ctx context.Context, userID string, input service.UpdateHealthProfileInput) (map[string]any, error)
	GetRecordDays(ctx context.Context, userID string) (int64, error)
	UpdateLastSeenAnalyzeHistory(ctx context.Context, userID string) error
}

type BindPhoneService interface {
	BindPhone(ctx context.Context, userID string, input service.BindPhoneInput) (*service.BindPhoneOutput, error)
}

type UploadService interface {
	UploadAvatar(userID string, base64Image string) (string, error)
	UploadReportImage(userID string, base64Image string) (string, error)
}

type OCRService interface {
	ExtractFromBase64(ctx context.Context, base64Image string) (map[string]any, error)
	ExtractFromURL(ctx context.Context, imageURL string) (map[string]any, error)
}

type AnalysisTaskService interface {
	CreateHealthReportTask(ctx context.Context, userID string, input service.CreateHealthReportTaskInput) (string, error)
}

type UserHandler struct {
	userSvc         UserService
	bindPhoneSvc    BindPhoneService
	uploadSvc       UploadService
	ocrSvc          OCRService
	analysisTaskSvc AnalysisTaskService
}

func NewUserHandler(
	userSvc UserService,
	bindPhoneSvc BindPhoneService,
	uploadSvc UploadService,
	ocrSvc OCRService,
	analysisTaskSvc AnalysisTaskService,
) *UserHandler {
	return &UserHandler{
		userSvc:         userSvc,
		bindPhoneSvc:    bindPhoneSvc,
		uploadSvc:       uploadSvc,
		ocrSvc:          ocrSvc,
		analysisTaskSvc: analysisTaskSvc,
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
	response.Success(c, map[string]any{"extracted": extracted})
}

// POST /api/user/health-profile/submit-report-extraction-task
func (h *UserHandler) SubmitReportExtractionTask(c *gin.Context) {
	var input service.CreateHealthReportTaskInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	if input.ImageURL == "" {
		response.Error(c, &gin.Error{Err: http.ErrBodyNotAllowed, Type: gin.ErrorTypePublic})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	taskID, err := h.analysisTaskSvc.CreateHealthReportTask(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]string{"taskId": taskID})
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
	response.Success(c, map[string]bool{"success": true})
}
