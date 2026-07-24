package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOpenAIImageEditClientSendsPixelArtEditAndDecodesBase64(t *testing.T) {
	expectedImage := []byte("generated-png")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/images/edits", r.URL.Path)
		assert.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		require.NoError(t, r.ParseMultipartForm(2<<20))
		assert.Equal(t, "gpt-image-2", r.FormValue("model"))
		assert.Equal(t, "low", r.FormValue("quality"))
		assert.Equal(t, "1024x1024", r.FormValue("size"))
		assert.Equal(t, "transparent", r.FormValue("background"))
		assert.Equal(t, "png", r.FormValue("output_format"))
		prompt := r.FormValue("prompt")
		assert.Contains(t, prompt, "detailed high-resolution 16-bit pixel art")
		assert.Contains(t, prompt, "rather than coarse mosaic blocks")
		assert.Contains(t, prompt, "no white border")
		assert.Contains(t, prompt, "transparent background")

		file, _, err := r.FormFile("image")
		require.NoError(t, err)
		defer file.Close()
		uploaded, err := io.ReadAll(file)
		require.NoError(t, err)
		assert.Equal(t, []byte("source-image"), uploaded)

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{
				{"b64_json": base64.StdEncoding.EncodeToString(expectedImage)},
			},
		}))
	}))
	defer server.Close()

	client := NewOpenAIImageEditClient("test-key", server.URL, "gpt-image-2")
	client.httpClient.Timeout = 3 * time.Second
	generated, err := client.GeneratePixelAvatar(context.Background(), []byte("source-image"))
	require.NoError(t, err)
	assert.Equal(t, expectedImage, generated)
}

func TestOpenAIImageEditClientRetriesRawAuthorizationForVendorCompatibility(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		assert.Equal(t, "test-key", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString([]byte("ok")) + `"}]}`))
	}))
	defer server.Close()

	client := NewOpenAIImageEditClient("test-key", server.URL, "gpt-image-2")
	generated, err := client.GeneratePixelAvatar(context.Background(), []byte("source-image"))
	require.NoError(t, err)
	assert.Equal(t, []byte("ok"), generated)
	assert.Equal(t, int32(2), requests.Load())
}
