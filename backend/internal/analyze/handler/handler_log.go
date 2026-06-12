package handler

import (
	"strings"

	"food_link/backend/internal/analyze/service"
	"food_link/backend/internal/common/handlerlog"

	"github.com/gin-gonic/gin"
	"log/slog"
)

func logAnalyzeAPI(c *gin.Context, action string, attrs ...slog.Attr) {
	handlerlog.Log(c, "analyze", action, "分析接口", attrs...)
}

func logAnalyzeAPIError(c *gin.Context, action string, err error, attrs ...slog.Attr) {
	handlerlog.LogError(c, "analyze", action, err, attrs...)
}

func imageCountForSubmitLog(input service.SubmitTaskInput) int {
	if len(input.ImageURLs) > 0 {
		return len(input.ImageURLs)
	}
	if strings.TrimSpace(input.ImageURL) != "" {
		return 1
	}
	return 0
}

func stringFromSubmitExecutionMode(input service.SubmitTaskInput) string {
	if input.ExecutionMode == nil {
		return ""
	}
	return strings.TrimSpace(*input.ExecutionMode)
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func analyzeItemCount(data map[string]any) int {
	if data == nil {
		return 0
	}
	raw, ok := data["items"].([]any)
	if !ok {
		return 0
	}
	return len(raw)
}

func analyzeExecutionMode(mode *string) string {
	if mode == nil {
		return ""
	}
	return strings.TrimSpace(*mode)
}
