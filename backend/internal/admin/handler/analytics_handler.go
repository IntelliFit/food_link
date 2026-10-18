package handler

import (
	"context"
	"food_link/backend/internal/admin/service"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

type AnalyticsHandler struct{ svc *service.AnalyticsService }

func NewAnalyticsHandler(svc *service.AnalyticsService) *AnalyticsHandler {
	return &AnalyticsHandler{svc}
}
func (h *AnalyticsHandler) Overview(c *gin.Context) {
	days, err := strconv.Atoi(c.DefaultQuery("days", "30"))
	if err != nil || (days != 7 && days != 30 && days != 90) {
		response.Error(c, &commonerrors.AppError{Code: 10001, Message: "仅支持7、30或90天", HTTPStatus: http.StatusBadRequest})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	logger.Info(ctx, "读取运营数据看板", slog.String("admin_id", c.GetString("admin_account_id")), slog.Int("days", days))
	data, err := h.svc.Overview(ctx, days)
	if err != nil {
		logger.Error(ctx, "读取运营数据看板失败", err)
		response.Error(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	logger.Info(ctx, "运营数据看板读取完成", slog.Int("day_count", len(data.Days)))
	response.Success(c, data)
}
