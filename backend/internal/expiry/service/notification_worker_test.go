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

func TestNotificationTemplateDataRebuildsLegacySnapshotForCurrentTemplate(t *testing.T) {
	legacySnapshot := map[string]any{
		"data": map[string]any{
			"thing1":            map[string]any{"value": "旧名称"},
			"time2":             map[string]any{"value": "2026-01-01 09:00"},
			"character_string5": map[string]any{"value": "NA"},
		},
	}
	item := &domain.ExpiryItem{
		FoodName:    "酸奶",
		StorageType: "refrigerated",
		ExpireDate:  time.Date(2026, 8, 22, 0, 0, 0, 0, time.UTC),
	}

	data := notificationTemplateData(legacySnapshot, item)

	assert.Equal(t, map[string]any{
		"thing12": map[string]any{"value": "酸奶"},
		"time1":   map[string]any{"value": "2026-08-22 09:00"},
		"thing4":  map[string]any{"value": "今天到期，请优先处理"},
		"thing17": map[string]any{"value": "冷藏"},
	}, data)
}
