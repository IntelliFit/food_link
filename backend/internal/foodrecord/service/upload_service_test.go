package service

import (
	"fmt"
	"reflect"
	"testing"

	. "github.com/agiledragon/gomonkey/v2"
	"github.com/stretchr/testify/assert"

	"food_link/backend/pkg/storage"
)

func TestUploadService_UploadBase64_Empty(t *testing.T) {
	svc := NewUploadService(&storage.Client{})
	_, err := svc.UploadBase64("")
	assert.Error(t, err)
}

func TestUploadService_UploadBase64_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&storage.Client{}), "UploadBase64", func(_ *storage.Client, bucketAlias, key, base64Image, contentType string) (string, error) {
		return fmt.Sprintf("https://cdn.example.com/%s", key), nil
	})
	defer patches.Reset()

	svc := NewUploadService(&storage.Client{})
	url, err := svc.UploadBase64("data:image/jpeg;base64,abc123")
	assert.NoError(t, err)
	assert.Contains(t, url, "https://cdn.example.com/")
}

func TestUploadService_UploadFile_Empty(t *testing.T) {
	svc := NewUploadService(&storage.Client{})
	_, err := svc.UploadFile([]byte{}, "", "")
	assert.Error(t, err)
}

func TestUploadService_UploadFile_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&storage.Client{}), "UploadBytes", func(_ *storage.Client, bucketAlias, key string, data []byte, contentType string) (string, error) {
		return fmt.Sprintf("https://cdn.example.com/%s", key), nil
	})
	defer patches.Reset()

	svc := NewUploadService(&storage.Client{})
	url, err := svc.UploadFile([]byte{0x01, 0x02}, ".png", "image/png")
	assert.NoError(t, err)
	assert.Contains(t, url, ".png")
}

func TestUploadService_UploadFile_DefaultExt(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&storage.Client{}), "UploadBytes", func(_ *storage.Client, bucketAlias, key string, data []byte, contentType string) (string, error) {
		return fmt.Sprintf("https://cdn.example.com/%s", key), nil
	})
	defer patches.Reset()

	svc := NewUploadService(&storage.Client{})
	url, err := svc.UploadFile([]byte{0x01, 0x02}, "", "")
	assert.NoError(t, err)
	assert.Contains(t, url, ".jpg")
}
