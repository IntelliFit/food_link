package handler

import (
	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/push/domain"
	"food_link/backend/internal/push/service"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"log/slog"
	"net/http"
)

type Handler struct{ svc *service.Service }

func New(svc *service.Service) *Handler { return &Handler{svc: svc} }
func (h *Handler) RegisterRoutes(group *gin.RouterGroup) {
	group.GET("/preferences", h.Settings)
	group.PUT("/preferences", h.SaveSettings)
	group.PUT("/devices/:installation_id", h.Register)
	group.DELETE("/devices/:installation_id", h.Revoke)
}
func begin(c *gin.Context, action string) string {
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "提醒请求进入", slog.String("user_id", userID), slog.String("action", action))
	return userID
}
func complete(c *gin.Context, action string) {
	logger.Info(c.Request.Context(), "提醒请求完成", slog.String("user_id", c.GetString(authmw.ContextUserIDKey)), slog.String("action", action))
}
func (h *Handler) Settings(c *gin.Context) {
	userID := begin(c, "read_preferences")
	data, err := h.svc.Settings(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	complete(c, "read_preferences")
	response.Success(c, data)
}
func (h *Handler) SaveSettings(c *gin.Context) {
	userID := begin(c, "save_preferences")
	var body domain.Preferences
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	data, err := h.svc.SaveSettings(c.Request.Context(), userID, body)
	if err != nil {
		response.Error(c, err)
		return
	}
	complete(c, "save_preferences")
	response.Success(c, data)
}
func (h *Handler) Register(c *gin.Context) {
	userID := begin(c, "register_device")
	var body service.RegisterInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	if err := h.svc.Register(c.Request.Context(), userID, c.Param("installation_id"), body); err != nil {
		response.Error(c, err)
		return
	}
	complete(c, "register_device")
	response.Success(c, gin.H{"registered": true})
}
func (h *Handler) Revoke(c *gin.Context) {
	userID := begin(c, "revoke_device")
	if err := h.svc.Revoke(c.Request.Context(), userID, c.Param("installation_id")); err != nil {
		response.Error(c, err)
		return
	}
	complete(c, "revoke_device")
	response.Success(c, gin.H{"registered": false})
}
