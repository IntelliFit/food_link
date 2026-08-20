package service

import (
	"context"
	"log/slog"
	"strings"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
)

type UserFoodPhotoReader interface {
	List(ctx context.Context, input repo.ListUserFoodPhotoInput) (*repo.ListUserFoodPhotoResult, error)
}

type UserFoodPhotoService struct {
	repo    UserFoodPhotoReader
	storage *storage.Client
}

func NewUserFoodPhotoService(repo UserFoodPhotoReader, storageClient *storage.Client) *UserFoodPhotoService {
	return &UserFoodPhotoService{repo: repo, storage: storageClient}
}

type ListUserFoodPhotoInput struct {
	Query  string
	Source string
	Status string
	Page   int
	Limit  int
}

func (s *UserFoodPhotoService) List(ctx context.Context, input ListUserFoodPhotoInput) (*repo.ListUserFoodPhotoResult, error) {
	page := input.Page
	if page <= 0 {
		page = 1
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 40
	}
	if limit > 100 {
		limit = 100
	}
	result, err := s.repo.List(ctx, repo.ListUserFoodPhotoInput{
		Query:  strings.TrimSpace(input.Query),
		Source: strings.TrimSpace(input.Source),
		Status: strings.TrimSpace(input.Status),
		Limit:  limit,
		Offset: (page - 1) * limit,
	})
	if err != nil {
		logger.Error(ctx, "读取用户食物照片失败", err,
			slog.Int("page", page),
			slog.Int("limit", limit),
		)
		return nil, err
	}
	for i := range result.Items {
		item := &result.Items[i]
		if s.storage == nil {
			item.ImageURL = item.ImagePath
			item.ThumbnailURL = item.ImagePath
			continue
		}
		item.ImageURL = s.storage.ResolveReferenceURL("food-images", item.ImagePath)
		item.ThumbnailURL = s.storage.BuildImageThumbnailURL("food-images", item.ImagePath, 640)
		item.UserAvatar = s.storage.ResolveUserAvatarURL(item.UserAvatar)
	}
	return result, nil
}
