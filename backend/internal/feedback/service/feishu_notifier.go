package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"unicode/utf8"

	"food_link/backend/internal/feedback/domain"
	"food_link/backend/pkg/feishu"
	"food_link/backend/pkg/logger"
)

const maxNotifyContentRunes = 300

// FeishuNotifier pushes new feedback events to a Feishu custom bot webhook.
type FeishuNotifier struct {
	client *feishu.WebhookClient
}

// NewFeishuNotifier creates a notifier. When webhookURL is empty it returns nil.
func NewFeishuNotifier(webhookURL, secret string) *FeishuNotifier {
	client := feishu.NewWebhookClient(webhookURL, secret)
	if !client.Enabled() {
		return nil
	}
	return &FeishuNotifier{client: client}
}

// NotifyNewFeedback sends a summary message for a newly created feedback record.
func (n *FeishuNotifier) NotifyNewFeedback(ctx context.Context, feedback *domain.UserFeedback) error {
	if n == nil || n.client == nil || feedback == nil {
		return nil
	}
	text := buildFeedbackNotifyText(feedback)
	if err := n.client.SendText(ctx, text); err != nil {
		return err
	}
	logger.Info(ctx, "意见反馈飞书通知已发送",
		slog.String("feedback_id", feedback.ID),
		slog.String("user_id", feedback.UserID),
	)
	return nil
}

func buildFeedbackNotifyText(feedback *domain.UserFeedback) string {
	lines := []string{
		"【意见反馈】收到新的用户反馈",
		fmt.Sprintf("反馈ID：%s", feedback.ID),
		fmt.Sprintf("用户ID：%s", feedback.UserID),
		fmt.Sprintf("分类：%s", feedbackCategoryLabel(feedback.Category)),
		fmt.Sprintf("页面：%s", displayOrDash(feedback.PagePath)),
		fmt.Sprintf("版本：%s", displayOrDash(feedback.AppVersion)),
		fmt.Sprintf("联系方式：%s", displayOrDash(feedback.Contact)),
		fmt.Sprintf("图片数：%d", len(feedback.ImageURLs)),
		fmt.Sprintf("最近请求数：%d", len(feedback.RecentRequests)),
	}
	if traceID := strings.TrimSpace(feedback.SubmitTraceID); traceID != "" {
		lines = append(lines, fmt.Sprintf("TraceID：%s", traceID))
	}
	if requestID := strings.TrimSpace(feedback.SubmitRequestID); requestID != "" {
		lines = append(lines, fmt.Sprintf("RequestID：%s", requestID))
	}
	if hostName := strings.TrimSpace(feedback.SubmitHostName); hostName != "" {
		lines = append(lines, fmt.Sprintf("主机：%s", hostName))
	}
	if summary := summarizeClientInfo(feedback.ClientInfo); summary != "" {
		lines = append(lines, fmt.Sprintf("客户端：%s", summary))
	}
	if failed := summarizeFailedRecentRequest(feedback.RecentRequests); failed != "" {
		lines = append(lines, fmt.Sprintf("最近失败请求：%s", failed))
	}
	lines = append(lines, fmt.Sprintf("内容：%s", truncateNotifyContent(feedback.Content)))
	return strings.Join(lines, "\n")
}

func feedbackCategoryLabel(category string) string {
	switch strings.TrimSpace(strings.ToLower(category)) {
	case domain.CategoryBug:
		return "问题/Bug"
	case domain.CategorySuggestion:
		return "功能建议"
	case domain.CategoryExperience:
		return "体验反馈"
	default:
		return "其他"
	}
}

func displayOrDash(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "-"
	}
	return value
}

func truncateNotifyContent(content string) string {
	content = strings.TrimSpace(content)
	if utf8.RuneCountInString(content) <= maxNotifyContentRunes {
		return content
	}
	runes := []rune(content)
	return string(runes[:maxNotifyContentRunes]) + "..."
}

func summarizeClientInfo(info map[string]any) string {
	if len(info) == 0 {
		return ""
	}
	parts := make([]string, 0, 4)
	for _, key := range []string{"platform", "system", "model", "version", "SDKVersion", "brand"} {
		value, ok := info[key]
		if !ok {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s=%s", key, text))
	}
	return strings.Join(parts, "，")
}

func summarizeFailedRecentRequest(items []domain.RecentRequestTrace) string {
	for i := len(items) - 1; i >= 0; i-- {
		item := items[i]
		if item.StatusCode < 400 && strings.TrimSpace(item.ErrorMessage) == "" {
			continue
		}
		parts := []string{
			fmt.Sprintf("%s %s", strings.ToUpper(strings.TrimSpace(item.Method)), strings.TrimSpace(item.Path)),
			fmt.Sprintf("status=%d", item.StatusCode),
		}
		if msg := strings.TrimSpace(item.ErrorMessage); msg != "" {
			parts = append(parts, "err="+truncateNotifyContent(msg))
		}
		return strings.Join(parts, " ")
	}
	return ""
}
