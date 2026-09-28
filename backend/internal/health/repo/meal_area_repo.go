package repo

import (
	"context"
	"food_link/backend/internal/health/domain"
)

// LatestMealArea reads only this account's recent analysis area, not chat text or IP.
func (r *StatsRepo) LatestMealArea(ctx context.Context, userID string) (*domain.MealArea, error) {
	var rows []domain.MealArea
	err := r.db.WithContext(ctx).Raw(`SELECT payload->>'province' AS province,
		payload->>'city' AS city, payload->>'district' AS district, created_at AS recorded_at
		FROM analysis_tasks WHERE user_id=? AND created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'
		AND (COALESCE(payload->>'province','')<>'' OR COALESCE(payload->>'city','')<>'' OR COALESCE(payload->>'district','')<>'')
		ORDER BY created_at DESC LIMIT 1`, userID).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return &rows[0], nil
}
