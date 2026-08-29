package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/supplement/domain"
	"food_link/backend/internal/supplement/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type SupplementService interface {
	List(ctx context.Context, userID, status string) ([]domain.UserSupplement, error)
	ListCatalog(ctx context.Context, query string) ([]domain.SupplementCatalogItem, error)
	Create(ctx context.Context, userID string, input service.UpsertInput) (*domain.UserSupplement, error)
	Update(ctx context.Context, userID, itemID string, input service.UpsertInput) (*domain.UserSupplement, error)
	Record(ctx context.Context, userID, itemID string, input service.RecordInput) (*domain.SupplementIntake, error)
	DeleteIntake(ctx context.Context, userID, intakeID string) error
	Dashboard(ctx context.Context, userID, date string) (*service.DashboardResult, error)
	RecognizeLabel(ctx context.Context, imageURLs []string) (*service.LabelRecognitionResult, error)
}

type SupplementHandler struct{ svc SupplementService }

func NewSupplementHandler(svc SupplementService) *SupplementHandler {
	return &SupplementHandler{svc: svc}
}

type supplementBody struct {
	Name            string             `json:"name"`
	Brand           string             `json:"brand"`
	Barcode         *string            `json:"barcode"`
	ImageURL        *string            `json:"image_url"`
	ImageURLs       []string           `json:"image_urls"`
	DefaultServings float64            `json:"default_servings"`
	ServingLabel    string             `json:"serving_label"`
	ScheduleEnabled bool               `json:"schedule_enabled"`
	ScheduleTime    *string            `json:"schedule_time"`
	ScheduleDays    []int              `json:"schedule_days"`
	Components      []domain.Component `json:"components"`
	LabelConfirmed  bool               `json:"label_confirmed"`
	Status          string             `json:"status"`
}

func (h *SupplementHandler) List(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "收到查询补剂柜请求", slog.String("user_id", userID), slog.String("status", c.Query("status")))
	items, err := h.svc.List(c.Request.Context(), userID, c.Query("status"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "补剂柜查询完成", slog.String("user_id", userID), slog.Int("item_count", len(items)))
	response.Success(c, gin.H{"items": items})
}

func (h *SupplementHandler) ListCatalog(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	query := strings.TrimSpace(c.Query("q"))
	logger.Info(c.Request.Context(), "收到查询公共补剂库请求", slog.String("user_id", userID), slog.String("query", query))
	items, err := h.svc.ListCatalog(c.Request.Context(), query)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "公共补剂库查询完成", slog.String("user_id", userID), slog.Int("item_count", len(items)))
	response.Success(c, gin.H{"items": items})
}

func (h *SupplementHandler) RecognizeLabel(c *gin.Context) {
	var body struct {
		ImageURLs []string `json:"image_urls"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "收到补剂标签多图识别请求", slog.String("user_id", userID), slog.Int("image_count", len(body.ImageURLs)))
	result, err := h.svc.RecognizeLabel(c.Request.Context(), body.ImageURLs)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "补剂标签多图识别请求完成", slog.String("user_id", userID), slog.Int("component_count", len(result.Components)))
	response.Success(c, gin.H{"supplement": result})
}

func (h *SupplementHandler) Create(c *gin.Context) {
	var body supplementBody
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "收到创建补剂柜条目请求", slog.String("user_id", userID), slog.String("supplement_name", strings.TrimSpace(body.Name)))
	item, err := h.svc.Create(c.Request.Context(), userID, toUpsertInput(body))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "创建补剂柜条目完成", slog.String("user_id", userID), slog.String("supplement_id", item.ID))
	response.Success(c, gin.H{"message": "已加入补剂柜", "item": item})
}

func (h *SupplementHandler) Update(c *gin.Context) {
	var body supplementBody
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "收到更新补剂柜条目请求", slog.String("user_id", userID), slog.String("supplement_id", c.Param("item_id")))
	item, err := h.svc.Update(c.Request.Context(), userID, c.Param("item_id"), toUpsertInput(body))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "更新补剂柜条目完成", slog.String("user_id", userID), slog.String("supplement_id", item.ID))
	response.Success(c, gin.H{"message": "补剂柜已更新", "item": item})
}

func (h *SupplementHandler) Record(c *gin.Context) {
	var body struct {
		Servings       float64 `json:"servings"`
		TakenAt        string  `json:"taken_at"`
		Note           *string `json:"note"`
		Source         string  `json:"source"`
		IdempotencyKey string  `json:"idempotency_key"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	var takenAt *time.Time
	if strings.TrimSpace(body.TakenAt) != "" {
		parsed, err := time.Parse(time.RFC3339, body.TakenAt)
		if err != nil {
			response.Error(c, &commonerrors.AppError{Code: commonerrors.ErrBadRequest.Code, Message: "taken_at 格式无效", HTTPStatus: http.StatusBadRequest})
			return
		}
		takenAt = &parsed
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "收到记录补剂摄入请求", slog.String("user_id", userID), slog.String("supplement_id", c.Param("item_id")))
	intake, err := h.svc.Record(c.Request.Context(), userID, c.Param("item_id"), service.RecordInput{
		Servings: body.Servings, TakenAt: takenAt, Note: body.Note, Source: body.Source, IdempotencyKey: body.IdempotencyKey,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "记录补剂摄入完成", slog.String("user_id", userID), slog.String("supplement_id", c.Param("item_id")), slog.String("intake_id", intake.ID))
	response.Success(c, gin.H{"message": "已记录", "intake": intake})
}

func (h *SupplementHandler) Dashboard(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "收到查询补剂日报请求", slog.String("user_id", userID), slog.String("date", c.Query("date")))
	result, err := h.svc.Dashboard(c.Request.Context(), userID, c.Query("date"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "补剂日报查询完成", slog.String("user_id", userID), slog.String("date", result.Date), slog.Int("intake_count", len(result.Intakes)))
	response.Success(c, result)
}

func (h *SupplementHandler) DeleteIntake(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "收到删除补剂摄入请求", slog.String("user_id", userID), slog.String("intake_id", c.Param("intake_id")))
	if err := h.svc.DeleteIntake(c.Request.Context(), userID, c.Param("intake_id")); err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "删除补剂摄入完成", slog.String("user_id", userID), slog.String("intake_id", c.Param("intake_id")))
	response.Success(c, gin.H{"message": "记录已删除"})
}

func toUpsertInput(body supplementBody) service.UpsertInput {
	return service.UpsertInput{
		Name: body.Name, Brand: body.Brand, Barcode: body.Barcode, ImageURL: body.ImageURL, ImageURLs: body.ImageURLs,
		DefaultServings: body.DefaultServings, ServingLabel: body.ServingLabel,
		ScheduleEnabled: body.ScheduleEnabled, ScheduleTime: body.ScheduleTime, ScheduleDays: body.ScheduleDays,
		Components: body.Components, LabelConfirmed: body.LabelConfirmed, Status: body.Status,
	}
}
