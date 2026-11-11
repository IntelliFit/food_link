package handler

import (
	authmw "food_link/backend/internal/auth"
	authservice "food_link/backend/internal/auth/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	userservice "food_link/backend/internal/user/service"
	"github.com/gin-gonic/gin"
	"strings"
)

type AccountDeletionHandler struct {
	service *userservice.AccountDeletionService
	jwt     *authservice.JWTService
}

func NewAccountDeletionHandler(service *userservice.AccountDeletionService, jwt *authservice.JWTService) *AccountDeletionHandler {
	return &AccountDeletionHandler{service: service, jwt: jwt}
}
func (h *AccountDeletionHandler) Status(c *gin.Context) {
	status, err := h.service.Status(c.Request.Context(), c.GetString(authmw.ContextUserIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, status)
}
func (h *AccountDeletionHandler) Request(c *gin.Context) {
	var input struct {
		Confirmation string `json:"confirmation"`
		Days         *int   `json:"cooling_off_days"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || strings.TrimSpace(input.Confirmation) != "注销账号" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "请准确输入“注销账号”以确认操作", HTTPStatus: 400})
		return
	}
	// Old clients default to a reversible request, never irreversible deletion.
	days := 7
	if input.Days != nil {
		days = *input.Days
	}
	id := c.GetString(authmw.ContextUserIDKey)
	status, err := h.service.Request(c.Request.Context(), id, days)
	if err != nil {
		response.Error(c, err)
		return
	}
	token, err := h.jwt.IssueAccess(id, c.GetString(authmw.ContextOpenIDKey), c.GetString(authmw.ContextUnionIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"status": status, "access_token": token, "user_id": id})
}
func (h *AccountDeletionHandler) Cancel(c *gin.Context) {
	var input struct {
		Confirmation string `json:"confirmation"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.Confirmation != "撤销注销" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "请确认撤销注销", HTTPStatus: 400})
		return
	}
	if err := h.service.Cancel(c.Request.Context(), c.GetString(authmw.ContextUserIDKey)); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"state": "cancelled", "require_login": true})
}
