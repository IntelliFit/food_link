package testutil

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// GetTestdataPath resolves a path relative to backend/testdata/, regardless of
// which package directory go test is running from.
func GetTestdataPath(relativePath string) string {
	_, filename, _, _ := runtime.Caller(0)
	dir := filepath.Dir(filename)   // .../backend/internal/testutil
	dir = filepath.Dir(dir)         // .../backend/internal
	dir = filepath.Dir(dir)         // .../backend
	return filepath.Join(dir, "testdata", relativePath)
}

// LoadImageAsBytes reads an image file from disk and returns its raw bytes.
func LoadImageAsBytes(filePath string) ([]byte, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("load image %s: %w", filePath, err)
	}
	return data, nil
}

// LoadImageAsBase64 reads an image file and returns it as a data URI string
// (e.g. "data:image/jpeg;base64,..."). The MIME type is inferred from the
// file extension.
func LoadImageAsBase64(filePath string) (string, error) {
	data, err := LoadImageAsBytes(filePath)
	if err != nil {
		return "", err
	}
	ext := filepath.Ext(filePath)
	mime := mimeByExtension(ext)
	encoded := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:%s;base64,%s", mime, encoded), nil
}

func mimeByExtension(ext string) string {
	switch ext {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	default:
		return "image/jpeg"
	}
}
