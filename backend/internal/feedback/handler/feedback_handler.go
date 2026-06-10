package handler

import (
	"context"
	"log/slog"

	authmw "food_link/backend/internal/auth"
	commonmw "food_link/backend/internal/common/middleware"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/feedback/domain"
	"food_link/backend/internal/feedback/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type FeedbackService interface {
	Submit(ctx context.Context, userID string, input service.SubmitInput) (string, error)
}

type FeedbackHandler struct {
	svc FeedbackService
}

func NewFeedbackHandler(svc FeedbackService) *FeedbackHandler {
	return &FeedbackHandler{svc: svc}
}

func (h *FeedbackHandler) Submit(c *gin.Context) {
	var body struct {
		Category       string                      `json:"category"`
		Content        string                      `json:"content"`
		Contact        string                      `json:"contact"`
		PagePath       string                      `json:"page_path"`
		AppVersion     string                      `json:"app_version"`
		ClientInfo     map[string]any              `json:"client_info"`
		RecentRequests []domain.RecentRequestTrace `json:"recent_requests"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}

	userID := c.GetString(authmw.ContextUserIDKey)
	traceID, requestID, hostName := commonmw.RequestIDs(c)
	id, err := h.svc.Submit(c.Request.Context(), userID, service.SubmitInput{
		Category:        body.Category,
		Content:         body.Content,
		Contact:         body.Contact,
		PagePath:        body.PagePath,
		AppVersion:      body.AppVersion,
		ClientInfo:      body.ClientInfo,
		RecentRequests:  body.RecentRequests,
		SubmitTraceID:   traceID,
		SubmitRequestID: requestID,
		SubmitHostName:  hostName,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "用户提交意见反馈",
		slog.String("user_id", userID),
		slog.String("feedback_id", id),
		slog.String("category", body.Category),
		slog.Int("recent_request_count", len(body.RecentRequests)),
		slog.String("trace_id", traceID),
		slog.String("request_id", requestID),
	)
	response.Success(c, gin.H{"id": id, "message": "反馈已提交"})
}
