package service

import (
	"context"

	"food_link/backend/internal/utility/domain"
	"food_link/backend/internal/utility/repo"
)

type ManualFoodService struct {
	repo *repo.ManualFoodRepo
}

func NewManualFoodService(repo *repo.ManualFoodRepo) *ManualFoodService {
	return &ManualFoodService{repo: repo}
}

func (s *ManualFoodService) Browse(ctx context.Context, category string, limit int) ([]domain.ManualFood, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	return s.repo.List(ctx, category, limit)
}

func (s *ManualFoodService) Search(ctx context.Context, keyword string, limit int) ([]domain.ManualFood, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	return s.repo.Search(ctx, keyword, limit)
}
