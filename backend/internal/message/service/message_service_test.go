package service

import (
	"testing"

	"food_link/backend/pkg/config"
	"food_link/backend/pkg/storage"

	"github.com/stretchr/testify/assert"
)

func TestMessageServiceResolveImageURLUsesFoodImagesBucket(t *testing.T) {
	svc := NewMessageService(nil, storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL:  "https://cdn-food-images.example.com",
		CDNUserAvatarsBaseURL: "https://cdn-user-avatars.example.com",
	}))

	assert.Equal(t, "https://cdn-food-images.example.com/messages/photo.jpg", svc.resolveImageURL("messages/photo.jpg"))
}

func TestMessageServiceResolveAvatarURLUsesUserAvatarsBucket(t *testing.T) {
	svc := NewMessageService(nil, storage.New(config.StorageConfig{
		CDNFoodImagesBaseURL:  "https://cdn-food-images.example.com",
		CDNUserAvatarsBaseURL: "https://cdn-user-avatars.example.com",
	}))

	assert.Equal(t, "https://cdn-user-avatars.example.com/users/avatar.jpg", svc.resolveAvatarURL("users/avatar.jpg"))
	assert.Equal(t, "https://cdn-food-images.example.com/wechat/default_avatar.jpg", svc.resolveAvatarURL("_system/default_avatar.jpg"))
}
