package handler

import (
	"context"
	"log/slog"
	"strings"

	admindomain "food_link/backend/internal/admin/domain"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type AdminPaymentTestService interface {
	Summary(ctx context.Context) (*admindomain.PaymentTestSummary, error)
	UpdateSettings(ctx context.Context, enabled bool, updatedBy string) (*admindomain.PaymentTestSettings, error)
	SearchUsers(ctx context.Context, query string, limit int) ([]admindomain.PaymentTestUserSearchResult, error)
	AddUser(ctx context.Context, userID, note, createdBy string) (*admindomain.PaymentTestUser, error)
	RemoveUser(ctx context.Context, userID string) error
	CancelUserMembership(ctx context.Context, userID, cancelledBy string) (*admindomain.PaymentTestUser, error)
	RestoreUserMembership(ctx context.Context, userID, restoredBy string) (*admindomain.PaymentTestUser, error)
}

type PaymentTestHandler struct {
	svc AdminPaymentTestService
}

func NewPaymentTestHandler(svc AdminPaymentTestService) *PaymentTestHandler {
	return &PaymentTestHandler{svc: svc}
}

func (h *PaymentTestHandler) Summary(c *gin.Context) {
	summary, err := h.svc.Summary(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, summary)
}

func (h *PaymentTestHandler) UpdateSettings(c *gin.Context) {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	settings, err := h.svc.UpdateSettings(c.Request.Context(), body.Enabled, c.GetString("admin_username"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员更新支付测试开关",
		slog.Bool("enabled", settings.Enabled),
		slog.String("admin_username", c.GetString("admin_username")),
	)
	response.Success(c, gin.H{"settings": settings})
}

func (h *PaymentTestHandler) SearchUsers(c *gin.Context) {
	items, err := h.svc.SearchUsers(c.Request.Context(), c.Query("q"), positiveInt(c.DefaultQuery("limit", "20"), 20))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

func (h *PaymentTestHandler) AddUser(c *gin.Context) {
	var body struct {
		UserID string `json:"user_id"`
		Note   string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.AddUser(c.Request.Context(), body.UserID, body.Note, c.GetString("admin_username"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员加入支付测试用户",
		slog.String("user_id", item.UserID),
		slog.String("admin_username", c.GetString("admin_username")),
	)
	response.Success(c, gin.H{"item": item})
}

func (h *PaymentTestHandler) RemoveUser(c *gin.Context) {
	userID := strings.TrimSpace(c.Param("user_id"))
	if err := h.svc.RemoveUser(c.Request.Context(), userID); err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员移除支付测试用户",
		slog.String("user_id", userID),
		slog.String("admin_username", c.GetString("admin_username")),
	)
	response.Success(c, gin.H{"message": "ok"})
}

func (h *PaymentTestHandler) CancelUserMembership(c *gin.Context) {
	userID := strings.TrimSpace(c.Param("user_id"))
	item, err := h.svc.CancelUserMembership(c.Request.Context(), userID, c.GetString("admin_username"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员取消测试用户会员",
		slog.String("user_id", userID),
		slog.String("admin_username", c.GetString("admin_username")),
	)
	response.Success(c, gin.H{"item": item})
}

func (h *PaymentTestHandler) RestoreUserMembership(c *gin.Context) {
	userID := strings.TrimSpace(c.Param("user_id"))
	item, err := h.svc.RestoreUserMembership(c.Request.Context(), userID, c.GetString("admin_username"))
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "管理员恢复测试用户会员",
		slog.String("user_id", userID),
		slog.String("admin_username", c.GetString("admin_username")),
	)
	response.Success(c, gin.H{"item": item})
}
