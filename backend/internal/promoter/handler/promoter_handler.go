package handler

import (
	"context"
	"strconv"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/promoter/domain"
	"food_link/backend/internal/promoter/service"

	"github.com/gin-gonic/gin"
)

type PromoterService interface {
	Me(ctx context.Context, userID string) (*service.Me, error)
	Apply(ctx context.Context, userID string, input service.ApplyInput) (*service.Me, error)
	Bind(ctx context.Context, userID string, input service.BindInput) (*service.BindResult, error)
	Commissions(ctx context.Context, userID string, page, size int) (*service.CommissionPage, error)
	AdminList(ctx context.Context, status string, page, size int) (*service.AdminPromoterPage, error)
	Review(ctx context.Context, admin, promoterID string, input service.ReviewInput) (*domain.Promoter, error)
	ChangeStatus(ctx context.Context, admin, promoterID string, input service.StatusInput) (*domain.Promoter, error)
	SetRate(ctx context.Context, admin, promoterID string, input service.RateInput) (*domain.Promoter, error)
	Withdraw(ctx context.Context, userID string, input service.WithdrawInput) (*domain.WithdrawalItem, error)
	Withdrawals(ctx context.Context, userID string, page, size int) (*service.WithdrawalPage, error)
	AdminWithdrawals(ctx context.Context, status string, page, size int) (*service.AdminWithdrawalPage, error)
	ReviewWithdrawal(ctx context.Context, admin, withdrawalID string, input service.WithdrawalReviewInput) (*domain.Withdrawal, error)
	RecordManualPayout(ctx context.Context, admin, withdrawalID string, input service.WithdrawalPayoutInput) (*domain.Withdrawal, error)
	AdminCommissions(ctx context.Context, promoterID, status string, page, size int) (*service.AdminCommissionPage, error)
	ReverseCommission(ctx context.Context, admin, commissionID string, input service.ReverseCommissionInput) (*service.ReverseCommissionResult, error)
	RefreshWithdrawal(ctx context.Context, userID, withdrawalID string) (*domain.WithdrawalItem, error)
	AdminSyncTransfer(ctx context.Context, admin, withdrawalID string) (*domain.WithdrawalView, error)
}

type PromoterHandler struct {
	svc PromoterService
}

func NewPromoterHandler(svc PromoterService) *PromoterHandler {
	return &PromoterHandler{svc: svc}
}

func (h *PromoterHandler) Me(c *gin.Context) {
	me, err := h.svc.Me(c.Request.Context(), c.GetString(authmw.ContextUserIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, me)
}

func (h *PromoterHandler) Apply(c *gin.Context) {
	var body service.ApplyInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	me, err := h.svc.Apply(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, me)
}

func (h *PromoterHandler) Bind(c *gin.Context) {
	var body service.BindInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.Bind(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *PromoterHandler) Commissions(c *gin.Context) {
	page, size := queryInt(c, "page"), queryInt(c, "limit")
	result, err := h.svc.Commissions(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), page, size)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *PromoterHandler) AdminList(c *gin.Context) {
	result, err := h.svc.AdminList(c.Request.Context(), c.Query("status"), queryInt(c, "page"), queryInt(c, "limit"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *PromoterHandler) AdminReview(c *gin.Context) {
	var body service.ReviewInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	row, err := h.svc.Review(c.Request.Context(), c.GetString("admin_username"), c.Param("promoter_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, row)
}

func (h *PromoterHandler) AdminChangeStatus(c *gin.Context) {
	var body service.StatusInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	row, err := h.svc.ChangeStatus(c.Request.Context(), c.GetString("admin_username"), c.Param("promoter_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, row)
}

func (h *PromoterHandler) AdminSetRate(c *gin.Context) {
	var body service.RateInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	row, err := h.svc.SetRate(c.Request.Context(), c.GetString("admin_username"), c.Param("promoter_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, row)
}

func queryInt(c *gin.Context, key string) int {
	n, _ := strconv.Atoi(c.Query(key))
	return n
}
