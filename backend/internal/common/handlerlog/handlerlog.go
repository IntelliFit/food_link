package handlerlog

import (
	"strings"

	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
	"log/slog"
)

// Log 记录 handler 层业务日志。
func Log(c *gin.Context, module, action, msg string, attrs ...slog.Attr) {
	if c == nil || c.Request == nil {
		return
	}
	logger.LogAPI(c.Request.Context(), msg, module, action, attrs...)
}

// LogError 记录 handler 层失败日志。
func LogError(c *gin.Context, module, action string, err error, attrs ...slog.Attr) {
	if c == nil || c.Request == nil {
		return
	}
	base := []slog.Attr{logger.APIAction(module, action)}
	logger.Error(c.Request.Context(), module+" 接口失败", err, append(base, attrs...)...)
}

// UserID 从 gin context 读取 user_id（需 auth 中间件已注入）。
func UserID(c *gin.Context, key string) slog.Attr {
	if c == nil {
		return logger.UserID("")
	}
	return logger.UserID(c.GetString(key))
}

// TaskID 从 gin context 读取 analysis.task_id。
func TaskID(c *gin.Context) slog.Attr {
	if c == nil {
		return logger.AnalysisTaskID("")
	}
	return logger.AnalysisTaskID(strings.TrimSpace(c.GetString("analysis.task_id")))
}
