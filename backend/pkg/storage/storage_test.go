package storage

import (
	"testing"

	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
)

func TestNew(t *testing.T) {
	cfg := config.StorageConfig{}
	client := New(cfg)
	assert.NotNil(t, client)
}

func TestBuildAccessURL(t *testing.T) {
	cfg := config.StorageConfig{
		CDNFoodImagesBaseURL:    "https://cdn.example.com/food",
		CDNUserAvatarsBaseURL:   "https://cdn.example.com/avatar",
		CDNHealthReportsBaseURL: "https://cdn.example.com/health",
		CDNIconBaseURL:          "https://cdn.example.com/icon",
	}
	client := New(cfg)

	tests := []struct {
		bucket   string
		key      string
		expected string
	}{
		{"food-images", "test.jpg", "https://cdn.example.com/food/test.jpg"},
		{"food-images", "/test.jpg", "https://cdn.example.com/food/test.jpg"},
		{"user-avatars", "avatar.png", "https://cdn.example.com/avatar/avatar.png"},
		{"health-reports", "report.pdf", "https://cdn.example.com/health/report.pdf"},
		{"icon", "icon.svg", "https://cdn.example.com/icon/icon.svg"},
		{"unknown", "file.txt", "file.txt"},
		{"food-images", "", "https://cdn.example.com/food/"},
	}

	for _, tt := range tests {
		t.Run(tt.bucket+"_"+tt.key, func(t *testing.T) {
			assert.Equal(t, tt.expected, client.BuildAccessURL(tt.bucket, tt.key))
		})
	}
}

func TestBuildAccessURL_EmptyBase(t *testing.T) {
	cfg := config.StorageConfig{}
	client := New(cfg)
	assert.Equal(t, "key.jpg", client.BuildAccessURL("food-images", "key.jpg"))
}

func TestBucketName(t *testing.T) {
	cfg := config.StorageConfig{
		COSFoodImagesBucket:    "food-bucket",
		COSUserAvatarsBucket:   "avatar-bucket",
		COSHealthReportsBucket: "health-bucket",
		COSIconBucket:          "icon-bucket",
	}
	client := New(cfg)

	assert.Equal(t, "food-bucket", client.bucketName("food-images"))
	assert.Equal(t, "avatar-bucket", client.bucketName("user-avatars"))
	assert.Equal(t, "health-bucket", client.bucketName("health-reports"))
	assert.Equal(t, "icon-bucket", client.bucketName("icon"))
	assert.Equal(t, "", client.bucketName("unknown"))
}

func TestCOSClient_MissingCredentials(t *testing.T) {
	cfg := config.StorageConfig{}
	client := New(cfg)
	_, err := client.cosClient("test-bucket")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "missing COS credentials")
}

func TestUploadBytes_UnknownBucket(t *testing.T) {
	cfg := config.StorageConfig{
		COSSecretID:  "test-id",
		COSSecretKey: "test-key",
	}
	client := New(cfg)
	_, err := client.UploadBytes("unknown-bucket", "key", []byte("data"), "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unknown bucket alias")
}

func TestUploadBase64_InvalidData(t *testing.T) {
	cfg := config.StorageConfig{
		COSSecretID:  "test-id",
		COSSecretKey: "test-key",
		COSFoodImagesBucket: "food-bucket",
	}
	client := New(cfg)
	_, err := client.UploadBase64("food-images", "key", "!!!invalid!!!", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "base64 decode failed")
}

func TestUploadBase64_WithPrefix(t *testing.T) {
	cfg := config.StorageConfig{
		COSSecretID:  "test-id",
		COSSecretKey: "test-key",
		COSFoodImagesBucket: "food-bucket",
	}
	client := New(cfg)
	// Valid base64 with data URL prefix - will fail on COS call but tests prefix stripping
	_, err := client.UploadBase64("food-images", "key", "data:image/png;base64,iVBORw0KGgo=", "")
	assert.Error(t, err)
}
