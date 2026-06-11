package service

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"strings"
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

// UploadCoverImage 上传用户主页背景图，先压缩再上传 COS
func (s *UploadService) UploadCoverImage(userID string, base64Image string) (string, error) {
	if base64Image == "" {
		return "", fmt.Errorf("base64Image 不能为空")
	}

	// base64 decode
	raw := base64Image
	if idx := strings.Index(raw, ","); idx != -1 {
		raw = raw[idx+1:]
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return "", fmt.Errorf("base64 decode failed: %w", err)
	}

	// 压缩图片
	compressed, err := compressImage(data, 1200, 85)
	if err != nil {
		return "", fmt.Errorf("图片压缩失败: %w", err)
	}

	key := fmt.Sprintf("%s/covers/%s.jpg", userID, uuid.New().String())
	return s.storage.UploadBytes("user-avatars", key, compressed, "image/jpeg")
}

// compressImage 解码图片，等比缩放至最大宽度，再以 JPEG 编码返回
func compressImage(data []byte, maxWidth int, quality int) ([]byte, error) {
	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("图片解码失败: %w", err)
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// 若宽度未超限且原图已是 JPEG，直接返回原数据以节省 CPU
	if width <= maxWidth && format == "jpeg" {
		return data, nil
	}

	// 等比缩放
	if width > maxWidth {
		ratio := float64(maxWidth) / float64(width)
		newWidth := maxWidth
		newHeight := int(float64(height) * ratio)
		img = resizeImage(img, newWidth, newHeight)
	}

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("JPEG 编码失败: %w", err)
	}
	return buf.Bytes(), nil
}

// resizeImage 使用最近邻插值等比缩放图片（纯标准库实现）
func resizeImage(src image.Image, newWidth, newHeight int) image.Image {
	dst := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
	bounds := src.Bounds()
	oldWidth := bounds.Dx()
	oldHeight := bounds.Dy()

	xRatio := float64(oldWidth) / float64(newWidth)
	yRatio := float64(oldHeight) / float64(newHeight)

	for y := 0; y < newHeight; y++ {
		for x := 0; x < newWidth; x++ {
			srcX := int(float64(x) * xRatio)
			srcY := int(float64(y) * yRatio)
			dst.Set(x, y, src.At(bounds.Min.X+srcX, bounds.Min.Y+srcY))
		}
	}
	return dst
}

func init() {
	// 注册 PNG 解码器（image.Decode 默认已注册 jpeg，显式注册 png 确保可用）
	_ = png.Decode
}
