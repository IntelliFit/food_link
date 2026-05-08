package dateutil

import (
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
)

const ChinaDateLayout = "2006-01-02"
const backfillRecordWindowDays = 3

var chinaLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

func ChinaLocation() *time.Location {
	return chinaLocation
}

func TodayChina() string {
	return time.Now().In(chinaLocation).Format(ChinaDateLayout)
}

func NormalizeChinaDate(value string, fieldName string) (string, error) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return TodayChina(), nil
	}
	if t, err := time.ParseInLocation(ChinaDateLayout, raw, chinaLocation); err == nil {
		return t.Format(ChinaDateLayout), nil
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t.In(chinaLocation).Format(ChinaDateLayout), nil
	}
	if fieldName == "" {
		fieldName = "date"
	}
	return "", &commonerrors.AppError{Code: 10002, Message: fieldName + " format is invalid", HTTPStatus: 400}
}

func ResolveRecordedOnDate(value string, fieldName string) (string, error) {
	normalized, err := NormalizeChinaDate(value, fieldName)
	if err != nil {
		return "", err
	}
	target, _ := time.ParseInLocation(ChinaDateLayout, normalized, chinaLocation)
	now := time.Now().In(chinaLocation)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, chinaLocation)
	earliest := today.AddDate(0, 0, -(backfillRecordWindowDays - 1))
	if target.After(today) {
		return "", &commonerrors.AppError{Code: 10002, Message: "future dates are not allowed", HTTPStatus: 400}
	}
	if target.Before(earliest) {
		return "", &commonerrors.AppError{Code: 10002, Message: "only records within the last 3 days are allowed", HTTPStatus: 400}
	}
	return normalized, nil
}

func BuildRecordTime(recordedOn string) (time.Time, error) {
	normalized, err := NormalizeChinaDate(recordedOn, "date")
	if err != nil {
		return time.Time{}, err
	}
	target, _ := time.ParseInLocation(ChinaDateLayout, normalized, chinaLocation)
	now := time.Now().In(chinaLocation)
	return time.Date(target.Year(), target.Month(), target.Day(), now.Hour(), now.Minute(), now.Second(), 0, chinaLocation).UTC(), nil
}
