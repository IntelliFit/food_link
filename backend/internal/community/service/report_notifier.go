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
	client         *feishu.WebhookClient
	imageUploader  *feishu.ImageUploader
	adminBaseURL   string
}

func NewReportNotifier(webhookURL, secret, adminBaseURL, appID, appSecret string) *FeishuReportNotifier {
	client := feishu.NewWebhookClient(webhookURL, secret)
	if !client.Enabled() {
		return nil
	}
	return &FeishuReportNotifier{
		client:        client,
		imageUploader: feishu.NewImageUploader(appID, appSecret),
		adminBaseURL:  strings.TrimRight(adminBaseURL, "/"),
	}
}

func (n *FeishuReportNotifier) NotifyFeedReport(ctx context.Context, report *domain.FeedReport, target *repo.FeedRecord, reporterNickname, reportedNickname, previewImageURL string) error {
	if n == nil || n.client == nil || report == nil {
		return nil
	}
	imageKey, uploadErr := n.resolvePreviewImageKey(ctx, previewImageURL)
	card := buildFeedReportCard(report, target, reporterNickname, reportedNickname, previewImageURL, imageKey, n.adminBaseURL)
	if err := n.client.SendInteractiveCard(ctx, card); err != nil {
		return err
	}
	logger.Info(ctx, "圈子动态举报飞书通知已发送",
		slog.String("report_id", report.ID),
		slog.String("reporter_user_id", report.ReporterUserID),
		slog.String("reported_user_id", report.ReportedUserID),
		slog.String("target_id", report.TargetID),
		slog.String("preview_image_url", previewImageURL),
		slog.String("preview_image_key", imageKey),
	)
	if uploadErr != nil {
		logger.Warn(ctx, "举报首图上传飞书失败，卡片中已降级为链接",
			slog.String("report_id", report.ID),
			slog.String("preview_image_url", previewImageURL),
			slog.Any("error", uploadErr),
		)
	}
	return nil
}

func (n *FeishuReportNotifier) resolvePreviewImageKey(ctx context.Context, previewImageURL string) (string, error) {
	if previewImageURL == "" || n.imageUploader == nil || !n.imageUploader.Enabled() {
		return "", nil
	}
	// 如果已经是飞书 image_key 或飞书 CDN URL，直接复用
	if key := feishu.ParseFeishuImageURL(previewImageURL); key != "" {
		return key, nil
	}
	return n.imageUploader.UploadImageFromURL(ctx, previewImageURL)
}

func buildFeedReportCard(report *domain.FeedReport, target *repo.FeedRecord, reporterNickname, reportedNickname, previewImageURL, imageKey, adminBaseURL string) map[string]any {
	reasonName := reportReasonNames[report.Reason]
	if reasonName == "" {
		reasonName = report.Reason
	}
	contentSummary := summarizeReportTarget(target)

	elements := []any{
		divLarkMd(fmt.Sprintf("**举报原因**：%s", reasonName)),
		divLarkMd(fmt.Sprintf("**举报人**：%s `%s`", reporterNickname, report.ReporterUserID)),
		divLarkMd(fmt.Sprintf("**被举报人**：%s `%s`", reportedNickname, report.ReportedUserID)),
		divLarkMd(fmt.Sprintf("**动态 ID**：`%s`", report.TargetID)),
	}
	if strings.TrimSpace(report.ExtraContent) != "" {
		elements = append(elements, divLarkMd(fmt.Sprintf("**补充说明**：%s", truncateReportContent(report.ExtraContent))))
	}
	if contentSummary != "" {
		elements = append(elements, map[string]any{"tag": "hr"}, divLarkMd(fmt.Sprintf("**动态内容摘要**：%s", contentSummary)))
	}
	if previewImageURL != "" {
		imageElements := []any{map[string]any{"tag": "hr"}, divLarkMd("**首图预览**")}
		if imageKey != "" {
			imageElements = append(imageElements, imgElement("首图预览", imageKey))
		} else {
			imageElements = append(imageElements, divLarkMd(fmt.Sprintf("[查看首图](%s)", previewImageURL)))
		}
		elements = append(elements, imageElements...)
	}
	if adminURL := buildReportAdminURL(adminBaseURL, report.ID); adminURL != "" {
		elements = append(elements, map[string]any{"tag": "hr"}, actionButtons(adminURL, report))
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

func imgElement(alt, imageKey string) map[string]any {
	return map[string]any{
		"tag": "img",
		"alt": map[string]any{
			"tag":     "plain_text",
			"content": alt,
		},
		"img_key": imageKey,
	}
}

func buildReportAdminURL(baseURL, reportID string) string {
	if baseURL == "" || reportID == "" {
		return ""
	}
	return baseURL + "/feed-reports/" + reportID
}

func actionButtons(adminURL string, report *domain.FeedReport) map[string]any {
	return map[string]any{
		"tag": "action",
		"actions": []any{
			map[string]any{
				"tag": "button",
				"text": map[string]any{
					"tag":     "plain_text",
					"content": "去处理",
				},
				"type": "primary",
				"url":  adminURL,
			},
			map[string]any{
				"tag": "button",
				"text": map[string]any{
					"tag":     "plain_text",
					"content": "复制举报人ID",
				},
				"type": "default",
				"url":  adminURL + "?copy=reporter",
			},
			map[string]any{
				"tag": "button",
				"text": map[string]any{
					"tag":     "plain_text",
					"content": "复制被举报人ID",
				},
				"type": "default",
				"url":  adminURL + "?copy=reported",
			},
			map[string]any{
				"tag": "button",
				"text": map[string]any{
					"tag":     "plain_text",
					"content": "复制动态ID",
				},
				"type": "default",
				"url":  adminURL + "?copy=target",
			},
		},
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
