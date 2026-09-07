package handler

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/internal/campuscatalog/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type CommunityCatalogService interface {
	ApplyUserCorrection(ctx context.Context, userID, itemID string, input service.CorrectionInput) (*service.CorrectionResult, error)
	ListRevisions(ctx context.Context, itemID string, page, limit int) (*service.RevisionListResult, error)
	UploadCommunityImage(ctx context.Context, userID, sourceFilename, contentType string, data []byte) (string, error)
	ApplyCollector(ctx context.Context, userID string, input service.CollectorApplicationInput) (*domain.CollectorApplication, error)
	GetCollectorProfile(ctx context.Context, userID string) (*service.CollectorProfile, error)
	CreateCollectorBatch(ctx context.Context, userID string, input service.CreateBatchInput) (*service.CreateBatchResult, error)
	ListCollectorApplications(ctx context.Context, status string, page, limit int) (*service.CollectorApplicationListResult, error)
	ReviewCollectorApplication(ctx context.Context, adminID, applicationID string, input service.ReviewCollectorApplicationInput) (*service.ReviewCollectorApplicationResult, error)
	RollbackRevision(ctx context.Context, adminID, itemID, revisionID string, input service.RollbackInput) (*service.CorrectionResult, error)
}

type CommunityHandler struct {
	svc CommunityCatalogService
}

func NewCommunityHandler(svc CommunityCatalogService) *CommunityHandler {
	return &CommunityHandler{svc: svc}
}

func (h *CommunityHandler) Correct(c *gin.Context) {
	var input service.CorrectionInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("纠错内容格式不正确"))
		return
	}
	userID := strings.TrimSpace(c.GetString(authmw.ContextUserIDKey))
	itemID := strings.TrimSpace(c.Param("item_id"))
	logger.Info(c.Request.Context(), "用户开始纠错校园菜品",
		slog.String("user_id", userID), slog.String("item_id", itemID), slog.Int64("base_version", input.BaseVersion))
	result, err := h.svc.ApplyUserCorrection(c.Request.Context(), userID, itemID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *CommunityHandler) Revisions(c *gin.Context) {
	itemID := strings.TrimSpace(c.Param("item_id"))
	result, err := h.svc.ListRevisions(
		c.Request.Context(), itemID,
		positiveInt(c.Query("page"), 1), positiveInt(c.Query("limit"), 20),
	)
	if err != nil {
		response.Error(c, err)
		return
	}
	// Community history needs attribution type, not internal account IDs. Admin
	// routes retain the IDs for audit; the user-facing route redacts them.
	if strings.TrimSpace(c.GetString("admin_account_id")) == "" {
		for index := range result.Items {
			result.Items[index].ActorUserID = nil
			result.Items[index].ActorAdminID = nil
		}
	}
	logger.Info(c.Request.Context(), "用户读取校园菜品更新记录成功",
		slog.String("user_id", strings.TrimSpace(c.GetString(authmw.ContextUserIDKey))),
		slog.String("item_id", itemID), slog.Int64("revision_count", result.Total))
	response.Success(c, result)
}

func (h *CommunityHandler) UploadImage(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString(authmw.ContextUserIDKey))
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxCampusCatalogImageBytes+(1<<20))
	fileHeader, err := c.FormFile("file")
	if err != nil {
		response.Error(c, badRequest("请选择要上传的图片"))
		return
	}
	if fileHeader.Size > maxCampusCatalogImageBytes {
		response.Error(c, badRequest("单张图片不能超过 20MB"))
		return
	}
	file, err := fileHeader.Open()
	if err != nil {
		response.Error(c, err)
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxCampusCatalogImageBytes+1))
	if err != nil || int64(len(data)) > maxCampusCatalogImageBytes {
		response.Error(c, badRequest("图片读取失败或超过 20MB"))
		return
	}
	contentType := http.DetectContentType(data)
	if headerType := strings.ToLower(strings.TrimSpace(fileHeader.Header.Get("Content-Type"))); contentType == "application/octet-stream" && (headerType == "image/heic" || headerType == "image/heif") && looksLikeHEIF(data) {
		contentType = headerType
	}
	if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
		response.Error(c, badRequest("仅支持图片文件上传"))
		return
	}
	imageURL, err := h.svc.UploadCommunityImage(c.Request.Context(), userID, fileHeader.Filename, contentType, data)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "用户上传校园菜品采集图片成功",
		slog.String("user_id", userID), slog.Int("bytes", len(data)))
	response.Success(c, gin.H{"image_url": imageURL})
}

func (h *CommunityHandler) ApplyCollector(c *gin.Context) {
	var input service.CollectorApplicationInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("申请内容格式不正确"))
		return
	}
	application, err := h.svc.ApplyCollector(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"application": application})
}

func (h *CommunityHandler) CollectorProfile(c *gin.Context) {
	profile, err := h.svc.GetCollectorProfile(c.Request.Context(), c.GetString(authmw.ContextUserIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, profile)
}

func (h *CommunityHandler) CreateCollectorBatch(c *gin.Context) {
	var input service.CreateBatchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("采集批次格式不正确"))
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.svc.CreateCollectorBatch(c.Request.Context(), userID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "校园采集员批量上传菜品成功",
		slog.String("user_id", strings.TrimSpace(userID)), slog.String("batch_id", result.Batch.ID), slog.Int("item_count", len(result.Items)))
	response.Success(c, result)
}

func (h *CommunityHandler) AdminListCollectorApplications(c *gin.Context) {
	result, err := h.svc.ListCollectorApplications(c.Request.Context(), c.Query("status"), positiveInt(c.Query("page"), 1), positiveInt(c.Query("limit"), 20))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *CommunityHandler) AdminReviewCollectorApplication(c *gin.Context) {
	var input service.ReviewCollectorApplicationInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("审核内容格式不正确"))
		return
	}
	result, err := h.svc.ReviewCollectorApplication(
		c.Request.Context(), c.GetString("admin_account_id"), c.Param("application_id"), input,
	)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *CommunityHandler) AdminRollbackRevision(c *gin.Context) {
	var input service.RollbackInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, badRequest("回滚内容格式不正确"))
		return
	}
	result, err := h.svc.RollbackRevision(
		c.Request.Context(), c.GetString("admin_account_id"), c.Param("item_id"), c.Param("revision_id"), input,
	)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}
