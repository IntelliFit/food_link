package handler

import (
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/researchweight/domain"
	"food_link/backend/internal/researchweight/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type SampleHandler struct {
	svc *service.SampleService
}

func NewSampleHandler(svc *service.SampleService) *SampleHandler {
	return &SampleHandler{svc: svc}
}

// POST /api/research-weight-samples
func (h *SampleHandler) Submit(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	var body service.SubmitInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "提交内容格式不正确", HTTPStatus: 400})
		return
	}
	item, err := h.svc.Submit(c.Request.Context(), userID, body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item, "message": "已提交，审核通过后发放奖励"})
}

// GET /api/research-weight-samples/mine
func (h *SampleHandler) Mine(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.svc.Mine(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "称重科研样本列表查询完成", slog.String("user_id", userID), slog.Int("result_count", len(result.Items)))
	response.Success(c, gin.H{"items": result.Items, "summary": result.Summary, "consent_version": domain.ConsentVersion})
}

// POST /api/research-weight-samples/upload-image
func (h *SampleHandler) UploadImage(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxImageBytes+1024*1024)
	file, err := c.FormFile("file")
	if err != nil || file.Size <= 0 || file.Size > service.MaxImageBytes {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "照片不能为空或超过 15MB", HTTPStatus: 400})
		return
	}
	opened, err := file.Open()
	if err != nil {
		response.Error(c, err)
		return
	}
	defer opened.Close()
	data, err := io.ReadAll(io.LimitReader(opened, service.MaxImageBytes+1))
	if err != nil {
		response.Error(c, err)
		return
	}
	url, err := h.svc.UploadImage(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), data)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"image_url": url})
}

// POST /api/research-weight-samples/upload-video
func (h *SampleHandler) UploadVideo(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxVideoBytes+1024*1024)
	file, err := c.FormFile("file")
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "视频文件不能为空或超过 8MB", HTTPStatus: 400})
		return
	}
	if file.Size <= 0 || file.Size > service.MaxVideoBytes {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "视频最多支持 8MB", HTTPStatus: http.StatusRequestEntityTooLarge})
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(file.Header.Get("Content-Type")))
	if contentType != "" && !strings.HasPrefix(contentType, "video/") && contentType != "application/octet-stream" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "仅支持 MP4、MOV 或 M4V 视频", HTTPStatus: 400})
		return
	}
	opened, err := file.Open()
	if err != nil {
		response.Error(c, err)
		return
	}
	defer opened.Close()
	data, err := io.ReadAll(io.LimitReader(opened, service.MaxVideoBytes+1))
	if err != nil {
		response.Error(c, err)
		return
	}
	if !strings.HasPrefix(contentType, "video/") {
		contentType = "video/mp4"
	}
	url, err := h.svc.UploadVideo(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), data, filepath.Ext(file.Filename), contentType)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"video_url": url})
}

// GET /api/research-weight-containers
func (h *SampleHandler) ListContainers(c *gin.Context) {
	items, err := h.svc.ListContainers(c.Request.Context(), c.GetString(authmw.ContextUserIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

// POST /api/research-weight-containers
func (h *SampleHandler) CreateContainer(c *gin.Context) {
	var body service.ContainerInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "容器信息格式不正确", HTTPStatus: 400})
		return
	}
	item, err := h.svc.CreateContainer(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item, "message": "已存为常用容器"})
}

// POST /api/research-weight-containers/:container_id/archive
func (h *SampleHandler) ArchiveContainer(c *gin.Context) {
	if err := h.svc.ArchiveContainer(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("container_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已停用"})
}

// GET /api/admin/research-weight-samples
func (h *SampleHandler) AdminList(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 40)
	result, err := h.svc.List(c.Request.Context(), domain.ListFilter{
		Status: c.DefaultQuery("status", domain.StatusPending), WeighingMode: c.Query("weighing_mode"),
		Scene: c.Query("scene"), Query: c.Query("q"), Limit: limit, Offset: (page - 1) * limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "后台称重科研样本列表查询完成", slog.Int("result_count", len(result.Items)), slog.Int64("total", result.Total))
	response.Success(c, gin.H{"items": result.Items, "total": result.Total, "page": page, "limit": limit})
}

// GET /api/admin/research-weight-samples/:sample_id
func (h *SampleHandler) AdminGet(c *gin.Context) {
	item, err := h.svc.Get(c.Request.Context(), c.Param("sample_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item})
}

// POST /api/admin/research-weight-samples/:sample_id/review
func (h *SampleHandler) AdminReview(c *gin.Context) {
	sampleID := c.Param("sample_id")
	reviewerID := c.GetString("admin_account_id")
	var body service.ReviewInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "审核内容格式不正确", HTTPStatus: 400})
		return
	}
	item, err := h.svc.Review(c.Request.Context(), sampleID, reviewerID, body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item, "message": "审核完成"})
}

// POST /api/admin/research-weight-samples/:sample_id/promote
func (h *SampleHandler) AdminPromote(c *gin.Context) {
	var body service.PromoteInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "批次信息格式不正确", HTTPStatus: 400})
		return
	}
	item, err := h.svc.Promote(c.Request.Context(), c.Param("sample_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item, "message": "已加入评测集"})
}

func positiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
