package service

import "strings"

// SanitizeAIUpstreamErrorMessage prevents provider internals from reaching API clients.
func SanitizeAIUpstreamErrorMessage(message string) string {
	message = strings.TrimSpace(message)
	lower := strings.ToLower(message)
	if strings.Contains(lower, "model not found") ||
		strings.Contains(lower, "model_not_found") ||
		strings.Contains(lower, "unknown model") {
		return "AI 识别服务配置异常，请联系管理员处理"
	}
	if strings.Contains(lower, "api error") ||
		strings.Contains(lower, "/chat/completions") ||
		strings.Contains(lower, ":generatecontent") ||
		strings.Contains(lower, "maas-openapi.wanjiedata.com") {
		return "AI 识别服务暂时不可用，请稍后重试"
	}
	return message
}
