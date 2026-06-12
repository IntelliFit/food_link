package service

import (
	"fmt"
	"path/filepath"
	"strings"

	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
)

const (
	feedbackImageBucketAlias = "food-images"
	maxFeedbackImageCount    = 4
	maxFeedbackImageBytes    = 8 << 20 // 8MB
)

type UploadService struct {
	storage *storage.Client
}

func NewUploadService(storageClient *storage.Client) *UploadService {
	return &UploadService{storage: storageClient}
}

func (s *UploadService) UploadImage(userID string, fileBytes []byte, ext, contentType string) (string, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", fmt.Errorf("userID 不能为空")
	}
	if len(fileBytes) == 0 {
		return "", fmt.Errorf("图片文件为空")
	}
	if len(fileBytes) > maxFeedbackImageBytes {
		return "", fmt.Errorf("图片文件过大，请压缩后重试")
	}
	safeExt := normalizeImageExt(ext)
	key := fmt.Sprintf("user-feedback/%s/%s%s", userID, uuid.NewString(), safeExt)
	safeContentType := strings.TrimSpace(contentType)
	if safeContentType == "" {
		safeContentType = "image/jpeg"
	}
	return s.storage.UploadBytes(feedbackImageBucketAlias, key, fileBytes, safeContentType)
}

func (s *UploadService) NormalizeOwnedImageURLs(userID string, urls []string) ([]string, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, fmt.Errorf("userID 不能为空")
	}
	if len(urls) == 0 {
		return []string{}, nil
	}
	if len(urls) > maxFeedbackImageCount {
		urls = urls[:maxFeedbackImageCount]
	}
	prefix := fmt.Sprintf("user-feedback/%s/", userID)
	out := make([]string, 0, len(urls))
	seen := make(map[string]struct{}, len(urls))
	for _, raw := range urls {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		key := s.storage.ResolveObjectKey(feedbackImageBucketAlias, raw)
		if key == "" || !strings.HasPrefix(key, prefix) {
			continue
		}
		resolved := s.storage.BuildAccessURL(feedbackImageBucketAlias, key)
		if resolved == "" {
			continue
		}
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		out = append(out, resolved)
	}
	return out, nil
}

func normalizeImageExt(ext string) string {
	safeExt := strings.ToLower(strings.TrimSpace(ext))
	if safeExt == "" {
		return ".jpg"
	}
	if !strings.HasPrefix(safeExt, ".") {
		safeExt = filepath.Ext("." + safeExt)
	}
	switch safeExt {
	case ".jpg", ".jpeg", ".png", ".webp", ".gif":
		return safeExt
	default:
		return ".jpg"
	}
}
