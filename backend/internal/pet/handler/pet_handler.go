package handler

import (
	"context"
	"log/slog"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/pet/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
)

type PetService interface {
	Summary(ctx context.Context, userID, date string) (*service.Summary, error)
	ClaimEvent(ctx context.Context, userID, eventID string) (*service.ClaimResult, error)
	RerollAppearance(ctx context.Context, userID string) (*service.AppearanceRerollResult, error)
	SelectAppearance(ctx context.Context, userID, candidateID string) (*service.AppearanceSelectResult, error)
}

type PetHandler struct {
	svc PetService
}

func NewPetHandler(svc PetService) *PetHandler {
	return &PetHandler{svc: svc}
}

func (h *PetHandler) Summary(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	date := strings.TrimSpace(c.Query("date"))
	data, err := h.svc.Summary(c.Request.Context(), userID, date)
	if err != nil {
		logger.Error(c.Request.Context(), "获取宠物状态失败", err,
			slog.String("user_id", userID),
			slog.String("date", date),
		)
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "获取宠物状态失败", HTTPStatus: 500})
		return
	}
	response.Success(c, data)
}

func (h *PetHandler) ClaimEvent(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	eventID := strings.TrimSpace(c.Param("event_id"))
	if eventID == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "event_id required", HTTPStatus: 400})
		return
	}
	data, err := h.svc.ClaimEvent(c.Request.Context(), userID, eventID)
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "领取宠物奖励失败", HTTPStatus: 500})
		return
	}
	if data == nil {
		response.Error(c, &commonerrors.AppError{Code: 10004, Message: "宠物事件不存在", HTTPStatus: 404})
		return
	}
	response.Success(c, data)
}

func (h *PetHandler) RerollAppearance(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	data, err := h.svc.RerollAppearance(c.Request.Context(), userID)
	if err != nil {
		if service.IsInsufficientEarnedCreditsError(err) {
			response.Error(c, &commonerrors.AppError{Code: 10003, Message: "奖励积分不足，至少需要 5 积分", HTTPStatus: 400})
			return
		}
		response.Error(c, &commonerrors.AppError{Code: 10000, Message: "更换宠物外观失败", HTTPStatus: 500})
		return
	}
	response.Success(c, data)
}

type selectAppearanceRequest struct {
	CandidateID string `json:"candidate_id"`
}

func (h *PetHandler) SelectAppearance(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	var req selectAppearanceRequest
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.CandidateID) == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "candidate_id required", HTTPStatus: 400})
		return
	}
	data, err := h.svc.SelectAppearance(c.Request.Context(), userID, strings.TrimSpace(req.CandidateID))
	if err != nil {
		response.Error(c, &commonerrors.AppError{Code: 10004, Message: "候选外观不存在", HTTPStatus: 400})
		return
	}
	if data == nil {
		response.Error(c, &commonerrors.AppError{Code: 10004, Message: "宠物档案不存在", HTTPStatus: 404})
		return
	}
	response.Success(c, data)
}
