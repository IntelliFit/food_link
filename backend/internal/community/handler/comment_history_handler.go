package handler

import (
	"context"
	"log/slog"
	"strconv"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/community/service"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
)

type ownCommentHistoryService interface {
	ListOwnComments(context.Context, string, string, int) (*service.OwnCommentPage, error)
}

func (h *CommunityHandler) OwnComments(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	svc, ok := h.svc.(ownCommentHistoryService)
	if !ok {
		response.Error(c, commonerrors.ErrInternal)
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	logger.Info(c.Request.Context(), "收到查询本人评论历史请求", slog.String("user_id", userID))
	page, err := svc.ListOwnComments(c.Request.Context(), userID, c.Query("cursor"), limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "查询本人评论历史响应完成", slog.String("user_id", userID), slog.Int("comment_count", len(page.List)))
	response.Success(c, page)
}
