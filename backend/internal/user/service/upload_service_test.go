package service

import (
	"fmt"
	"reflect"
	"testing"

	. "github.com/agiledragon/gomonkey/v2"
	"github.com/stretchr/testify/assert"

	"food_link/backend/pkg/storage"
)

func TestUserUploadService_UploadAvatar_Empty(t *testing.T) {
	svc := NewUploadService(&storage.Client{})
	_, err := svc.UploadAvatar("user1", "")
	assert.Error(t, err)
}

func TestUserUploadService_UploadAvatar_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&storage.Client{}), "UploadBase64", func(_ *storage.Client, bucketAlias, key, base64Image, contentType string) (string, error) {
		return fmt.Sprintf("https://cdn.example.com/%s", key), nil
	})
	defer patches.Reset()

	svc := NewUploadService(&storage.Client{})
	url, err := svc.UploadAvatar("user1", "data:image/jpeg;base64,abc123")
	assert.NoError(t, err)
	assert.Contains(t, url, "user1/")
}

func TestUserUploadService_UploadReportImage_Empty(t *testing.T) {
	svc := NewUploadService(&storage.Client{})
	_, err := svc.UploadReportImage("user1", "")
	assert.Error(t, err)
}

func TestUserUploadService_UploadReportImage_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&storage.Client{}), "UploadBase64", func(_ *storage.Client, bucketAlias, key, base64Image, contentType string) (string, error) {
		return fmt.Sprintf("https://cdn.example.com/%s", key), nil
	})
	defer patches.Reset()

	svc := NewUploadService(&storage.Client{})
	url, err := svc.UploadReportImage("user1", "data:image/jpeg;base64,abc123")
	assert.NoError(t, err)
	assert.Contains(t, url, "user1/")
}
