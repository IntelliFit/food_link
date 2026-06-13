package service

import (
	"strings"
	"testing"

	"food_link/backend/internal/feedback/domain"

	"gorm.io/datatypes"
)

func TestBuildFeedbackNotifyText(t *testing.T) {
	text := buildFeedbackNotifyText(&domain.UserFeedback{
		ID:         "fb-1",
		UserID:     "user-1",
		Category:   domain.CategoryBug,
		Content:    "登录后首页一直转圈，无法加载今日饮食记录。",
		Contact:    "wx:test",
		PagePath:   "pages/index/index",
		AppVersion: "2.1.0",
		ClientInfo: datatypes.JSONMap{
			"platform": "ios",
			"model":    "iPhone 15",
		},
		RecentRequests: datatypes.JSONSlice[domain.RecentRequestTrace]{
			{
				Method:       "GET",
				Path:         "/api/home/dashboard",
				StatusCode:   500,
				ErrorMessage: "internal error",
			},
		},
		ImageURLs:       datatypes.JSONSlice[string]{"https://cdn.example.com/a.jpg"},
		SubmitTraceID:   "trace-1",
		SubmitRequestID: "req-1",
		SubmitHostName:  "api-1",
	})

	for _, want := range []string{
		"【意见反馈】",
		"反馈ID：fb-1",
		"分类：问题/Bug",
		"TraceID：trace-1",
		"最近失败请求：",
		"登录后首页一直转圈",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("expected text to contain %q, got:\n%s", want, text)
		}
	}
}
