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
