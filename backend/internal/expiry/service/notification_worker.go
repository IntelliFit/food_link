package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"food_link/backend/internal/expiry/domain"
	"food_link/backend/internal/expiry/repo"
	"food_link/backend/pkg/config"
)

var expiryNotificationRetryDelays = []time.Duration{5 * time.Minute, 30 * time.Minute, 120 * time.Minute}

type NotificationWorker struct {
	repo   *repo.ExpiryRepo
	cfg    *config.Config
	client *http.Client

	token       string
	tokenExpiry time.Time
}

func NewNotificationWorker(expiryRepo *repo.ExpiryRepo, cfg *config.Config) *NotificationWorker {
	return &NotificationWorker{
		repo:   expiryRepo,
		cfg:    cfg,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (w *NotificationWorker) ProcessNext(ctx context.Context) (bool, error) {
	job, err := w.repo.ClaimNextPendingNotificationJob(ctx)
	if err != nil {
		return false, err
	}
	if job == nil {
		return false, nil
	}
	return true, w.ProcessJob(ctx, job)
}

func (w *NotificationWorker) RecoverStaleProcessingJobs(ctx context.Context, staleAfter time.Duration) (int64, error) {
	if w == nil || w.repo == nil {
		return 0, nil
	}
	return w.repo.RecoverStaleNotificationJobs(ctx, staleAfter)
}

func (w *NotificationWorker) ProcessJob(ctx context.Context, job *domain.ExpiryNotificationJob) error {
	item, err := w.repo.GetByID(ctx, job.ExpiryItemID)
	if err != nil {
		return err
	}
	if item == nil {
		_, err = w.repo.UpdateNotificationJob(ctx, job.ID, map[string]any{
			"status":     "cancelled",
			"last_error": "关联保质期条目不存在",
		})
		return err
	}
	if item.Status != "active" {
		_, err = w.repo.UpdateNotificationJob(ctx, job.ID, map[string]any{
			"status":     "cancelled",
			"last_error": "条目已不处于保鲜中",
		})
		return err
	}
	scheduledLocal := buildNotificationSchedule(item)
	if scheduledLocal == nil {
		_, err = w.repo.UpdateNotificationJob(ctx, job.ID, map[string]any{
			"status":     "cancelled",
			"last_error": "条目已过期或截止日期无效",
		})
		return err
	}
	china := time.FixedZone("Asia/Shanghai", 8*60*60)
	if notificationScheduleChangedAfterJobDue(job.ScheduledAt, item, scheduledLocal, time.Now().In(china)) {
		_, err = w.repo.UpdateNotificationJob(ctx, job.ID, map[string]any{
			"status":     "cancelled",
			"last_error": "条目提醒时间已变化，旧任务作废",
		})
		return err
	}

	wxResult, err := w.sendSubscribeMessage(ctx, job, item)
	if err == nil {
		snapshot := copyMap(job.PayloadSnapshot)
		snapshot["wx_result"] = wxResult
		_, updateErr := w.repo.UpdateNotificationJob(ctx, job.ID, map[string]any{
			"status":           "sent",
			"sent_at":          time.Now().UTC(),
			"last_error":       nil,
			"payload_snapshot": snapshot,
		})
		return updateErr
	}
	return w.retryOrFail(ctx, job, err)
}

func notificationScheduleChangedAfterJobDue(jobScheduledAt time.Time, item *domain.ExpiryItem, scheduledLocal *time.Time, nowLocal time.Time) bool {
	if item == nil || scheduledLocal == nil {
		return false
	}
	expireDate := item.ExpireDate.In(nowLocal.Location())
	expireDay := time.Date(expireDate.Year(), expireDate.Month(), expireDate.Day(), 0, 0, 0, 0, nowLocal.Location())
	today := time.Date(nowLocal.Year(), nowLocal.Month(), nowLocal.Day(), 0, 0, 0, 0, nowLocal.Location())
	if expireDay.Equal(today) {
		return false
	}
	return scheduledLocal.UTC().After(jobScheduledAt) && scheduledLocal.After(nowLocal)
}

func (w *NotificationWorker) sendSubscribeMessage(ctx context.Context, job *domain.ExpiryNotificationJob, item *domain.ExpiryItem) (map[string]any, error) {
	token, err := w.getAccessToken(ctx)
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"touser":            job.OpenID,
		"template_id":       job.TemplateID,
		"page":              notificationPage(job.PayloadSnapshot),
		"data":              notificationTemplateData(job.PayloadSnapshot, item),
		"miniprogram_state": "formal",
		"lang":              "zh_CN",
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token="+token, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("微信通知发送失败: HTTP %d", resp.StatusCode)
	}
	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, err
	}
	if code, ok := numberAsInt(result["errcode"]); ok && code != 0 {
		msg := strings.TrimSpace(fmt.Sprintf("%v", result["errmsg"]))
		if msg == "" || msg == "<nil>" {
			msg = fmt.Sprintf("%d", code)
		}
		return nil, fmt.Errorf("微信通知发送失败: %s", msg)
	}
	return result, nil
}

func (w *NotificationWorker) retryOrFail(ctx context.Context, job *domain.ExpiryNotificationJob, sendErr error) error {
	retryCount := job.RetryCount + 1
	maxRetry := job.MaxRetryCount
	if maxRetry <= 0 {
		maxRetry = len(expiryNotificationRetryDelays)
	}
	msg := truncateRunes(sendErr.Error(), 500)
	if retryCount >= maxRetry {
		_, err := w.repo.UpdateNotificationJob(ctx, job.ID, map[string]any{
			"status":      "failed",
			"retry_count": retryCount,
			"last_error":  msg,
		})
		if err != nil {
			return err
		}
		return sendErr
	}
	delayIndex := retryCount - 1
	if delayIndex >= len(expiryNotificationRetryDelays) {
		delayIndex = len(expiryNotificationRetryDelays) - 1
	}
	_, err := w.repo.UpdateNotificationJob(ctx, job.ID, map[string]any{
		"status":       "pending",
		"retry_count":  retryCount,
		"scheduled_at": time.Now().UTC().Add(expiryNotificationRetryDelays[delayIndex]),
		"last_error":   msg,
	})
	if err != nil {
		return err
	}
	return sendErr
}

func (w *NotificationWorker) getAccessToken(ctx context.Context) (string, error) {
	if w.token != "" && time.Now().Before(w.tokenExpiry) {
		return w.token, nil
	}
	appID := strings.TrimSpace(w.cfg.WechatMiniProgramAppID())
	secret := strings.TrimSpace(w.cfg.WechatMiniProgramAppSecret())
	if appID == "" || secret == "" {
		return "", fmt.Errorf("缺少 APPID 或 SECRET 环境变量")
	}
	stableBody, _ := json.Marshal(map[string]any{
		"grant_type":    "client_credential",
		"appid":         appID,
		"secret":        secret,
		"force_refresh": false,
	})
	stableReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.weixin.qq.com/cgi-bin/stable_token", bytes.NewReader(stableBody))
	if err != nil {
		return "", err
	}
	stableReq.Header.Set("Content-Type", "application/json")
	if token, ok := w.fetchToken(stableReq); ok {
		return token, nil
	}

	url := fmt.Sprintf("https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=%s&secret=%s", appID, secret)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	token, ok := w.fetchToken(req)
	if !ok {
		return "", fmt.Errorf("获取 access_token 失败")
	}
	return token, nil
}

func (w *NotificationWorker) fetchToken(req *http.Request) (string, bool) {
	resp, err := w.client.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", false
	}
	var data map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", false
	}
	if code, ok := numberAsInt(data["errcode"]); ok && code != 0 {
		return "", false
	}
	token := strings.TrimSpace(fmt.Sprintf("%v", data["access_token"]))
	if token == "" || token == "<nil>" {
		return "", false
	}
	w.token = token
	w.tokenExpiry = time.Now().Add(90 * time.Minute)
	return token, true
}

func notificationPage(snapshot map[string]any) string {
	page := stringFromMapValue(snapshot["page"])
	if page == "" {
		return "/pages/expiry/index"
	}
	return page
}

func notificationTemplateData(_ map[string]any, item *domain.ExpiryItem) map[string]any {
	// 模板字段由微信公共模板固定定义。发送时始终按当前条目重建，避免旧任务快照
	// 中的历史字段（thing1/time2/character_string5）污染新模板并触发参数错误。
	return buildNotificationPayload(item)
}

func copyMap(in map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range in {
		out[key] = value
	}
	return out
}

func numberAsInt(value any) (int, bool) {
	switch v := value.(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	case json.Number:
		i, err := v.Int64()
		return int(i), err == nil
	default:
		return 0, false
	}
}

func stringFromMapValue(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprintf("%v", value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
