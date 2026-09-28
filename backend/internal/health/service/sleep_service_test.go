package service

import (
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
)

func TestSleepValidation(t *testing.T) {
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, chinaTZ)
	base := SleepInput{Bedtime: now.Add(-13 * time.Hour), WakeTime: now.Add(-5 * time.Hour), Quality: "fair", Note: "醒了两次"}
	require.NoError(t, validateSleep("2026-09-28", base, now))
	for _, tc := range []struct {
		name, date string
		change     func(*SleepInput)
	}{
		{"wrong wake day", "2026-09-27", func(*SleepInput) {}},
		{"bad date", "2026-02-30", func(*SleepInput) {}},
		{"future day", "2026-09-29", func(*SleepInput) {}},
		{"reversed", "2026-09-28", func(i *SleepInput) { i.Bedtime = i.WakeTime.Add(time.Hour) }},
		{"too long", "2026-09-28", func(i *SleepInput) { i.Bedtime = i.WakeTime.Add(-25 * time.Hour) }},
		{"future wake", "2026-09-28", func(i *SleepInput) { i.WakeTime = now.Add(time.Hour) }},
		{"bad quality", "2026-09-28", func(i *SleepInput) { i.Quality = "diagnosed" }},
		{"long note", "2026-09-28", func(i *SleepInput) { i.Note = strings.Repeat("字", 501) }},
	} {
		t.Run(tc.name, func(t *testing.T) { in := base; tc.change(&in); require.Error(t, validateSleep(tc.date, in, now)) })
	}
	base.Bedtime = now.Add(-11 * time.Hour) // 01:00 on wake-up day.
	base.Quality = ""
	require.NoError(t, validateSleep("2026-09-28", base, now))
	base.Bedtime = base.Bedtime.UTC()
	base.WakeTime = base.WakeTime.UTC()
	require.NoError(t, validateSleep("2026-09-28", base, now))
}
