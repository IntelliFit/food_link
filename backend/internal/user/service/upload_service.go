package service

import (
	"fmt"
	"time"

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
	stored, err := s.storage.UploadBase64("health-reports", key, base64Image, "image/jpeg")
	if err != nil {
		return "", err
	}
	if signedURL, signErr := s.storage.PresignGETURL("health-reports", stored, 24*time.Hour); signErr == nil && signedURL != "" {
		return signedURL, nil
	}
	return stored, nil
}
