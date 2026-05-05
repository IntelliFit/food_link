package repo

import (
	"fmt"
	"time"
)

var chinaTZ = time.FixedZone("Asia/Shanghai", 8*60*60)

func chinaDateWindow(date string) (time.Time, time.Time, error) {
	parsed, err := time.ParseInLocation("2006-01-02", date, chinaTZ)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid date: %w", err)
	}
	return parsed.UTC(), parsed.Add(24 * time.Hour).UTC(), nil
}

func chinaToday() string {
	return time.Now().In(chinaTZ).Format("2006-01-02")
}

func parseChinaDate(date string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02", date, chinaTZ)
}
