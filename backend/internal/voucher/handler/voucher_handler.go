package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"food_link/backend/internal/common/response"
	voucherdomain "food_link/backend/internal/voucher/domain"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

// VoucherService defines methods required by the voucher handler.
type VoucherService interface {
	ListMyVouchers(ctx context.Context, userID, status string, offset, limit int) ([]voucherdomain.UserVoucher, error)
	CountMyVouchers(ctx context.Context, userID, status string) (int64, error)
	GetVoucherDetail(ctx context.Context, userID, voucherID string) (*voucherdomain.UserVoucher, error)
	UseVoucher(ctx context.Context, userID, voucherID string) error
}

type VoucherHandler struct {
	svc VoucherService
}

func NewVoucherHandler(svc VoucherService) *VoucherHandler {
	return &VoucherHandler{svc: svc}
}

func (h *VoucherHandler) ListMyVouchers(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString("user_id"))
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "未登录"})
		return
	}
	status := strings.TrimSpace(c.Query("status"))
	logger.Info(c.Request.Context(), "查询用户可用奖励",
		slog.String("user_id", userID),
		slog.String("reward.status", status),
	)
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	items, err := h.svc.ListMyVouchers(c.Request.Context(), userID, status, offset, limit)
	if err != nil {
		logger.Error(c.Request.Context(), "查询用户可用奖励失败", err,
			slog.String("user_id", userID),
			slog.String("reward.status", status),
		)
		response.Error(c, err)
		return
	}
	count, _ := h.svc.CountMyVouchers(c.Request.Context(), userID, status)
	logger.Info(c.Request.Context(), "查询用户可用奖励完成",
		slog.String("user_id", userID),
		slog.Int("reward.returned_count", len(items)),
		slog.Int64("reward.total_count", count),
	)

	response.Success(c, gin.H{
		"items": items,
		"total": count,
	})
}

func (h *VoucherHandler) GetVoucherDetail(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString("user_id"))
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "未登录"})
		return
	}
	voucherID := strings.TrimSpace(c.Param("voucher_id"))
	if voucherID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "奖励 ID 不能为空"})
		return
	}
	item, err := h.svc.GetVoucherDetail(c.Request.Context(), userID, voucherID)
	if err != nil {
		response.Error(c, err)
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "奖励不存在"})
		return
	}
	response.Success(c, item)
}

func (h *VoucherHandler) UseVoucher(c *gin.Context) {
	userID := strings.TrimSpace(c.GetString("user_id"))
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "message": "未登录"})
		return
	}
	voucherID := strings.TrimSpace(c.Param("voucher_id"))
	if voucherID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "奖励 ID 不能为空"})
		return
	}
	logger.Info(c.Request.Context(), "启用用户奖励",
		slog.String("user_id", userID),
		slog.String("reward_id", voucherID),
	)
	if err := h.svc.UseVoucher(c.Request.Context(), userID, voucherID); err != nil {
		logger.Warn(c.Request.Context(), "启用用户奖励失败",
			slog.String("user_id", userID),
			slog.String("reward_id", voucherID),
			logger.Err(err),
		)
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": err.Error()})
		return
	}
	logger.Info(c.Request.Context(), "启用用户奖励完成",
		slog.String("user_id", userID),
		slog.String("reward_id", voucherID),
	)
	response.Success(c, gin.H{"success": true})
}
