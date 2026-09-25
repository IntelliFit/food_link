package handler

import (
	"context"
	"log/slog"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/marketingqr/domain"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type MarketingQRService interface {
	Landing(ctx context.Context, code string) (*domain.Landing, error)
	Track(ctx context.Context, code, visitorID, userID, eventType string, metadata map[string]any) error
	BindUser(ctx context.Context, code, visitorID, userID string) error
	Summary(ctx context.Context) ([]domain.Summary, error)
}

type MarketingQRHandler struct {
	svc MarketingQRService
}

func NewMarketingQRHandler(svc MarketingQRService) *MarketingQRHandler {
	return &MarketingQRHandler{svc: svc}
}

func (h *MarketingQRHandler) Landing(c *gin.Context) {
	code := c.Param("code")
	logger.Info(c.Request.Context(), "二维码落地页请求进入", slog.String("campaign_code", code))
	landing, err := h.svc.Landing(c.Request.Context(), code)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "二维码落地页请求完成",
		slog.String("campaign_code", landing.Code),
		slog.String("campaign_kind", landing.Kind),
	)
	response.Success(c, landing)
}

func (h *MarketingQRHandler) Track(c *gin.Context) {
	var body struct {
		VisitorID string         `json:"visitor_id"`
		EventType string         `json:"event_type"`
		Metadata  map[string]any `json:"metadata"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	code := c.Param("code")
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.svc.Track(c.Request.Context(), code, body.VisitorID, userID, body.EventType, body.Metadata); err != nil {
		logger.Error(c.Request.Context(), "记录二维码访问事件失败", err,
			slog.String("campaign_code", code),
			slog.String("event_type", body.EventType),
		)
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"recorded": true})
}

func (h *MarketingQRHandler) BindUser(c *gin.Context) {
	var body struct {
		VisitorID string `json:"visitor_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	code := c.Param("code")
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.svc.BindUser(c.Request.Context(), code, body.VisitorID, userID); err != nil {
		logger.Error(c.Request.Context(), "绑定二维码注册归因失败", err,
			slog.String("campaign_code", code),
			slog.String("user_id", userID),
		)
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "二维码注册归因绑定完成",
		slog.String("campaign_code", code),
		slog.String("user_id", userID),
	)
	response.Success(c, gin.H{"bound": true})
}

func (h *MarketingQRHandler) Summary(c *gin.Context) {
	items, err := h.svc.Summary(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}
