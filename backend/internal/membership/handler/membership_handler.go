package handler

import (
	"context"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"

	"github.com/gin-gonic/gin"
)

type MembershipService interface {
	ListPlans(ctx context.Context) ([]map[string]any, error)
	GetMyMembership(ctx context.Context, userID string) (map[string]any, error)
	CreatePayment(ctx context.Context, userID, planID string) (map[string]any, error)
	WechatNotify(ctx context.Context, paymentID string) error
	ClaimSharePosterReward(ctx context.Context, userID, recordID string) (map[string]any, error)
}

type MembershipHandler struct {
	svc MembershipService
}

func NewMembershipHandler(svc MembershipService) *MembershipHandler {
	return &MembershipHandler{svc: svc}
}

// GET /api/membership/plans
func (h *MembershipHandler) ListPlans(c *gin.Context) {
	data, err := h.svc.ListPlans(c.Request.Context())
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// GET /api/membership/me
func (h *MembershipHandler) GetMyMembership(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	data, err := h.svc.GetMyMembership(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/membership/pay/create
func (h *MembershipHandler) CreatePayment(c *gin.Context) {
	var body struct {
		PlanID string `json:"plan_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.PlanID == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "plan_id required", HTTPStatus: 400})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	data, err := h.svc.CreatePayment(c.Request.Context(), userID, body.PlanID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/payment/wechat/notify/membership
func (h *MembershipHandler) WechatNotify(c *gin.Context) {
	var body struct {
		PaymentID string `json:"payment_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.PaymentID == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "payment_id required", HTTPStatus: 400})
		return
	}
	if err := h.svc.WechatNotify(c.Request.Context(), body.PaymentID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]bool{"success": true})
}

// POST /api/membership/rewards/share-poster/claim
func (h *MembershipHandler) ClaimSharePosterReward(c *gin.Context) {
	var body struct {
		RecordID string `json:"record_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if body.RecordID == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "record_id required", HTTPStatus: 400})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	data, err := h.svc.ClaimSharePosterReward(c.Request.Context(), userID, body.RecordID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}
