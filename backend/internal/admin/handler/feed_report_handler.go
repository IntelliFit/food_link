package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	admindomain "food_link/backend/internal/admin/domain"
	adminrepo "food_link/backend/internal/admin/repo"
	adminservice "food_link/backend/internal/admin/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type FeedReportService interface {
	List(ctx context.Context, input adminservice.ListFeedReportInput) (*adminrepo.ListFeedReportResult, error)
	Get(ctx context.Context, id string) (*admindomain.FeedReportItem, *admindomain.FeedReportTargetSnapshot, error)
	UpdateStatus(ctx context.Context, id, status, resolutionNote, handledBy string) (*admindomain.FeedReportItem, error)
	Delete(ctx context.Context, id string) error
	DeleteTargetContent(ctx context.Context, id, resolutionNote, handledBy string) (*admindomain.FeedReportItem, error)
	GetStatusStats(ctx context.Context) (map[string]int64, error)
}

type FeedReportHandler struct {
	svc FeedReportService
}

func NewFeedReportHandler(svc FeedReportService) *FeedReportHandler {
	return &FeedReportHandler{svc: svc}
}

func (h *FeedReportHandler) StatusStats(c *gin.Context) {
	stats, err := h.svc.GetStatusStats(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"stats": stats})
}

func (h *FeedReportHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	result, err := h.svc.List(c.Request.Context(), adminservice.ListFeedReportInput{
		Query:      c.Query("q"),
		Status:     c.Query("status"),
		TargetType: c.Query("target_type"),
		Page:       page,
		Limit:      limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *FeedReportHandler) Get(c *gin.Context) {
	item, snap, err := h.svc.Get(c.Request.Context(), c.Param("report_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"item":   item,
		"target": snap,
	})
}

func (h *FeedReportHandler) UpdateStatus(c *gin.Context) {
	var body struct {
		Status         string `json:"status" binding:"required"`
		ResolutionNote string `json:"resolution_note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	handledBy := c.GetString("admin_username")
	item, err := h.svc.UpdateStatus(c.Request.Context(), c.Param("report_id"), body.Status, body.ResolutionNote, handledBy)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员更新举报状态",
		slog.String("report_id", item.ID),
		slog.String("status", item.Status),
		slog.String("handled_by", handledBy),
	)
	response.Success(c, gin.H{"message": "状态已更新", "item": item})
}

func (h *FeedReportHandler) Delete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("report_id"))
	if id == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "举报 ID 不能为空", HTTPStatus: http.StatusBadRequest})
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员删除举报", slog.String("report_id", id))
	response.Success(c, gin.H{"message": "举报已删除"})
}
func (h *FeedReportHandler) DeleteTargetContent(c *gin.Context) {
	var body struct {
		ResolutionNote string `json:"resolution_note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		body.ResolutionNote = ""
	}
	id := strings.TrimSpace(c.Param("report_id"))
	if id == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "举报 ID 不能为空", HTTPStatus: http.StatusBadRequest})
		return
	}
	handledBy := c.GetString("admin_username")
	item, err := h.svc.DeleteTargetContent(c.Request.Context(), id, body.ResolutionNote, handledBy)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员删除被举报圈子内容",
		slog.String("report_id", item.ID),
		slog.String("target_type", item.TargetType),
		slog.String("target_id", item.TargetID),
		slog.String("handled_by", handledBy),
	)
	response.Success(c, gin.H{"message": "被举报的圈子内容已删除", "item": item})
}
