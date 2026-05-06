package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"strings"
	"testing"

	. "github.com/agiledragon/gomonkey/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"food_link/backend/internal/testutil"
	"food_link/backend/pkg/config"
)

// mockOCRResponseWithContent returns an HTTP response with the given LLM content.
func mockOCRResponseWithContent(content string) *http.Response {
	bodyMap := map[string]any{
		"choices": []map[string]any{
			{"message": map[string]string{"content": content}},
		},
	}
	bodyBytes, _ := json.Marshal(bodyMap)
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(bytes.NewReader(bodyBytes)),
		Header:     make(http.Header),
	}
}

func TestOCRService_ExtractFromRealReport_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return mockOCRResponse(), nil
	})
	defer patches.Reset()

	base64Image, err := testutil.LoadImageAsBase64(
		testutil.GetTestdataPath("health_report/1.png"),
	)
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(base64Image, "data:image/png;base64,"))

	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	result, err := svc.ExtractFromBase64(ctx, base64Image)
	require.NoError(t, err)
	assert.NotNil(t, result)
	indicators, ok := result["indicators"].([]any)
	assert.True(t, ok)
	assert.Len(t, indicators, 1)
}

func TestOCRService_ExtractFromRealReport_MultipleImages(t *testing.T) {
	reports := []string{"1.png", "2.png", "3.png"}

	for _, name := range reports {
		t.Run(name, func(t *testing.T) {
			patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
				return mockOCRResponse(), nil
			})
			defer patches.Reset()

			base64Image, err := testutil.LoadImageAsBase64(
				testutil.GetTestdataPath("health_report/" + name),
			)
			require.NoError(t, err)
			assert.NotEmpty(t, base64Image)

			cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
			svc := NewOCRService(cfg)
			ctx := context.Background()

			result, err := svc.ExtractFromBase64(ctx, base64Image)
			require.NoError(t, err)
			assert.NotNil(t, result)
		})
	}
}

func TestOCRService_ExtractFromRealReport_URLMode(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return mockOCRResponse(), nil
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	result, err := svc.ExtractFromURL(ctx, "https://cdn.example.com/health_report_1.png")
	require.NoError(t, err)
	assert.NotNil(t, result)
}

func TestOCRService_ExtractFromRealReport_ComplexIndicators(t *testing.T) {
	content := "```json\n{\"indicators\":[{\"name\":\"白细胞\",\"value\":\"7.2\",\"unit\":\"10^9/L\",\"flag\":\"\"},{\"name\":\"红细胞\",\"value\":\"4.8\",\"unit\":\"10^12/L\",\"flag\":\"\"},{\"name\":\"血红蛋白\",\"value\":\"145\",\"unit\":\"g/L\",\"flag\":\"↑\"}],\"conclusions\":[\"血常规未见明显异常\"],\"suggestions\":[\"建议定期复查\"],\"medical_notes\":\"体检日期: 2025-01-15\"}\n```"
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return mockOCRResponseWithContent(content), nil
	})
	defer patches.Reset()

	base64Image, err := testutil.LoadImageAsBase64(
		testutil.GetTestdataPath("health_report/2.png"),
	)
	require.NoError(t, err)

	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	result, err := svc.ExtractFromBase64(ctx, base64Image)
	require.NoError(t, err)

	indicators, ok := result["indicators"].([]any)
	assert.True(t, ok)
	assert.Len(t, indicators, 3)

	conclusions, ok := result["conclusions"].([]any)
	assert.True(t, ok)
	assert.Len(t, conclusions, 1)
	assert.Equal(t, "血常规未见明显异常", conclusions[0])

	suggestions, ok := result["suggestions"].([]any)
	assert.True(t, ok)
	assert.Len(t, suggestions, 1)

	notes := result["medical_notes"].(string)
	assert.Equal(t, "体检日期: 2025-01-15", notes)
}
