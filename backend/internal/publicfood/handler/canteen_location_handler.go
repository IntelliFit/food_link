package handler

import (
	"context"
	"log/slog"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
)

type CanteenLocationReader interface {
	ListCanteenLocations(context.Context, string) ([]domain.CanteenLocation, error)
}

type CanteenLocationHandler struct{ svc CanteenLocationReader }

func NewCanteenLocationHandler(svc CanteenLocationReader) *CanteenLocationHandler {
	return &CanteenLocationHandler{svc: svc}
}

func (h *CanteenLocationHandler) List(c *gin.Context) {
	ctx, userID := c.Request.Context(), c.GetString(authmw.ContextUserIDKey)
	logger.Info(ctx, "收到社区园区食堂地点查询请求", slog.String("user_id", userID))
	rows, err := h.svc.ListCanteenLocations(ctx, userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(ctx, "社区园区食堂地点请求完成", slog.String("user_id", userID), slog.Int("canteen_count", len(rows)))
	response.Success(c, gin.H{"list": rows})
}
