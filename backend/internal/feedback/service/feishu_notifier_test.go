package service

import (
	"fmt"
	"strings"
	"testing"
	"time"

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

func TestBuildFeedbackNotifyCard(t *testing.T) {
	createdAt := time.Date(2026, 6, 13, 13, 52, 45, 0, time.FixedZone("CST", 8*60*60))
	card := buildFeedbackNotifyCard(&domain.UserFeedback{
		ID:         "fb-1",
		UserID:     "user-1",
		Category:   domain.CategoryBug,
		Content:    "测试111\n希望通知更好看",
		PagePath:   "/packageExtra/pages/feedback/index",
		AppVersion: "3.0.2",
		ClientInfo: datatypes.JSONMap{
			"platform":   "android",
			"system":     "Android 16",
			"model":      "V2366HA",
			"SDKVersion": "3.16.1",
		},
		RecentRequests: datatypes.JSONSlice[domain.RecentRequestTrace]{
			{
				Method:       "GET",
				Path:         "/api/expiry/dashboard",
				StatusCode:   0,
				ErrorMessage: "request:fail net::ERR_PROXY_CONNECTION_FAILED",
			},
		},
		SubmitTraceID:   "trace-1",
		SubmitRequestID: "req-1",
		SubmitHostName:  "foodlink-dev",
		CreatedAt:       &createdAt,
	})

	if got := fmt.Sprint(card["header"]); !strings.Contains(got, "意见反馈：问题/Bug") {
		t.Fatalf("expected card title, got=%s", got)
	}
	if got := fmt.Sprint(card["elements"]); !strings.Contains(got, "lark_md") ||
		!strings.Contains(got, "**反馈ID**：fb-1") ||
		!strings.Contains(got, "**最近失败请求**") ||
		!strings.Contains(got, "> 测试111") {
		t.Fatalf("expected markdown card content, got=%s", got)
	}
}
