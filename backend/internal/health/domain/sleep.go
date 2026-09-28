package domain

import "time"

// SleepRecord is a manually reported main sleep period, grouped by wake-up day.
type SleepRecord struct {
	ID              string    `json:"id"`
	Date            string    `json:"date"`
	Bedtime         time.Time `json:"bedtime"`
	WakeTime        time.Time `json:"wake_time"`
	Quality         string    `json:"quality"`
	Note            string    `json:"note"`
	Source          string    `json:"source"`
	DurationMinutes int       `json:"duration_minutes"`
}
