package service

import "strings"

// SanitizeAIUpstreamErrorMessage prevents provider internals from reaching API clients.
func SanitizeAIUpstreamErrorMessage(message string) string {
	message = strings.TrimSpace(message)
	lower := strings.ToLower(message)
	if strings.Contains(lower, "parse llm json failed") {
		return "本次食物分析结果不完整，请重试或修改食物描述"
	}
	if strings.Contains(message, "未返回有效食物") {
		return emptyFoodResultUserMessage
	}
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
	if containsInternalProviderDetail(lower) {
		return "AI 识别服务暂时不可用，请稍后重试"
	}
	return message
}

const emptyFoodResultUserMessage = "没有识别到食物，请上传清晰的食物照片或补充文字描述后重试"

// internalProviderMarkers are vendor, model and routing terms that must never
// reach users; any message containing one is replaced with a generic notice.
var internalProviderMarkers = []string{
	"gemini", "qwen", "千问", "dashscope", "doubao", "豆包", "deepseek",
	"openlux", "万界", "ofox", "yunwu", "渠道", "备用模型", "主模型", "大模型",
}

func containsInternalProviderDetail(lower string) bool {
	for _, marker := range internalProviderMarkers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}
