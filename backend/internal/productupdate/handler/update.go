package handler

import (
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/productupdate/service"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"log/slog"
)

type Handler struct{ svc *service.Service }

func New(s *service.Service) *Handler { return &Handler{svc: s} }
func (h *Handler) list(c *gin.Context, admin, authenticated bool) {
	userID := ""
	if authenticated {
		userID = c.GetString("user_id")
	}
	logger.Info(c.Request.Context(), "读取产品通知", slog.String("user_id", userID), slog.Bool("admin", admin))
	items, err := h.svc.List(c.Request.Context(), userID, c.Query("app_version"), admin)
	if err != nil {
		response.Error(c, err)
		return
	}
	// Receipts and newly published notices must never be served from a CDN cache.
	c.Header("Cache-Control", "no-store")
	logger.Info(c.Request.Context(), "产品通知读取完成", slog.String("user_id", userID), slog.Int("count", len(items)))
	if !admin {
		public := make([]gin.H, 0, len(items))
		for _, item := range items {
			public = append(public, gin.H{"id": item.ID, "title": item.Title, "content": item.Content, "min_version": item.MinVersion, "published_at": item.PublishedAt})
		}
		response.Success(c, gin.H{"items": public})
		return
	}
	response.Success(c, gin.H{"items": items})
}
func (h *Handler) Public(c *gin.Context)    { h.list(c, false, false) }
func (h *Handler) Pending(c *gin.Context)   { h.list(c, false, true) }
func (h *Handler) AdminList(c *gin.Context) { h.list(c, true, false) }
func (h *Handler) Save(c *gin.Context) {
	logger.Info(c.Request.Context(), "管理员保存产品通知", slog.String("admin_username", c.GetString("admin_username")), slog.String("update_id", c.Param("id")))
	var in service.Input
	if err := c.ShouldBindJSON(&in); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	item, err := h.svc.Save(c.Request.Context(), c.Param("id"), c.GetString("admin_username"), in)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "产品通知保存完成", slog.String("update_id", item.ID))
	response.Success(c, gin.H{"item": item})
}
func (h *Handler) Transition(c *gin.Context) {
	logger.Info(c.Request.Context(), "管理员变更产品通知状态", slog.String("admin_username", c.GetString("admin_username")), slog.String("update_id", c.Param("id")), slog.String("action", c.Param("action")))
	if err := h.svc.Transition(c.Request.Context(), c.Param("id"), c.Param("action")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"success": true})
}
func (h *Handler) Acknowledge(c *gin.Context) {
	userID, id := c.GetString("user_id"), c.Param("id")
	logger.Info(c.Request.Context(), "用户确认产品通知", slog.String("user_id", userID), slog.String("update_id", id))
	var in struct {
		AppVersion string `json:"app_version"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	if err := h.svc.Acknowledge(c.Request.Context(), id, userID, in.AppVersion); err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "产品通知确认完成", slog.String("user_id", userID), slog.String("update_id", id))
	response.Success(c, gin.H{"success": true})
}
