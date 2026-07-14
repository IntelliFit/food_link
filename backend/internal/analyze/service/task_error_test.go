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
