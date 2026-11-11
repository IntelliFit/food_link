package service

import (
	"context"
	"fmt"
	"strings"

	contentsecurity "food_link/backend/internal/contentsecurity/service"
	"food_link/backend/pkg/storage"
	"github.com/google/uuid"
)

type UploadService struct {
	contentSecurity *contentsecurity.Service
	storage         *storage.Client
	videoStorage    analyzeVideoStorage
	videoExtractor  analyzeVideoFrameExtractor
}

func (s *UploadService) ConfigureContentSecurity(checker *contentsecurity.Service) {
	s.contentSecurity = checker
}

func (s *UploadService) StartImageAudit(ctx context.Context, userID string, imageURLs []string) error {
	if s.contentSecurity == nil {
		return nil
	}
	return s.contentSecurity.StartDocument(ctx, userID, 4, map[string]any{"image_urls": imageURLs}, s.storage)
}

func NewUploadService(storage *storage.Client) *UploadService {
	return &UploadService{
		storage:        storage,
		videoStorage:   storage,
		videoExtractor: ffmpegAnalyzeVideoFrameExtractor{},
	}
}

// Account namespace enables complete cleanup of uploads never saved as records.
func (s *UploadService) UploadBase64ForUser(userID, image string) (string, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return "", fmt.Errorf("用户身份无效")
	}
	if image == "" {
		return "", fmt.Errorf("图片不能为空")
	}
	return s.storage.UploadBase64("food-images", userID+"/"+uuid.NewString()+".jpg", image, "image/jpeg")
}
func (s *UploadService) UploadFileForUser(userID string, data []byte, ext, contentType string) (string, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return "", fmt.Errorf("用户身份无效")
	}
	if len(data) == 0 {
		return "", fmt.Errorf("图片不能为空")
	}
	ext = strings.ToLower(strings.TrimSpace(ext))
	if ext == "" {
		ext = ".jpg"
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}
	return s.storage.UploadBytes("food-images", userID+"/"+uuid.NewString()+ext, data, contentType)
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
