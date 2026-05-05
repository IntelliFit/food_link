package service

import (
	"fmt"

	"food_link/backend/pkg/storage"
	"github.com/google/uuid"
)

type UploadService struct {
	storage *storage.Client
}

func NewUploadService(storage *storage.Client) *UploadService {
	return &UploadService{storage: storage}
}

func (s *UploadService) UploadAvatar(userID string, base64Image string) (string, error) {
	if base64Image == "" {
		return "", fmt.Errorf("base64Image 不能为空")
	}
	key := fmt.Sprintf("%s/%s.jpg", userID, uuid.New().String())
	return s.storage.UploadBase64("user-avatars", key, base64Image, "image/jpeg")
}

func (s *UploadService) UploadReportImage(userID string, base64Image string) (string, error) {
	if base64Image == "" {
		return "", fmt.Errorf("base64Image 不能为空")
	}
	key := fmt.Sprintf("%s/%s.jpg", userID, uuid.New().String())
	return s.storage.UploadBase64("health-reports", key, base64Image, "image/jpeg")
}
