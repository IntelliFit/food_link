package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"food_link/backend/internal/feedback/domain"
	"food_link/backend/pkg/config"
)

const (
	defaultFeedbackBotProjectKey     = "foodlink"
	defaultFeedbackBotTimeoutSeconds = 5
	feedbackBotProductFeedbackPath   = "/api/product-feedback/upsert"
)

type FeedbackBotClient struct {
	baseURL      string
	authToken    string
	projectKey   string
	adminBaseURL string
	client       *http.Client
}

type feedbackBotUserFeedbackPayload struct {
	ProjectKey     string                      `json:"project_key"`
	ExternalID     string                      `json:"external_id"`
	Title          string                      `json:"title,omitempty"`
	Category       string                      `json:"category,omitempty"`
	Source         string                      `json:"source,omitempty"`
	Content        string                      `json:"content"`
	Status         string                      `json:"status,omitempty"`
	UserID         string                      `json:"user_id,omitempty"`
	Contact        string                      `json:"contact,omitempty"`
	PagePath       string                      `json:"page_path,omitempty"`
	AppVersion     string                      `json:"app_version,omitempty"`
	ClientInfo     map[string]any              `json:"client_info,omitempty"`
	RecentRequests []domain.RecentRequestTrace `json:"recent_requests,omitempty"`
	ImageURLs      []string                    `json:"image_urls,omitempty"`
	Extra          map[string]any              `json:"extra,omitempty"`
	AdminURL       string                      `json:"admin_url,omitempty"`
	CreatedAt      string                      `json:"created_at,omitempty"`
	Raw            map[string]any              `json:"raw,omitempty"`
}

func NewFeedbackBotClient(cfg config.FeedbackBotConfig, adminBaseURL string) *FeedbackBotClient {
	if !cfg.Enabled || strings.TrimSpace(cfg.BaseURL) == "" {
		return nil
	}
	timeoutSeconds := cfg.TimeoutSeconds
	if timeoutSeconds <= 0 {
		timeoutSeconds = defaultFeedbackBotTimeoutSeconds
	}
	projectKey := strings.TrimSpace(cfg.ProjectKey)
	if projectKey == "" {
		projectKey = defaultFeedbackBotProjectKey
	}
	return &FeedbackBotClient{
		baseURL:      strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/"),
		authToken:    strings.TrimSpace(cfg.AuthToken),
		projectKey:   projectKey,
		adminBaseURL: strings.TrimRight(strings.TrimSpace(adminBaseURL), "/"),
		client: &http.Client{
			Timeout: time.Duration(timeoutSeconds) * time.Second,
		},
	}
}

func (c *FeedbackBotClient) SyncUserFeedback(ctx context.Context, feedback *domain.UserFeedback) error {
	if c == nil || c.client == nil || strings.TrimSpace(c.baseURL) == "" {
		return fmt.Errorf("反馈机器人客户端未配置")
	}
	if feedback == nil {
		return nil
	}
	externalID := strings.TrimSpace(feedback.ID)
	if externalID == "" {
		return fmt.Errorf("feedback id is empty")
	}
	content := strings.TrimSpace(feedback.Content)
	if content == "" {
		return fmt.Errorf("feedback content is empty: feedback_id=%s", externalID)
	}
	body, err := json.Marshal(c.buildPayload(feedback))
	if err != nil {
		return fmt.Errorf("序列化反馈机器人请求失败: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+feedbackBotProductFeedbackPath, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("创建反馈机器人请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	if c.authToken != "" {
		req.Header.Set("X-Feedback-Bot-Token", c.authToken)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("请求反馈机器人失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("反馈机器人返回异常 status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(snippet)))
	}
	return nil
}

func (c *FeedbackBotClient) buildPayload(feedback *domain.UserFeedback) feedbackBotUserFeedbackPayload {
	payload := feedbackBotUserFeedbackPayload{
		ProjectKey:     c.projectKey,
		ExternalID:     strings.TrimSpace(feedback.ID),
		Title:          feedbackBotTitle(feedback),
		Category:       strings.TrimSpace(feedback.Category),
		Source:         strings.TrimSpace(feedback.Source),
		Content:        strings.TrimSpace(feedback.Content),
		Status:         strings.TrimSpace(feedback.Status),
		UserID:         strings.TrimSpace(feedback.UserID),
		Contact:        strings.TrimSpace(feedback.Contact),
		PagePath:       strings.TrimSpace(feedback.PagePath),
		AppVersion:     strings.TrimSpace(feedback.AppVersion),
		ClientInfo:     map[string]any(feedback.ClientInfo),
		RecentRequests: []domain.RecentRequestTrace(feedback.RecentRequests),
		ImageURLs:      []string(feedback.ImageURLs),
		Extra:          map[string]any(feedback.Extra),
		AdminURL:       feedbackBotAdminURL(c.adminBaseURL, feedback.ID),
		Raw: map[string]any{
			"submit_trace_id":   strings.TrimSpace(feedback.SubmitTraceID),
			"submit_request_id": strings.TrimSpace(feedback.SubmitRequestID),
			"submit_host_name":  strings.TrimSpace(feedback.SubmitHostName),
			"reward_credits":    feedback.RewardCredits,
		},
	}
	if feedback.CreatedAt != nil && !feedback.CreatedAt.IsZero() {
		payload.CreatedAt = feedback.CreatedAt.Format(time.RFC3339)
	}
	return payload
}

func feedbackBotTitle(feedback *domain.UserFeedback) string {
	if feedback == nil {
		return ""
	}
	content := strings.Join(strings.Fields(feedback.Content), " ")
	if content != "" {
		return truncateFeedbackBotTitle("["+feedbackSourceLabel(feedback.Source)+"] "+content, 60)
	}
	return feedbackSourceLabel(feedback.Source) + "反馈"
}

func truncateFeedbackBotTitle(value string, max int) string {
	if max <= 0 || utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max])
}

func feedbackBotAdminURL(baseURL, feedbackID string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	feedbackID = strings.TrimSpace(feedbackID)
	if baseURL == "" || feedbackID == "" {
		return ""
	}
	return baseURL + "/feedback?feedback_id=" + url.QueryEscape(feedbackID)
}
