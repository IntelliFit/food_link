package service

import (
	"context"
	"encoding/hex"
	"log/slog"

	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/pkg/logger"
)

func validCanteenLocationKey(key string) bool {
	if key == "" {
		return true
	}
	if len(key) != 32 {
		return false
	}
	_, err := hex.DecodeString(key)
	return err == nil
}

func (s *PublicFoodService) ListCanteenLocations(ctx context.Context, userID string) ([]domain.CanteenLocation, error) {
	rows, err := s.repo.ListCanteenLocations(ctx, userID)
	if err != nil {
		logger.Error(ctx, "查询社区园区食堂地点失败", err, slog.String("user_id", userID))
		return nil, err
	}
	logger.Info(ctx, "社区园区食堂地点查询完成", slog.String("user_id", userID), slog.Int("canteen_count", len(rows)))
	return rows, nil
}
