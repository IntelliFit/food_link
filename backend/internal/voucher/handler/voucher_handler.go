package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"food_link/backend/internal/common/response"
	voucherdomain "food_link/backend/internal/voucher/domain"

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
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	items, err := h.svc.ListMyVouchers(c.Request.Context(), userID, status, offset, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	count, _ := h.svc.CountMyVouchers(c.Request.Context(), userID, status)

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
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "礼券 ID 不能为空"})
		return
	}
	item, err := h.svc.GetVoucherDetail(c.Request.Context(), userID, voucherID)
	if err != nil {
		response.Error(c, err)
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "礼券不存在"})
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
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": "礼券 ID 不能为空"})
		return
	}
	if err := h.svc.UseVoucher(c.Request.Context(), userID, voucherID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": err.Error()})
		return
	}
	response.Success(c, gin.H{"success": true})
}
