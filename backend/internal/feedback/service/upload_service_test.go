package service

import (
	"testing"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/require"
)

func TestUploadService_NormalizeOwnedImageURLs(t *testing.T) {
	client := storage.New(config.StorageConfig{
		COSFoodImagesBucket:  "food-images-1370036754",
		CDNFoodImagesBaseURL: "https://cdn-food-images.example.com",
	})
	svc := NewUploadService(client)

	userID := "u1"
	owned := "https://cdn-food-images.example.com/user-feedback/u1/abc.jpg"
	foreign := "https://cdn-food-images.example.com/user-feedback/u2/def.jpg"
	invalid := "https://evil.example.com/hack.jpg"

	out, err := svc.NormalizeOwnedImageURLs(userID, []string{owned, foreign, invalid, owned, ""})
	require.NoError(t, err)
	require.Equal(t, []string{owned}, out)
}

func TestUploadService_NormalizeOwnedImageURLs_Empty(t *testing.T) {
	svc := NewUploadService(storage.New(config.StorageConfig{}))
	out, err := svc.NormalizeOwnedImageURLs("u1", nil)
	require.NoError(t, err)
	require.Empty(t, out)
}
