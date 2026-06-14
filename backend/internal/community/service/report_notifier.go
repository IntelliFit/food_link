package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"food_link/backend/internal/community/domain"
	"food_link/backend/internal/community/repo"
	"food_link/backend/pkg/feishu"
	"food_link/backend/pkg/logger"
)

const maxReportContentRunes = 300

var reportReasonNames = map[string]string{
	"spam":    "垃圾广告",
	"porn":    "色情低俗",
	"illegal": "违法违规",
	"abuse":   "人身攻击",
	"other":   "其他",
}

type FeishuReportNotifier struct {
	client *feishu.WebhookClient
}

func NewReportNotifier(webhookURL, secret string) *FeishuReportNotifier {
	client := feishu.NewWebhookClient(webhookURL, secret)
	if !client.Enabled() {
		return nil
	}
	return &FeishuReportNotifier{client: client}
}

func (n *FeishuReportNotifier) NotifyFeedReport(ctx context.Context, report *domain.FeedReport, target *repo.FeedRecord) error {
	if n == nil || n.client == nil || report == nil {
		return nil
	}
	card := buildFeedReportCard(report, target)
	if err := n.client.SendInteractiveCard(ctx, card); err != nil {
		return err
	}
	logger.Info(ctx, "圈子动态举报飞书通知已发送",
		slog.String("report_id", report.ID),
		slog.String("reporter_user_id", report.ReporterUserID),
		slog.String("reported_user_id", report.ReportedUserID),
		slog.String("target_id", report.TargetID),
	)
	return nil
}

func buildFeedReportCard(report *domain.FeedReport, target *repo.FeedRecord) map[string]any {
	reasonName := reportReasonNames[report.Reason]
	if reasonName == "" {
		reasonName = report.Reason
	}
	contentSummary := summarizeReportTarget(target)
	imageMarkdown := ""
	if target != nil && len(target.ImagePaths) > 0 {
		imageMarkdown = fmt.Sprintf("**首图预览**\n![图片](%s)", target.ImagePaths[0])
	}

	elements := []any{
		divLarkMd(fmt.Sprintf("**举报原因**\n%s", markdownQuote(reasonName))),
		divLarkMd(fmt.Sprintf("**举报人 ID**\n`%s`", report.ReporterUserID)),
		divLarkMd(fmt.Sprintf("**被举报人 ID**\n`%s`", report.ReportedUserID)),
		divLarkMd(fmt.Sprintf("**动态 ID**\n`%s`", report.TargetID)),
	}
	if strings.TrimSpace(report.ExtraContent) != "" {
		elements = append(elements, divLarkMd(fmt.Sprintf("**补充说明**\n%s", markdownQuote(truncateReportContent(report.ExtraContent)))))
	}
	if contentSummary != "" {
		elements = append(elements, map[string]any{"tag": "hr"}, divLarkMd(fmt.Sprintf("**动态内容摘要**\n%s", markdownQuote(contentSummary))))
	}
	if imageMarkdown != "" {
		elements = append(elements, map[string]any{"tag": "hr"}, divLarkMd(imageMarkdown))
	}

	return map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
			"enable_forward":   true,
		},
		"header": map[string]any{
			"title": map[string]any{
				"tag":     "plain_text",
				"content": "圈子动态举报",
			},
			"template": "red",
		},
		"elements": elements,
	}
}

func divLarkMd(content string) map[string]any {
	return map[string]any{
		"tag": "div",
		"text": map[string]any{
			"tag":     "lark_md",
			"content": content,
		},
	}
}

func summarizeReportTarget(target *repo.FeedRecord) string {
	if target == nil {
		return ""
	}
	parts := []string{}
	if target.Title != nil && strings.TrimSpace(*target.Title) != "" {
		parts = append(parts, "**标题：** "+truncateReportContent(*target.Title))
	}
	if target.Body != nil && strings.TrimSpace(*target.Body) != "" {
		parts = append(parts, "**正文：** "+truncateReportContent(*target.Body))
	}
	if target.Description != nil && strings.TrimSpace(*target.Description) != "" {
		parts = append(parts, "**描述：** "+truncateReportContent(*target.Description))
	}
	if len(parts) == 0 {
		return "（仅图片/无文字内容）"
	}
	return strings.Join(parts, "\n")
}

func truncateReportContent(s string) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) <= maxReportContentRunes {
		return s
	}
	return string([]rune(s)[:maxReportContentRunes]) + "…"
}

func markdownQuote(s string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = "> " + line
	}
	return strings.Join(lines, "\n")
}
