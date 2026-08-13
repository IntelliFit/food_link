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

func TestResolveReferenceURL(t *testing.T) {
	cfg := config.StorageConfig{
		CDNFoodImagesBaseURL: "https://cdn.example.com/food",
		COSFoodImagesBucket:  "food-bucket",
		COSRegion:            "ap-shanghai",
	}
	client := New(cfg)

	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "raw key",
			input:    "08bf6bc862384f0888fbf25958d0501b.jpg",
			expected: "https://cdn.example.com/food/08bf6bc862384f0888fbf25958d0501b.jpg",
		},
		{
			name:     "supabase public url",
			input:    "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/food-images/08bf6bc862384f0888fbf25958d0501b.jpg",
			expected: "https://cdn.example.com/food/08bf6bc862384f0888fbf25958d0501b.jpg",
		},
		{
			name:     "cdn url",
			input:    "https://cdn.example.com/food/08bf6bc862384f0888fbf25958d0501b.jpg",
			expected: "https://cdn.example.com/food/08bf6bc862384f0888fbf25958d0501b.jpg",
		},
		{
			name:     "cos origin url",
			input:    "https://food-bucket.cos.ap-shanghai.myqcloud.com/08bf6bc862384f0888fbf25958d0501b.jpg",
			expected: "https://cdn.example.com/food/08bf6bc862384f0888fbf25958d0501b.jpg",
		},
		{
			name:     "untrusted public url",
			input:    "https://images.example.com/other.jpg",
			expected: "https://images.example.com/other.jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, client.ResolveReferenceURL("food-images", tt.input))
		})
	}
}

func TestResolveReferenceURL_AllBuckets(t *testing.T) {
	cfg := config.StorageConfig{
		CDNFoodImagesBaseURL:    "https://cdn.example.com/food",
		CDNUserAvatarsBaseURL:   "https://cdn.example.com/avatar",
		CDNHealthReportsBaseURL: "https://cdn.example.com/health",
		CDNIconBaseURL:          "https://cdn.example.com/icon",
		COSFoodImagesBucket:     "food-images-1370036754",
		COSUserAvatarsBucket:    "user-avatars-1370036754",
		COSHealthReportsBucket:  "health-reports-1370036754",
		COSIconBucket:           "icon-1370036754",
		COSRegion:               "ap-shanghai",
	}
	client := New(cfg)

	tests := []struct {
		name     string
		bucket   string
		input    string
		expected string
	}{
		{
			name:     "legacy avatar supabase url",
			bucket:   "user-avatars",
			input:    "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/user-avatars/u1/avatar.jpg",
			expected: "https://cdn.example.com/avatar/u1/avatar.jpg",
		},
		{
			name:     "legacy health report supabase url",
			bucket:   "health-reports",
			input:    "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/health-reports/u1/report.jpg",
			expected: "https://cdn.example.com/health/u1/report.jpg",
		},
		{
			name:     "legacy icon supabase url",
			bucket:   "icon",
			input:    "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/icon/shitan-nobackground.png",
			expected: "https://cdn.example.com/icon/shitan-nobackground.png",
		},
		{
			name:     "target bucket name in legacy public path",
			bucket:   "user-avatars",
			input:    "https://ocijuywmkalfmfxquzzf.supabase.co/storage/v1/object/public/user-avatars-1370036754/u1/avatar.jpg",
			expected: "https://cdn.example.com/avatar/u1/avatar.jpg",
		},
		{
			name:     "target cos origin url",
			bucket:   "icon",
			input:    "https://icon-1370036754.cos.ap-shanghai.myqcloud.com/shitan-nobackground.png",
			expected: "https://cdn.example.com/icon/shitan-nobackground.png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, client.ResolveReferenceURL(tt.bucket, tt.input))
		})
	}
}

func TestResolveReferenceURLs(t *testing.T) {
	client := New(config.StorageConfig{CDNUserAvatarsBaseURL: "https://cdn.example.com/avatar"})
	input := []string{" u1/a.jpg ", "u1/a.jpg", "", "u1/b.jpg"}
	assert.Equal(t, []string{
		"https://cdn.example.com/avatar/u1/a.jpg",
		"https://cdn.example.com/avatar/u1/b.jpg",
	}, client.ResolveReferenceURLs("user-avatars", input))
}

func TestBuildImageThumbnailURL(t *testing.T) {
	client := New(config.StorageConfig{
		CDNFoodImagesBaseURL: "https://cdn.example.com/food",
		COSFoodImagesBucket:  "food-bucket",
		COSRegion:            "ap-shanghai",
	})

	tests := []struct {
		name     string
		input    string
		width    int
		expected string
	}{
		{
			name:     "raw key resolves to CDN thumbnail",
			input:    "users/u1/meal.jpg",
			width:    240,
			expected: "https://cdn.example.com/food/users/u1/meal.jpg?imageMogr2/thumbnail/240x",
		},
		{
			name:     "existing query is preserved",
			input:    "https://cdn.example.com/food/meal.jpg?version=2",
			width:    240,
			expected: "https://cdn.example.com/food/meal.jpg?version=2&imageMogr2/thumbnail/240x",
		},
		{
			name:     "existing COS transform is not duplicated",
			input:    "https://cdn.example.com/food/meal.jpg?imageMogr2/thumbnail/120x",
			width:    240,
			expected: "https://cdn.example.com/food/meal.jpg?imageMogr2/thumbnail/120x",
		},
		{
			name:     "untrusted external image is unchanged",
			input:    "https://images.example.net/meal.jpg",
			width:    240,
			expected: "https://images.example.net/meal.jpg",
		},
		{
			name:     "invalid width leaves resolved image unchanged",
			input:    "meal.jpg",
			width:    0,
			expected: "https://cdn.example.com/food/meal.jpg",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, client.BuildImageThumbnailURL("food-images", tt.input, tt.width))
		})
	}
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
		COSSecretID:         "test-id",
		COSSecretKey:        "test-key",
		COSFoodImagesBucket: "food-bucket",
	}
	client := New(cfg)
	_, err := client.UploadBase64("food-images", "key", "!!!invalid!!!", "")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "base64 decode failed")
}

func TestUploadBase64_WithPrefix(t *testing.T) {
	cfg := config.StorageConfig{
		COSSecretID:         "test-id",
		COSSecretKey:        "test-key",
		COSFoodImagesBucket: "food-bucket",
	}
	client := New(cfg)
	// Valid base64 with data URL prefix - will fail on COS call but tests prefix stripping
	_, err := client.UploadBase64("food-images", "key", "data:image/png;base64,iVBORw0KGgo=", "")
	assert.Error(t, err)
}
