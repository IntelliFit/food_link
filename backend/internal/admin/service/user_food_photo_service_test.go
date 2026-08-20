package service

import (
	"context"
	"testing"

	"food_link/backend/internal/admin/repo"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeUserFoodPhotoReader struct {
	input repo.ListUserFoodPhotoInput
	items []repo.UserFoodPhoto
}

func (f *fakeUserFoodPhotoReader) List(_ context.Context, input repo.ListUserFoodPhotoInput) (*repo.ListUserFoodPhotoResult, error) {
	f.input = input
	return &repo.ListUserFoodPhotoResult{Items: append([]repo.UserFoodPhoto(nil), f.items...), Total: int64(len(f.items))}, nil
}

func TestUserFoodPhotoServiceListPaginatesAndResolvesImages(t *testing.T) {
	reader := &fakeUserFoodPhotoReader{items: []repo.UserFoodPhoto{{
		ImagePath:  "users/u1/meal.jpg",
		UserAvatar: "avatars/u1.jpg",
	}}}
	storageClient := storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL:  "https://food.example.com",
		CDNUserAvatarsBaseURL: "https://avatar.example.com",
	})
	svc := NewUserFoodPhotoService(reader, storageClient)

	result, err := svc.List(context.Background(), ListUserFoodPhotoInput{
		Query: "  用户甲  ", Page: 2, Limit: 25, Source: "analysis_task", Status: "done",
	})

	require.NoError(t, err)
	require.Len(t, result.Items, 1)
	assert.Equal(t, 25, reader.input.Limit)
	assert.Equal(t, 25, reader.input.Offset)
	assert.Equal(t, "用户甲", reader.input.Query)
	assert.Equal(t, "https://food.example.com/users/u1/meal.jpg", result.Items[0].ImageURL)
	assert.Contains(t, result.Items[0].ThumbnailURL, "https://food.example.com/users/u1/meal.jpg")
	assert.Equal(t, "https://avatar.example.com/avatars/u1.jpg", result.Items[0].UserAvatar)
}

func TestUserFoodPhotoServiceListCapsPageSize(t *testing.T) {
	reader := &fakeUserFoodPhotoReader{}
	svc := NewUserFoodPhotoService(reader, nil)

	_, err := svc.List(context.Background(), ListUserFoodPhotoInput{Page: -1, Limit: 999})

	require.NoError(t, err)
	assert.Equal(t, 100, reader.input.Limit)
	assert.Equal(t, 0, reader.input.Offset)
}
