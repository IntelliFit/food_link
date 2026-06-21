package handlerlog

import (
	"log/slog"
	"strings"

	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
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
	logger.Error(c.Request.Context(), moduleLogLabel(module)+"接口处理失败", err, append(base, attrs...)...)
}

func moduleLogLabel(module string) string {
	switch strings.TrimSpace(module) {
	case "admin":
		return "管理后台"
	case "analyze":
		return "食物识别"
	case "auth":
		return "认证"
	case "community":
		return "圈子"
	case "expiry":
		return "保质期"
	case "feedback":
		return "意见反馈"
	case "food_record":
		return "饮食记录"
	case "health":
		return "健康"
	case "home":
		return "首页"
	case "membership":
		return "会员"
	case "message":
		return "消息"
	case "pet":
		return "成长伙伴"
	case "public_food":
		return "公共食物库"
	case "recipe":
		return "食谱"
	case "school":
		return "学校"
	case "search":
		return "搜索"
	case "user":
		return "用户"
	case "utility":
		return "工具"
	default:
		return "接口"
	}
}

// UserID 从 gin context 读取 user_id，需 auth 中间件已注入。
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
