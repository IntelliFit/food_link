package service

import (
	"fmt"
	"strings"

	"food_link/backend/pkg/storage"
	"github.com/google/uuid"
)

type UploadService struct {
	storage *storage.Client
}

func NewUploadService(storage *storage.Client) *UploadService {
	return &UploadService{storage: storage}
}

func (s *UploadService) UploadBase64(base64Image string) (string, error) {
	if base64Image == "" {
		return "", fmt.Errorf("base64Image 不能为空")
	}
	key := uuid.New().String() + ".jpg"
	return s.storage.UploadBase64("food-images", key, base64Image, "image/jpeg")
}

func (s *UploadService) UploadFile(fileBytes []byte, ext, contentType string) (string, error) {
	if len(fileBytes) == 0 {
		return "", fmt.Errorf("图片文件为空")
	}
	safeExt := strings.ToLower(strings.TrimSpace(ext))
	if safeExt == "" {
		safeExt = ".jpg"
	}
	if !strings.HasPrefix(safeExt, ".") {
		safeExt = "." + safeExt
	}
	key := uuid.New().String() + safeExt
	safeContentType := strings.TrimSpace(contentType)
	if safeContentType == "" {
		safeContentType = "image/jpeg"
	}
	return s.storage.UploadBytes("food-images", key, fileBytes, safeContentType)
}
