package handler

import (
	"context"
	"log/slog"
	"strings"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/internal/admin/service"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type AdminFeedbackService interface {
	List(ctx context.Context, input service.ListFeedbackInput) (*repo.ListFeedbackResult, error)
	UpdateStatus(ctx context.Context, id, status, resolutionMessage string, rewardCredits *int, handledBy string) (*repo.FeedbackItem, error)
	GetStatusStats(ctx context.Context) (map[string]int64, error)
}

type FeedbackHandler struct {
	svc AdminFeedbackService
}

func NewFeedbackHandler(svc AdminFeedbackService) *FeedbackHandler {
	return &FeedbackHandler{svc: svc}
}

func (h *FeedbackHandler) StatusStats(c *gin.Context) {
	stats, err := h.svc.GetStatusStats(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"stats": stats})
}

func (h *FeedbackHandler) List(c *gin.Context) {
	page := positiveInt(c.Query("page"), 1)
	limit := positiveInt(c.Query("limit"), 30)
	result, err := h.svc.List(c.Request.Context(), service.ListFeedbackInput{
		Query:    c.Query("q"),
		Category: c.DefaultQuery("category", "all"),
		Status:   c.DefaultQuery("status", "all"),
		Page:     page,
		Limit:    limit,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"items": result.Items,
		"page":  page,
		"limit": limit,
		"total": result.Total,
	})
}

func (h *FeedbackHandler) UpdateStatus(c *gin.Context) {
	var body struct {
		Status            string `json:"status"`
		ResolutionMessage string `json:"resolution_message"`
		RewardCredits     *int   `json:"reward_credits"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.UpdateStatus(c.Request.Context(), c.Param("feedback_id"), body.Status, body.ResolutionMessage, body.RewardCredits, c.GetString("admin_username"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员更新意见反馈状态",
		slog.String("feedback_id", item.ID),
		slog.String("status", strings.TrimSpace(body.Status)),
	)
	response.Success(c, gin.H{"message": "状态已更新", "item": item})
}
