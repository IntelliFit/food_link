package service

import (
	"testing"
	"time"

	"food_link/backend/internal/expiry/domain"

	"github.com/stretchr/testify/assert"
)

func TestNotificationScheduleChangedAfterJobDue_DoesNotCancelTodayDueJob(t *testing.T) {
	china := time.FixedZone("Asia/Shanghai", 8*60*60)
	nowLocal := time.Date(2026, 5, 6, 9, 1, 0, 0, china)
	jobScheduledAt := time.Date(2026, 5, 6, 9, 0, 0, 0, china).UTC()
	recomputed := nowLocal.Add(time.Minute)
	item := &domain.ExpiryItem{ExpireDate: time.Date(2026, 5, 6, 0, 0, 0, 0, china)}

	changed := notificationScheduleChangedAfterJobDue(jobScheduledAt, item, &recomputed, nowLocal)

	assert.False(t, changed)
}

func TestNotificationScheduleChangedAfterJobDue_CancelsFutureChangedJob(t *testing.T) {
	china := time.FixedZone("Asia/Shanghai", 8*60*60)
	nowLocal := time.Date(2026, 5, 6, 9, 1, 0, 0, china)
	jobScheduledAt := time.Date(2026, 5, 6, 9, 0, 0, 0, china).UTC()
	recomputed := time.Date(2026, 5, 7, 9, 0, 0, 0, china)
	item := &domain.ExpiryItem{ExpireDate: time.Date(2026, 5, 7, 0, 0, 0, 0, china)}

	changed := notificationScheduleChangedAfterJobDue(jobScheduledAt, item, &recomputed, nowLocal)

	assert.True(t, changed)
}
