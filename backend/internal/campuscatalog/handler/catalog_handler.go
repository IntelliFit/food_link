package handler

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/internal/campuscatalog/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

const maxCampusCatalogImageBytes int64 = 20 << 20

type CatalogService interface {
	UploadImage(ctx context.Context, adminID, sourceFilename, contentType string, data []byte) (string, error)
	CreateBatch(ctx context.Context, adminID string, input service.CreateBatchInput) (*service.CreateBatchResult, error)
	ListBatches(ctx context.Context, page, limit int) (*service.BatchListResult, error)
	ListItemsByBatch(ctx context.Context, batchID string) ([]domain.CatalogItem, error)
	UpdateItem(ctx context.Context, adminID, itemID string, input service.UpdateCatalogItemInput) (*domain.CatalogItem, error)
	PublishItem(ctx context.Context, adminID, itemID string) (*domain.CatalogItem, error)
}

type CatalogHandler struct {
	svc CatalogService
}

func NewCatalogHandler(svc CatalogService) *CatalogHandler {
	return &CatalogHandler{svc: svc}
}

func (h *CatalogHandler) UploadImage(c *gin.Context) {
	adminID := strings.TrimSpace(c.GetString("admin_account_id"))
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
	if err != nil {
		response.Error(c, err)
		return
	}
	if int64(len(data)) > maxCampusCatalogImageBytes {
		response.Error(c, badRequest("单张图片不能超过 20MB"))
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
	imageURL, err := h.svc.UploadImage(c.Request.Context(), adminID, fileHeader.Filename, contentType, data)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员上传食堂采集图片成功",
		slog.String("admin_id", adminID),
		slog.String("source_filename", fileHeader.Filename),
		slog.Int("bytes", len(data)),
	)
	response.Success(c, gin.H{"image_url": imageURL})
}

func looksLikeHEIF(data []byte) bool {
	if len(data) < 12 || string(data[4:8]) != "ftyp" {
		return false
	}
	switch string(data[8:12]) {
	case "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1":
		return true
	default:
		return false
	}
}

func (h *CatalogHandler) CreateBatch(c *gin.Context) {
	var input service.CreateBatchInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	adminID := strings.TrimSpace(c.GetString("admin_account_id"))
	logger.Info(c.Request.Context(), "管理员开始保存食堂采集批次",
		slog.String("admin_id", adminID),
		slog.Int("item_count", len(input.Entries)),
	)
	result, err := h.svc.CreateBatch(c.Request.Context(), adminID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员保存食堂采集批次成功",
		slog.String("admin_id", adminID),
		slog.String("batch_id", result.Batch.ID),
		slog.Int("item_count", len(result.Items)),
		slog.Bool("idempotent", result.Idempotent),
	)
	response.Success(c, result)
}

func (h *CatalogHandler) ListBatches(c *gin.Context) {
	result, err := h.svc.ListBatches(c.Request.Context(), positiveInt(c.Query("page"), 1), positiveInt(c.Query("limit"), 20))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *CatalogHandler) ListItems(c *gin.Context) {
	items, err := h.svc.ListItemsByBatch(c.Request.Context(), c.Query("batch_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

func (h *CatalogHandler) UpdateItem(c *gin.Context) {
	var input service.UpdateCatalogItemInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.Error(c, err)
		return
	}
	adminID := strings.TrimSpace(c.GetString("admin_account_id"))
	itemID := strings.TrimSpace(c.Param("item_id"))
	logger.Info(c.Request.Context(), "管理员开始更新食堂采集条目",
		slog.String("admin_id", adminID),
		slog.String("item_id", itemID),
	)
	item, err := h.svc.UpdateItem(c.Request.Context(), adminID, itemID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员更新食堂采集条目成功",
		slog.String("admin_id", adminID),
		slog.String("item_id", item.ID),
		slog.Int("missing_field_count", len(item.MissingFields)),
	)
	response.Success(c, gin.H{"item": item})
}

func (h *CatalogHandler) PublishItem(c *gin.Context) {
	adminID := strings.TrimSpace(c.GetString("admin_account_id"))
	itemID := strings.TrimSpace(c.Param("item_id"))
	logger.Info(c.Request.Context(), "管理员开始提交食堂采集条目上线",
		slog.String("admin_id", adminID), slog.String("item_id", itemID))
	item, err := h.svc.PublishItem(c.Request.Context(), adminID, itemID)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员提交食堂采集条目上线成功",
		slog.String("admin_id", adminID), slog.String("item_id", item.ID))
	c.JSON(http.StatusAccepted, gin.H{
		"code": 0, "message": "AI 分析任务已提交", "data": gin.H{"item": item},
	})
}

func badRequest(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: http.StatusBadRequest}
}

func positiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}
