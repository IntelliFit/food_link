package service

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	migrationdo "food_link/backend/internal/migration/do"
	"food_link/backend/internal/push/domain"
	"food_link/backend/internal/push/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
)

type Service struct {
	repo   *repo.Repository
	expo   *ExpoClient
	config config.PushConfig
}

func New(r *repo.Repository, cfg config.PushConfig) *Service {
	return &Service{repo: r, expo: NewExpoClient(cfg.ExpoAccessToken), config: cfg}
}

type SettingsResult struct {
	Preferences   domain.Preferences `json:"preferences"`
	PushAvailable bool               `json:"push_available"`
}

func invalid(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: http.StatusBadRequest}
}
func (s *Service) storageError(ctx context.Context, action, userID string) error {
	// PostgreSQL uniqueness errors can contain the token value, so do not log raw DB errors.
	logger.Error(ctx, "提醒存储操作失败", fmt.Errorf("推送存储不可用"), slog.String("action", action), slog.String("user_id", userID))
	return commonerrors.ErrInternal
}
func (s *Service) Settings(ctx context.Context, userID string) (SettingsResult, error) {
	p, err := s.repo.GetPreferences(ctx, userID)
	if err != nil {
		return SettingsResult{}, s.storageError(ctx, "read_preferences", userID)
	}
	return SettingsResult{Preferences: p.Preferences, PushAvailable: s.config.Enabled}, nil
}
func (s *Service) SaveSettings(ctx context.Context, userID string, p domain.Preferences) (SettingsResult, error) {
	if err := p.Validate(); err != nil {
		logger.Warn(ctx, "提醒偏好校验失败", slog.String("user_id", userID))
		return SettingsResult{}, invalid(err.Error())
	}
	if p.Enabled && !s.config.Enabled {
		logger.Warn(ctx, "提醒服务未启用，拒绝开启偏好", slog.String("user_id", userID))
		return SettingsResult{}, &commonerrors.AppError{Code: 10005, Message: "消息提醒服务尚未启用", HTTPStatus: http.StatusServiceUnavailable}
	}
	if err := s.repo.SavePreferences(ctx, userID, p); err != nil {
		return SettingsResult{}, s.storageError(ctx, "save_preferences", userID)
	}
	logger.Info(ctx, "提醒偏好已更新", slog.String("user_id", userID), slog.Bool("enabled", p.Enabled))
	return SettingsResult{Preferences: p, PushAvailable: s.config.Enabled}, nil
}

type RegisterInput struct {
	Token     string `json:"token"`
	ProjectID string `json:"project_id"`
	Platform  string `json:"platform"`
}

var installationPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)
var tokenPattern = regexp.MustCompile(`^(?:ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{10,200}\]$`)

func (s *Service) Register(ctx context.Context, userID, id string, input RegisterInput) error {
	if !installationPattern.MatchString(id) || !tokenPattern.MatchString(input.Token) {
		logger.Warn(ctx, "提醒设备标识校验失败", slog.String("user_id", userID))
		return invalid("设备标识或推送凭据无效")
	}
	if input.Platform != "android" && input.Platform != "ios" {
		return invalid("不支持此设备平台")
	}
	if input.ProjectID != s.config.ExpoProjectID {
		logger.Warn(ctx, "提醒设备项目不匹配", slog.String("user_id", userID))
		return invalid("推送项目不匹配，请安装最新 APP")
	}
	if !s.config.Enabled {
		return &commonerrors.AppError{Code: 10005, Message: "消息提醒服务尚未启用", HTTPStatus: http.StatusServiceUnavailable}
	}
	now := time.Now().UTC()
	if err := s.repo.Register(ctx, migrationdo.PushDeviceDO{ID: id, UserID: userID, Token: input.Token, ProjectID: input.ProjectID, Platform: input.Platform, Active: true, LastSeenAt: now, CreatedAt: now, UpdatedAt: now}); err != nil {
		return s.storageError(ctx, "register_device", userID)
	}
	logger.Info(ctx, "提醒设备已绑定", slog.String("user_id", userID), slog.String("platform", input.Platform))
	return nil
}
func (s *Service) Revoke(ctx context.Context, userID, id string) error {
	if !installationPattern.MatchString(id) {
		return invalid("设备标识无效")
	}
	if err := s.repo.Revoke(ctx, userID, id); err != nil {
		return s.storageError(ctx, "revoke_device", userID)
	}
	logger.Info(ctx, "提醒设备已解绑", slog.String("user_id", userID))
	return nil
}

func (s *Service) eligible(ctx context.Context, userID string, p domain.Preferences, o domain.Occurrence) (bool, error) {
	loc, err := time.LoadLocation(p.Timezone)
	if err != nil {
		return false, err
	}
	start, err := time.ParseInLocation("2006-01-02", o.Date, loc)
	if err != nil {
		return false, err
	}
	switch o.Kind {
	case "meal":
		if !p.MealEnabled {
			return false, nil
		}
		recorded, err := s.repo.HasRecord(ctx, userID, o.MealType, start, start.AddDate(0, 0, 1))
		return !recorded, err
	case "log":
		if !p.LogEnabled {
			return false, nil
		}
		recorded, err := s.repo.HasRecord(ctx, userID, "", start, start.AddDate(0, 0, 1))
		return !recorded, err
	case "expiry":
		if !p.ExpiryEnabled {
			return false, nil
		}
		return s.repo.HasExpiring(ctx, userID, o.Date, start.AddDate(0, 0, 2).Format("2006-01-02"))
	}
	return false, nil
}

func (s *Service) Plan(ctx context.Context, now time.Time) error {
	return s.repo.PlanWithLock(ctx, func() error {
		after := ""
		for ctx.Err() == nil {
			settings, err := s.repo.ListPreferences(ctx, after)
			if err != nil {
				return s.storageError(ctx, "scan_preferences", "")
			}
			for _, setting := range settings {
				after = setting.UserID
				occurrences := setting.Preferences.Due(now)
				if len(occurrences) == 0 {
					continue
				}
				devices, err := s.repo.Devices(ctx, setting.UserID)
				if err != nil {
					return s.storageError(ctx, "scan_devices", setting.UserID)
				}
				for _, o := range occurrences {
					ok, err := s.eligible(ctx, setting.UserID, setting.Preferences, o)
					if err != nil {
						return s.storageError(ctx, "check_business", setting.UserID)
					}
					if !ok {
						continue
					}
					for _, device := range devices {
						key := strings.Join([]string{setting.UserID, device.ID, o.Kind, o.MealType, o.Date}, ":")
						job := migrationdo.PushDeliveryDO{UserID: setting.UserID, DeviceID: device.ID, DedupeKey: key, TokenHash: repo.TokenHash(device.Token), PreferencesVersion: setting.UpdatedAt, Kind: o.Kind, MealType: o.MealType, LocalDate: o.Date, Status: "pending", NotBefore: o.Due, ExpiresAt: o.Expires, CreatedAt: now, UpdatedAt: now}
						if err = s.repo.Enqueue(ctx, job); err != nil {
							return s.storageError(ctx, "enqueue", setting.UserID)
						}
					}
				}
			}
			if len(settings) < 100 {
				break
			}
		}
		return ctx.Err()
	})
}

func (s *Service) finish(ctx context.Context, job *migrationdo.PushDeliveryDO, changes map[string]any) error {
	if err := s.repo.Finish(ctx, job, changes); err != nil {
		return s.storageError(ctx, "finish_delivery", job.UserID)
	}
	return nil
}
func (s *Service) Dispatch(ctx context.Context, now time.Time) (bool, error) {
	job, err := s.repo.Claim(ctx, now, false)
	if err != nil {
		return false, s.storageError(ctx, "claim_delivery", "")
	}
	if job == nil {
		return false, nil
	}
	cancel := func(code string) (bool, error) {
		return true, s.finish(ctx, job, map[string]any{"status": "cancelled", "last_code": code})
	}
	if !now.Before(job.ExpiresAt) {
		return cancel("Expired")
	}
	if job.Attempts > 3 {
		return cancel("AttemptLimit")
	}
	device, err := s.repo.Device(ctx, job.DeviceID)
	if err != nil {
		return true, s.storageError(ctx, "read_device", job.UserID)
	}
	if device == nil || !device.Active || device.UserID != job.UserID || repo.TokenHash(device.Token) != job.TokenHash || device.ProjectID != s.config.ExpoProjectID || device.LastSeenAt.Before(now.AddDate(0, 0, -30)) {
		return cancel("DeviceChanged")
	}
	settings, err := s.repo.GetPreferences(ctx, job.UserID)
	if err != nil {
		return true, s.storageError(ctx, "read_preferences", job.UserID)
	}
	p := settings.Preferences
	if !p.Enabled || p.Validate() != nil || !settings.UpdatedAt.Equal(job.PreferencesVersion) {
		return cancel("PreferencesChanged")
	}
	loc, _ := time.LoadLocation(p.Timezone)
	if p.IsQuiet(now.In(loc).Format("15:04")) {
		return cancel("QuietHours")
	}
	o := domain.Occurrence{Kind: job.Kind, MealType: job.MealType, Date: job.LocalDate, Expires: job.ExpiresAt}
	ok, err := s.eligible(ctx, job.UserID, p, o)
	if err != nil {
		return true, s.storageError(ctx, "recheck_business", job.UserID)
	}
	if !ok {
		return cancel("NoLongerNeeded")
	}
	ttl := int(time.Until(job.ExpiresAt).Seconds())
	if ttl <= 0 {
		return cancel("Expired")
	}
	ticket, code := s.expo.Send(ctx, domain.BuildMessage(device.Token, job.UserID, o, ttl))
	if code == "" {
		check := now.Add(15 * time.Minute)
		logger.Info(ctx, "提醒已被推送服务接受", slog.String("job_id", job.ID), slog.String("kind", job.Kind))
		return true, s.finish(ctx, job, map[string]any{"status": "accepted", "ticket_id": ticket, "accepted_at": now, "receipt_check_at": check, "last_code": ""})
	}
	if code == "DeviceNotRegistered" {
		if err = s.repo.DisableToken(ctx, job.DeviceID, job.TokenHash); err != nil {
			return true, s.storageError(ctx, "disable_token", job.UserID)
		}
	}
	changes := map[string]any{"status": "failed", "last_code": code}
	delay := time.Duration(job.Attempts*job.Attempts) * time.Minute
	if retryable(code) && job.Attempts < 3 && now.Add(delay).Before(job.ExpiresAt) {
		changes["status"] = "pending"
		changes["not_before"] = now.Add(delay)
	}
	logger.Warn(ctx, "提醒发送未被接受", slog.String("job_id", job.ID), slog.String("reason", code))
	return true, s.finish(ctx, job, changes)
}

func (s *Service) CheckReceipt(ctx context.Context, now time.Time) (bool, error) {
	job, err := s.repo.Claim(ctx, now, true)
	if err != nil {
		return false, s.storageError(ctx, "claim_receipt", "")
	}
	if job == nil {
		return false, nil
	}
	if job.AcceptedAt == nil || now.Sub(*job.AcceptedAt) >= 23*time.Hour {
		return true, s.finish(ctx, job, map[string]any{"status": "receipt_unknown", "last_code": "ReceiptTimeout"})
	}
	found, code := s.expo.Receipt(ctx, job.TicketID)
	if !found {
		return true, s.finish(ctx, job, map[string]any{"status": "accepted", "receipt_check_at": now.Add(5 * time.Minute), "last_code": code})
	}
	status := "provider_accepted"
	if code != "" {
		status = "failed"
	}
	if code == "DeviceNotRegistered" {
		if err = s.repo.DisableToken(ctx, job.DeviceID, job.TokenHash); err != nil {
			return true, s.storageError(ctx, "disable_token", job.UserID)
		}
	}
	logger.Info(ctx, "提醒推送回执已核对", slog.String("job_id", job.ID), slog.String("status", status), slog.String("reason", code))
	return true, s.finish(ctx, job, map[string]any{"status": status, "last_code": code})
}

func (s *Service) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	lastCleanup := time.Time{}
	for {
		cycle, cancel := context.WithTimeout(ctx, 50*time.Second)
		now := time.Now()
		if err := s.Plan(cycle, now); err == nil {
			for i := 0; i < 50; i++ {
				ok, err := s.Dispatch(cycle, time.Now())
				if err != nil || !ok {
					break
				}
			}
			for i := 0; i < 50; i++ {
				ok, err := s.CheckReceipt(cycle, time.Now())
				if err != nil || !ok {
					break
				}
			}
			if now.Sub(lastCleanup) >= 24*time.Hour {
				if err := s.repo.Cleanup(cycle, now); err != nil {
					_ = s.storageError(cycle, "cleanup", "")
				} else {
					lastCleanup = now
				}
			}
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
