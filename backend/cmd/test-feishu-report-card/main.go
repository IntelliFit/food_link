package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/feishu"
)

const maxContentRunes = 300

var reasonNames = map[string]string{
	"spam":    "垃圾广告",
	"porn":    "色情低俗",
	"illegal": "违法违规",
	"abuse":   "人身攻击",
	"other":   "其他",
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	cfg, err := config.Load(".")
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	webhookURL := cfg.Feishu.ReportWebhookURL
	secret := cfg.Feishu.ReportWebhookSecret
	if webhookURL == "" {
		log.Fatal("配置中 feishu.report_webhook_url 为空")
	}

	client := feishu.NewWebhookClient(webhookURL, secret)
	if !client.Enabled() {
		log.Fatal("飞书 webhook 客户端未启用")
	}

	reportID := os.Getenv("REPORT_ID")
	if reportID == "" {
		reportID = "test-report-001"
	}
	reason := os.Getenv("REPORT_REASON")
	if reason == "" {
		reason = "spam"
	}
	extra := os.Getenv("REPORT_EXTRA")
	if extra == "" {
		extra = "这条动态看起来像广告推广，请管理员复核。"
	}
	title := os.Getenv("REPORT_TARGET_TITLE")
	if title == "" {
		title = "模拟举报动态标题"
	}
	body := os.Getenv("REPORT_TARGET_BODY")
	if body == "" {
		body = "这是模拟的圈子动态正文内容，用于测试举报飞书卡片通知。"
	}
	imageURL := os.Getenv("REPORT_TARGET_IMAGE")
	if imageURL == "" {
		imageURL = "https://placehold.co/600x400?text=Test+Image"
	}

	card := buildDemoCard(reportID, reason, extra, title, body, imageURL)

	fmt.Printf("正在向飞书 webhook 发送模拟举报卡片...\n")
	if err := client.SendInteractiveCard(ctx, card); err != nil {
		log.Fatalf("发送失败: %v", err)
	}
	fmt.Println("模拟举报卡片已发送成功，请查看飞书群聊。")
}

func buildDemoCard(reportID, reason, extra, title, body, imageURL string) map[string]any {
	reasonName := reasonNames[reason]
	if reasonName == "" {
		reasonName = reason
	}

	elements := []any{
		divLarkMd(fmt.Sprintf("**举报原因**\n%s", markdownQuote(reasonName))),
		divLarkMd(fmt.Sprintf("**举报人 ID**\n`test-reporter-user-id`")),
		divLarkMd(fmt.Sprintf("**被举报人 ID**\n`test-reported-user-id`")),
		divLarkMd(fmt.Sprintf("**动态 ID**\n`test-target-id`")),
		divLarkMd(fmt.Sprintf("**举报记录 ID**\n`%s`", reportID)),
	}
	if strings.TrimSpace(extra) != "" {
		elements = append(elements, divLarkMd(fmt.Sprintf("**补充说明**\n%s", markdownQuote(truncate(extra)))))
	}

	contentSummary := fmt.Sprintf("**标题：** %s\n**正文：** %s", truncate(title), truncate(body))
	elements = append(elements,
		map[string]any{"tag": "hr"},
		divLarkMd(fmt.Sprintf("**动态内容摘要**\n%s", markdownQuote(contentSummary))),
	)

	if imageURL != "" {
		elements = append(elements,
			map[string]any{"tag": "hr"},
			divLarkMd(fmt.Sprintf("**首图预览**\n![图片](%s)", imageURL)),
		)
	}

	return map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
			"enable_forward":   true,
		},
		"header": map[string]any{
			"title": map[string]any{
				"tag":     "plain_text",
				"content": "圈子动态举报（测试）",
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

func truncate(s string) string {
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) <= maxContentRunes {
		return s
	}
	return string(runes[:maxContentRunes]) + "…"
}

func markdownQuote(s string) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		lines[i] = "> " + line
	}
	return strings.Join(lines, "\n")
}
