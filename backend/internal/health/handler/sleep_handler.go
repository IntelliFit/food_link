package handler

import (
	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/health/service"
	"food_link/backend/pkg/logger"
	"github.com/gin-gonic/gin"
	"log/slog"
)

type SleepHandler struct{ service *service.SleepService }

func NewSleepHandler(s *service.SleepService) *SleepHandler { return &SleepHandler{service: s} }
func (h *SleepHandler) Handle(c *gin.Context) {
	userID, date := c.GetString(authmw.ContextUserIDKey), c.Param("date")
	if userID == "" {
		response.Error(c, commonerrors.ErrUnauthorized)
		return
	}
	ctx := c.Request.Context()
	logger.Info(ctx, "睡眠记录请求进入", logger.UserID(userID), slog.String("date", date), slog.String("action", c.Request.Method))
	var data any
	var err error
	switch c.Request.Method {
	case "GET":
		data, err = h.service.Get(ctx, userID, date)
	case "PUT":
		var input service.SleepInput
		if c.ShouldBindJSON(&input) != nil {
			response.Error(c, commonerrors.ErrBadRequest)
			return
		}
		data, err = h.service.Save(ctx, userID, date, input)
	case "DELETE":
		err = h.service.Delete(ctx, userID, date)
		data = gin.H{"deleted": err == nil}
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(ctx, "睡眠记录请求完成", logger.UserID(userID), slog.String("date", date), slog.String("action", c.Request.Method))
	response.Success(c, data)
}
