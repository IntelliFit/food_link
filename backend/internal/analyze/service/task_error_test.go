package service

import (
	"strings"
	"testing"
)

func TestSanitizeAIUpstreamErrorMessage(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		want   string
		forbid string
	}{
		{
			name:   "incomplete food analysis hides parser fields",
			input:  "parse llm json failed: 文字食物分析缺少有效calories",
			want:   "本次食物分析结果不完整，请重试或修改食物描述",
			forbid: "calories",
		},
		{
			name:   "model not found",
			input:  "doubao api error 400: model not found",
			want:   "AI 识别服务配置异常，请联系管理员处理",
			forbid: "doubao",
		},
		{
			name:   "generic upstream api error",
			input:  "ofoxai api error 400: invalid request",
			want:   "AI 识别服务暂时不可用，请稍后重试",
			forbid: "ofoxai",
		},
		{
			name:   "empty food result after fallback hides model names",
			input:  "食物识别未返回有效食物，请重试；千问备用模型仍未返回有效结果：食物识别未返回有效食物，请重试",
			want:   "没有识别到食物，请上传清晰的食物照片或补充文字描述后重试",
			forbid: "千问",
		},
		{
			name:   "single empty food result",
			input:  "食物识别未返回有效食物，请重试",
			want:   "没有识别到食物，请上传清晰的食物照片或补充文字描述后重试",
			forbid: "",
		},
		{
			name:   "provider channel failure hides vendor",
			input:  "Gemini 所有可用渠道均失败: context canceled",
			want:   "AI 识别服务暂时不可用，请稍后重试",
			forbid: "gemini",
		},
		{
			name:   "client config error hides vendor",
			input:  "文字输入模式使用千问时，请配置 DASHSCOPE_API_KEY",
			want:   "AI 识别服务暂时不可用，请稍后重试",
			forbid: "dashscope",
		},
		{
			name:  "friendly business error is preserved",
			input: "图片不够清晰，请重新拍摄",
			want:  "图片不够清晰，请重新拍摄",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SanitizeAIUpstreamErrorMessage(tt.input)
			if got != tt.want {
				t.Fatalf("unexpected sanitized message: got %q want %q", got, tt.want)
			}
			if tt.forbid != "" && strings.Contains(strings.ToLower(got), tt.forbid) {
				t.Fatalf("raw provider detail leaked: %q", got)
			}
		})
	}
}
