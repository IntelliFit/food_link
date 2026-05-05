package service

import (
	"context"
	"encoding/base64"
	"fmt"
)

type QRCodeService struct{}

func NewQRCodeService() *QRCodeService {
	return &QRCodeService{}
}

func (s *QRCodeService) GenerateQRCode(ctx context.Context, scene, page string) (string, error) {
	// Stub: return a mock base64 image
	mockBytes := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	b64 := base64.StdEncoding.EncodeToString(mockBytes)
	return fmt.Sprintf("data:image/png;base64,%s", b64), nil
}
