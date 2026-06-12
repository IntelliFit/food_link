package logger

import (
	"context"
	"log/slog"
	"strings"
	"unicode/utf8"
)

const defaultLogTextLimit = 500

// UserID 记录用户 ID。
func UserID(userID string) slog.Attr {
	return slog.String("user_id", strings.TrimSpace(userID))
}

// TaskType 记录分析任务类型。
func TaskType(taskType string) slog.Attr {
	return slog.String("task_type", strings.TrimSpace(taskType))
}

// Stage 记录业务流程阶段，便于按阶段过滤日志。
func Stage(stage string) slog.Attr {
	return slog.String("stage", strings.TrimSpace(stage))
}

// ProviderModel 记录 LLM 提供商与模型。
func ProviderModel(provider, model string) slog.Attr {
	return slog.Group("llm",
		slog.String("provider", strings.TrimSpace(provider)),
		slog.String("model", strings.TrimSpace(model)),
	)
}

// Truncated 截断长文本，避免日志过大或泄露 prompt 全文。
func Truncated(name, value string, limit int) slog.Attr {
	if limit <= 0 {
		limit = defaultLogTextLimit
	}
	value = strings.TrimSpace(value)
	if value == "" {
		return slog.String(name, "")
	}
	if utf8.RuneCountInString(value) <= limit {
		return slog.String(name, value)
	}
	return slog.String(name, truncateRunes(value, limit)+"...")
}

// LLMResponseSummary 记录 LLM 原始响应摘要（截断）。
func LLMResponseSummary(raw string) slog.Attr {
	return Truncated("llm_response_preview", raw, defaultLogTextLimit)
}

// APIAction 记录 HTTP handler 业务动作。
func APIAction(module, action string) slog.Attr {
	return slog.Group("api",
		slog.String("module", strings.TrimSpace(module)),
		slog.String("action", strings.TrimSpace(action)),
	)
}

// LogAPI 记录 API 层业务日志（带 trace）。
func LogAPI(ctx context.Context, msg, module, action string, attrs ...slog.Attr) {
	base := []slog.Attr{APIAction(module, action)}
	Info(ctx, msg, append(base, attrs...)...)
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	count := 0
	for index := range value {
		if count == limit {
			return value[:index]
		}
		count++
	}
	return value
}
