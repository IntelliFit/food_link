package service

import (
	"context"
	"errors"
	"log/slog"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/utility/domain"
	"food_link/backend/internal/utility/repo"
	"food_link/backend/pkg/logger"
)

type ManualFoodService struct {
	repo *repo.ManualFoodRepo
}

func NewManualFoodService(repo *repo.ManualFoodRepo) *ManualFoodService {
	return &ManualFoodService{repo: repo}
}

func (s *ManualFoodService) Browse(ctx context.Context, userID string, limit int) (*domain.ManualFoodBrowseResult, error) {
	if limit <= 0 {
		limit = 12
	}
	if limit > 30 {
		limit = 30
	}
	return s.repo.Browse(ctx, userID, limit)
}

func (s *ManualFoodService) Catalog(ctx context.Context, userID string, category string, page int, pageSize int) (*domain.ManualFoodCatalogResult, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 30
	}
	if pageSize > 60 {
		pageSize = 60
	}
	return s.repo.Catalog(ctx, userID, category, page, pageSize)
}

func (s *ManualFoodService) Search(ctx context.Context, userID string, keyword string, limit int) ([]domain.ManualFoodResult, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 60 {
		limit = 60
	}
	return s.repo.Search(ctx, userID, keyword, limit)
}

func (s *ManualFoodService) SearchPackaged(ctx context.Context, keyword string, limit int) ([]domain.ManualFoodResult, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 60 {
		limit = 60
	}
	return s.repo.SearchPackaged(ctx, keyword, limit)
}

func (s *ManualFoodService) ListCustomFoods(ctx context.Context, userID string, limit int, offset int) ([]domain.ManualFoodResult, bool, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 120 {
		limit = 120
	}
	return s.repo.ListCustomFoods(ctx, userID, limit, offset)
}

func (s *ManualFoodService) SaveCustomFood(ctx context.Context, userID string, input repo.CustomFoodInput) (domain.ManualFoodResult, error) {
	logger.Info(ctx, "保存自定义食物", slog.String("user_id", userID), slog.String("food_id", input.ID))
	item, err := s.repo.SaveCustomFood(ctx, userID, input)
	if err != nil {
		logCustomFoodFailure(ctx, "保存自定义食物失败", err, userID, input.ID)
		return item, err
	}
	logger.Info(ctx, "自定义食物已保存", slog.String("user_id", userID), slog.String("food_id", item.ID), slog.Int("image_count", len(item.ImagePaths)))
	return item, nil
}

func (s *ManualFoodService) DeleteCustomFood(ctx context.Context, userID, id string) error {
	logger.Info(ctx, "删除自定义食物", slog.String("user_id", userID), slog.String("food_id", id))
	if err := s.repo.DeleteCustomFood(ctx, userID, id); err != nil {
		logCustomFoodFailure(ctx, "删除自定义食物失败", err, userID, id)
		return err
	}
	logger.Info(ctx, "自定义食物已删除", slog.String("user_id", userID), slog.String("food_id", id))
	return nil
}

func logCustomFoodFailure(ctx context.Context, message string, err error, userID, id string) {
	var expected *commonerrors.AppError
	if errors.As(err, &expected) && expected.HTTPStatus < 500 {
		logger.Warn(ctx, message, slog.String("user_id", userID), slog.String("food_id", id), slog.String("reason", err.Error()))
		return
	}
	logger.Error(ctx, message, err, slog.String("user_id", userID), slog.String("food_id", id))
}
