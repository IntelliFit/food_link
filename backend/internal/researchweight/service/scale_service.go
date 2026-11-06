package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"food_link/backend/internal/researchweight/domain"
	"food_link/backend/pkg/logger"
)

// DailyScaleReadLimit caps model readings per contributor per 24 hours; a
// full canteen session needs a few dozen.
const DailyScaleReadLimit = 300

// ConfigureAutoReview turns on automatic scale reading and review. With a nil
// reader samples stay pending for a reviewer, as before.
func (s *SampleService) ConfigureAutoReview(reader *ScaleReader) {
	s.reader = reader
}

// AutoReviewEnabled reports whether a reading model is configured.
func (s *SampleService) AutoReviewEnabled() bool { return s.reader != nil }

func contentHash(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// recordUpload keeps the server's own hash of an uploaded photo so the same
// picture cannot back someone else's sample.
func (s *SampleService) recordUpload(ctx context.Context, userID, key string, data []byte) error {
	return s.repo.SavePhotoCheck(ctx, &domain.PhotoCheck{ObjectKey: key, UserID: userID, ContentSHA256: contentHash(data)})
}

// ReadScale reads one uploaded scale photo with the configured models and
// stores the readings; a photo is read once, later calls reuse the result.
func (s *SampleService) ReadScale(ctx context.Context, userID, imageURL string, precision float64) (*domain.ScaleReadView, error) {
	if s.reader == nil {
		return nil, badRequest("自动读数暂不可用，请手动填写读数")
	}
	key := s.keyResolver(userID)(strings.TrimSpace(imageURL))
	if key == "" {
		return nil, badRequest("照片必须来自食探上传")
	}
	readings, err := s.storedReadings(ctx, key)
	if err != nil {
		return nil, err
	}
	if readings == nil {
		count, err := s.repo.CountReadsSince(ctx, userID, s.now().Add(-24*time.Hour))
		if err != nil {
			return nil, err
		}
		if count >= DailyScaleReadLimit {
			return nil, badRequest("今天自动读数次数已用完，请手动填写读数")
		}
		readings = s.reader.Read(ctx, s.accessURL(key))
		if err := s.repo.SaveReadings(ctx, userID, key, readings); err != nil {
			return nil, err
		}
	}
	view := scaleReadView(readings, precision)
	logger.Info(ctx, "称重科研秤读数识别完成", slog.String("user_id", userID), slog.String("agreement", view.Agreement))
	return &view, nil
}

func (s *SampleService) storedReadings(ctx context.Context, key string) ([]domain.ScaleReading, error) {
	checks, err := s.repo.PhotoChecks(ctx, []string{key})
	if err != nil {
		return nil, err
	}
	check, ok := checks[key]
	if !ok || check.ReadAt == nil {
		return nil, nil
	}
	return check.Readings, nil
}

func scaleReadView(readings []domain.ScaleReading, precision float64) domain.ScaleReadView {
	agreement, chosen := ReadingAgreement(readings, precision)
	view := domain.ScaleReadView{Agreement: agreement}
	if chosen != nil {
		view.Readable, view.Grams, view.RawValue, view.Unit = true, chosen.Grams, chosen.RawValue, chosen.Unit
	}
	switch agreement {
	case domain.AgreementAgree, domain.AgreementSingle:
		view.Message = fmt.Sprintf("已读出 %s，请核对", formatGrams(*chosen.Grams))
	case domain.AgreementDisagree:
		view.Message = "两次读数不一致，建议对准显示屏重拍"
	default:
		view.Message = unreadableMessage(readings)
	}
	return view
}

func unreadableMessage(readings []domain.ScaleReading) string {
	for _, reading := range readings {
		if reading.Error != "" {
			continue
		}
		if !reading.IsScaleDisplay {
			return "这张照片里没看到秤的显示屏，请对准显示屏重拍"
		}
		if reading.Unit == "ml" {
			return "秤在毫升模式，请切换到克（g）后重拍"
		}
		if reading.Reason != "" {
			return fmt.Sprintf("没读清秤上的数字（%s），请重拍", reading.Reason)
		}
	}
	return "没读清秤上的数字，请对准显示屏重拍"
}

func formatGrams(grams float64) string {
	if grams == float64(int64(grams)) {
		return fmt.Sprintf("%d g", int64(grams))
	}
	return fmt.Sprintf("%.1f g", grams)
}
