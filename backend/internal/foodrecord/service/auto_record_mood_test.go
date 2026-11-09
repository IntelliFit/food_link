package service

import (
	"context"
	"testing"

	analyzedomain "food_link/backend/internal/analyze/domain"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAutoRecordCompletedTaskKeepsMoodChosenBeforeAnalysis(t *testing.T) {
	svc, r, db, _, owner := setupFeedPrivacyService(t)
	ctx := context.Background()
	calm := "calm"

	for _, tc := range []struct {
		name string
		mood any
		want *string
	}{
		{"valid mood is saved", calm, &calm},
		{"no mood stays empty", nil, nil},
		{"unknown mood does not fail the record", "furious", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload := map[string]any{"auto_record_requested": true, "meal_type": "lunch"}
			if tc.mood != nil {
				payload["eating_mood"] = tc.mood
			}
			task := &analyzedomain.AnalysisTask{
				ID:       uuid.New().String(),
				UserID:   owner.ID,
				TaskType: "food",
				Status:   "done",
				Payload:  payload,
				Result: map[string]any{
					"description": "鸡蛋",
					"items": []any{map[string]any{
						"name":      "鸡蛋",
						"weight":    50.0,
						"nutrients": map[string]any{"calories": 70.0, "protein": 6.0, "carbs": 1.0, "fat": 5.0},
					}},
				},
			}
			require.NoError(t, db.Create(task).Error)

			recordID, saved, err := svc.AutoRecordCompletedTask(ctx, task)

			require.NoError(t, err)
			require.True(t, saved)
			stored, err := r.GetByID(ctx, recordID)
			require.NoError(t, err)
			assert.Equal(t, tc.want, stored.EatingMood)
		})
	}
}
