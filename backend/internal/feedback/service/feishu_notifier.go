package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"
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
	card := buildFeedbackNotifyCard(feedback)
	if err := n.client.SendInteractiveCard(ctx, card); err != nil {
		return err
	}
	logger.Info(ctx, "意见反馈飞书通知已发送",
		slog.String("feedback_id", feedback.ID),
		slog.String("user_id", feedback.UserID),
	)
	return nil
}

func buildFeedbackNotifyCard(feedback *domain.UserFeedback) map[string]any {
	elements := []any{
		map[string]any{
			"tag": "div",
			"text": map[string]string{
				"tag":     "lark_md",
				"content": buildFeedbackSummaryMarkdown(feedback),
			},
		},
	}

	if failed := summarizeFailedRecentRequest(feedback.RecentRequests); failed != "" {
		elements = append(elements, map[string]any{
			"tag": "div",
			"text": map[string]string{
				"tag":     "lark_md",
				"content": "**最近失败请求**\n" + markdownQuote(failed),
			},
		})
	}

	elements = append(elements,
		map[string]any{"tag": "hr"},
		map[string]any{
			"tag": "div",
			"text": map[string]string{
				"tag":     "lark_md",
				"content": "**反馈内容**\n" + markdownQuote(truncateNotifyContent(feedback.Content)),
			},
		},
	)

	return map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
		},
		"header": map[string]any{
			"template": "orange",
			"title": map[string]string{
				"tag":     "plain_text",
				"content": fmt.Sprintf("意见反馈：%s", feedbackCategoryLabel(feedback.Category)),
			},
		},
		"elements": elements,
	}
}

func buildFeedbackSummaryMarkdown(feedback *domain.UserFeedback) string {
	lines := []string{
		markdownField("反馈ID", feedback.ID),
		markdownField("用户ID", feedback.UserID),
		markdownField("分类", feedbackCategoryLabel(feedback.Category)),
		markdownField("来源", feedbackSourceLabel(feedback.Source)),
		markdownField("页面", displayOrDash(feedback.PagePath)),
		markdownField("版本", displayOrDash(feedback.AppVersion)),
		markdownField("联系方式", displayOrDash(feedback.Contact)),
		markdownField("图片数", fmt.Sprint(len(feedback.ImageURLs))),
		markdownField("最近请求数", fmt.Sprint(len(feedback.RecentRequests))),
	}
	if createdAt := formatFeedbackCreatedAt(feedback.CreatedAt); createdAt != "" {
		lines = append(lines, markdownField("提交时间", createdAt))
	}
	if traceID := strings.TrimSpace(feedback.SubmitTraceID); traceID != "" {
		lines = append(lines, markdownField("TraceID", traceID))
	}
	if requestID := strings.TrimSpace(feedback.SubmitRequestID); requestID != "" {
		lines = append(lines, markdownField("RequestID", requestID))
	}
	if hostName := strings.TrimSpace(feedback.SubmitHostName); hostName != "" {
		lines = append(lines, markdownField("主机", hostName))
	}
	if summary := summarizeClientInfo(feedback.ClientInfo); summary != "" {
		lines = append(lines, markdownField("客户端", summary))
	}
	if extraSummary := summarizeExtra(feedback.Extra); extraSummary != "" {
		lines = append(lines, markdownField("关联信息", extraSummary))
	}
	return strings.Join(lines, "\n")
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

func markdownField(label, value string) string {
	return fmt.Sprintf("**%s**：%s", label, escapeLarkMarkdown(displayOrDash(value)))
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

func feedbackSourceLabel(source string) string {
	switch strings.TrimSpace(strings.ToLower(source)) {
	case domain.SourceCampusLocation:
		return "校园目录纠错"
	case domain.SourceCampusFood:
		return "校园菜品纠错"
	case domain.SourceFoodLibrary:
		return "公共食物库纠错"
	default:
		return "App 意见反馈"
	}
}

func summarizeExtra(extra map[string]any) string {
	if len(extra) == 0 {
		return ""
	}
	keys := []string{
		"school_name", "campus_name", "canteen_name", "floor", "window_name",
		"food_name", "item_id", "public_food_item_id", "library_item_id",
	}
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		value, ok := extra[key]
		if !ok {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" || text == "<nil>" {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s=%s", key, text))
	}
	return strings.Join(parts, "，")
}

func displayOrDash(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "-"
	}
	return value
}

func formatFeedbackCreatedAt(createdAt *time.Time) string {
	if createdAt == nil || createdAt.IsZero() {
		return ""
	}
	return createdAt.In(time.FixedZone("CST", 8*60*60)).Format("2006-01-02 15:04:05 UTC+8")
}

func markdownQuote(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "> -"
	}
	lines := strings.Split(escapeLarkMarkdown(value), "\n")
	for i, line := range lines {
		lines[i] = "> " + line
	}
	return strings.Join(lines, "\n")
}

func escapeLarkMarkdown(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "`", "\\`")
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
