package service

import (
	"testing"
	"time"

	"food_link/backend/internal/mealdish/domain"
	"food_link/backend/internal/mealdish/repo"
)

func TestCohortOf(t *testing.T) {
	now := time.Date(2026, 10, 28, 12, 0, 0, 0, shanghai)
	old := now.Add(-30 * 24 * time.Hour)
	fresh := now.Add(-24 * time.Hour)
	cases := []struct {
		name    string
		signals repo.UserSignals
		want    string
	}{
		{"unknown registration", repo.UserSignals{RecordDays: 14}, domain.CohortRegular},
		{"registered yesterday", repo.UserSignals{RegisteredAt: &fresh, RecordDays: 14}, domain.CohortRegular},
		{"logs 6 of 14 days", repo.UserSignals{RegisteredAt: &old, RecordDays: 6}, domain.CohortRegular},
		{"logs 7 of 14 days", repo.UserSignals{RegisteredAt: &old, RecordDays: 7}, domain.CohortActive},
		{"too few prompts to judge", repo.UserSignals{RegisteredAt: &old, RecordDays: 9, Prompts: 2}, domain.CohortActive},
		{"keeps skipping", repo.UserSignals{RegisteredAt: &old, RecordDays: 9, Prompts: 7, AnsweredPrompts: 2}, domain.CohortRegular},
		{"answers a third", repo.UserSignals{RegisteredAt: &old, RecordDays: 9, Prompts: 6, AnsweredPrompts: 2}, domain.CohortActive},
		{"three published uploads", repo.UserSignals{RegisteredAt: &old, RecordDays: 7, PublishedUploads: 3}, domain.CohortContributor},
		{"submitted a capture", repo.UserSignals{RegisteredAt: &old, RecordDays: 7, Captures: 1}, domain.CohortContributor},
		{"contributor who logs rarely", repo.UserSignals{RegisteredAt: &old, RecordDays: 2, Captures: 3}, domain.CohortRegular},
	}
	for _, tc := range cases {
		if got := cohortOf(tc.signals, now); got != tc.want {
			t.Fatalf("%s: got %s, want %s", tc.name, got, tc.want)
		}
	}
}
