package service

import (
	"os"
	"strings"
	"testing"
	"time"
)

// Canteen dishes are offered only while the canteen is open, so the suite would pass or
// fail by the time of day. Pin the meal clock to lunchtime today (China time); tests that
// are about the clock set state.AsOf themselves. Opt-in runs against live data
// (FOODLINK_EVAL_*, FOODLINK_*_LIVE*) keep the real clock.
func TestMain(m *testing.M) {
	for _, env := range os.Environ() {
		name, _, _ := strings.Cut(env, "=")
		if strings.HasPrefix(name, "FOODLINK_EVAL_") || strings.HasPrefix(name, "FOODLINK_") && strings.Contains(name, "LIVE") {
			os.Exit(m.Run())
		}
	}
	now := time.Now().In(chinaTZ)
	lunch := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, chinaTZ)
	mealClock = func() time.Time { return lunch }
	os.Exit(m.Run())
}
