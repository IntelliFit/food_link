package handler

import (
	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/promoter/service"

	"github.com/gin-gonic/gin"
)

func (h *PromoterHandler) Withdraw(c *gin.Context) {
	var body service.WithdrawInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.svc.Withdraw(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, item)
}

func (h *PromoterHandler) Withdrawals(c *gin.Context) {
	result, err := h.svc.Withdrawals(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), queryInt(c, "page"), queryInt(c, "limit"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *PromoterHandler) AdminWithdrawals(c *gin.Context) {
	result, err := h.svc.AdminWithdrawals(c.Request.Context(), c.Query("status"), queryInt(c, "page"), queryInt(c, "limit"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *PromoterHandler) AdminReviewWithdrawal(c *gin.Context) {
	var body service.WithdrawalReviewInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	row, err := h.svc.ReviewWithdrawal(c.Request.Context(), c.GetString("admin_username"), c.Param("withdrawal_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, row)
}

func (h *PromoterHandler) AdminRecordPayout(c *gin.Context) {
	var body service.WithdrawalPayoutInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	row, err := h.svc.RecordManualPayout(c.Request.Context(), c.GetString("admin_username"), c.Param("withdrawal_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, row)
}

func (h *PromoterHandler) AdminCommissions(c *gin.Context) {
	result, err := h.svc.AdminCommissions(c.Request.Context(), c.Param("promoter_id"), c.Query("status"), queryInt(c, "page"), queryInt(c, "limit"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *PromoterHandler) AdminReverseCommission(c *gin.Context) {
	var body service.ReverseCommissionInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.ReverseCommission(c.Request.Context(), c.GetString("admin_username"), c.Param("commission_id"), body)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}
