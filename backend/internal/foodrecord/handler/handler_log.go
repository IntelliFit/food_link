package handler

import (
	"strings"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/handlerlog"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
	"log/slog"
)

func logFoodRecordAPI(c *gin.Context, action string, attrs ...slog.Attr) {
	handlerlog.Log(c, "food_record", action, "饮食记录接口", append([]slog.Attr{
		handlerlog.UserID(c, authmw.ContextUserIDKey),
	}, attrs...)...)
}

func logFoodRecordAPIError(c *gin.Context, action string, err error, attrs ...slog.Attr) {
	handlerlog.LogError(c, "food_record", action, err, append([]slog.Attr{
		handlerlog.UserID(c, authmw.ContextUserIDKey),
	}, attrs...)...)
}

func bindAnalysisTaskID(c *gin.Context, taskID string) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return
	}
	c.Set("analysis.task_id", taskID)
}

func taskIDAttr(c *gin.Context) slog.Attr {
	return logger.AnalysisTaskID(strings.TrimSpace(c.GetString("analysis.task_id")))
}
