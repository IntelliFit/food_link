package handler

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"food_link/backend/internal/admin/voucher_reward/domain"
	"food_link/backend/internal/common/response"

	"github.com/gin-gonic/gin"
)

// VoucherRewardService defines methods required by the admin voucher reward handler.
type VoucherRewardService interface {
	SearchUsers(ctx context.Context, query string, limit int) ([]domain.UserSearchResult, error)
	GetUserSummary(ctx context.Context, userID string) (*domain.UserSummary, error)
	IssuePointsVoucher(ctx context.Context, adminUserID, targetUserID string, input domain.IssuePointsVoucherInput) (*domain.IssuePointsVoucherResult, error)
}

type VoucherRewardHandler struct {
	svc VoucherRewardService
}

func NewVoucherRewardHandler(svc VoucherRewardService) *VoucherRewardHandler {
	return &VoucherRewardHandler{svc: svc}
}

func (h *VoucherRewardHandler) SearchUsers(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	items, err := h.svc.SearchUsers(c.Request.Context(), q, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

func (h *VoucherRewardHandler) GetUserSummary(c *gin.Context) {
	userID := strings.TrimSpace(c.Param("user_id"))
	if userID == "" {
		response.Error(c, fmt.Errorf("用户 ID 不能为空"))
		return
	}
	summary, err := h.svc.GetUserSummary(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	if summary == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "message": "用户不存在"})
		return
	}
	response.Success(c, summary)
}

func (h *VoucherRewardHandler) IssuePointsVoucher(c *gin.Context) {
	adminUserID := strings.TrimSpace(c.GetString("admin_account_id"))
	if adminUserID == "" {
		adminUserID = strings.TrimSpace(c.GetString("user_id"))
	}

	targetUserID := strings.TrimSpace(c.Param("user_id"))
	if targetUserID == "" {
		response.Error(c, fmt.Errorf("用户 ID 不能为空"))
		return
	}

	var input domain.IssuePointsVoucherInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "message": err.Error()})
		return
	}

	result, err := h.svc.IssuePointsVoucher(c.Request.Context(), adminUserID, targetUserID, input)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}
