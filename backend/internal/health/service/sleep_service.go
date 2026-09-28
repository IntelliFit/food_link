package service

import (
	"context"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/health/repo"
	"food_link/backend/pkg/logger"
)

type SleepService struct{ repo *repo.SleepRepo }

func NewSleepService(r *repo.SleepRepo) *SleepService { return &SleepService{repo: r} }

type SleepInput struct {
	Bedtime  time.Time `json:"bedtime"`
	WakeTime time.Time `json:"wake_time"`
	Quality  string    `json:"quality"`
	Note     string    `json:"note"`
}

func sleepInvalid(message string) error {
	return &commonerrors.AppError{Code: 10002, Message: message, HTTPStatus: 400}
}
func validateSleepDate(date string, now time.Time) error {
	d, err := time.Parse("2006-01-02", date)
	if err != nil || d.Year() < 1900 || date > now.In(chinaTZ).Format("2006-01-02") {
		return sleepInvalid("请选择有效的起床日期，不能记录未来日期")
	}
	return nil
}
func validateSleep(date string, in SleepInput, now time.Time) error {
	if err := validateSleepDate(date, now); err != nil {
		return err
	}
	duration := in.WakeTime.Sub(in.Bedtime)
	if in.Bedtime.IsZero() || in.WakeTime.IsZero() || duration < time.Minute || duration > 24*time.Hour {
		return sleepInvalid("起床时间须晚于入睡时间，间隔不超过24小时")
	}
	if in.WakeTime.In(chinaTZ).Format("2006-01-02") != date {
		return sleepInvalid("请按起床当天记录这次睡眠")
	}
	if in.WakeTime.After(now.Add(5 * time.Minute)) {
		return sleepInvalid("请在起床后记录，时间不能晚于现在")
	}
	if in.Quality != "" && in.Quality != "good" && in.Quality != "fair" && in.Quality != "poor" {
		return sleepInvalid("请选择好、一般或差，也可以暂不填写")
	}
	if utf8.RuneCountInString(in.Note) > 500 {
		return sleepInvalid("补充说明最多500字")
	}
	return nil
}
func (s *SleepService) Get(ctx context.Context, userID, date string) (*domain.SleepRecord, error) {
	if err := validateSleepDate(date, time.Now()); err != nil {
		return nil, err
	}
	r, err := s.repo.Get(ctx, userID, date)
	if err != nil {
		logger.Error(ctx, "读取睡眠记录失败", err, logger.UserID(userID), slog.String("date", date))
	}
	return r, err
}
func (s *SleepService) Save(ctx context.Context, userID, date string, in SleepInput) (*domain.SleepRecord, error) {
	in.Note = strings.TrimSpace(in.Note)
	if err := validateSleep(date, in, time.Now()); err != nil {
		logger.Warn(ctx, "睡眠记录校验失败", logger.UserID(userID), slog.String("date", date))
		return nil, err
	}
	r, err := s.repo.Save(ctx, userID, domain.SleepRecord{Date: date, Bedtime: in.Bedtime, WakeTime: in.WakeTime, Quality: in.Quality, Note: in.Note})
	if err != nil {
		logger.Error(ctx, "保存睡眠记录失败", err, logger.UserID(userID), slog.String("date", date))
		return nil, err
	}
	logger.Info(ctx, "睡眠记录已按日期保存", logger.UserID(userID), slog.String("record_id", r.ID), slog.String("date", date))
	return r, nil
}
func (s *SleepService) Delete(ctx context.Context, userID, date string) error {
	if err := validateSleepDate(date, time.Now()); err != nil {
		return err
	}
	err := s.repo.Delete(ctx, userID, date)
	if err != nil {
		logger.Error(ctx, "删除睡眠记录失败", err, logger.UserID(userID), slog.String("date", date))
	} else {
		logger.Info(ctx, "睡眠记录已删除", logger.UserID(userID), slog.String("date", date))
	}
	return err
}
