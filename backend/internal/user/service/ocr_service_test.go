package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
	"testing"

	. "github.com/agiledragon/gomonkey/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"food_link/backend/pkg/config"
)

func mockOCRResponse() *http.Response {
	content := "```json\n{\"indicators\":[{\"name\":\"血糖\",\"value\":\"5.6\",\"unit\":\"mmol/L\"}],\"conclusions\":[\"正常\"],\"suggestions\":[],\"medical_notes\":\"\"}\n```"
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

func TestOCRService_ExtractFromBase64_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return mockOCRResponse(), nil
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	result, err := svc.ExtractFromBase64(ctx, "data:image/jpeg;base64,abc123")
	require.NoError(t, err)
	assert.NotNil(t, result)
	indicators, ok := result["indicators"].([]any)
	assert.True(t, ok)
	assert.Len(t, indicators, 1)
}

func TestOCRService_ExtractFromURL_Success(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return mockOCRResponse(), nil
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	result, err := svc.ExtractFromURL(ctx, "https://example.com/report.jpg")
	require.NoError(t, err)
	assert.NotNil(t, result)
}

func TestOCRService_ExtractFromBase64_MissingKey(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: ""}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}

func TestOCRService_ExtractFromBase64_HTTPError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}

func TestOCRService_ExtractFromBase64_StatusError(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString("error")),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}

func TestOCRService_ExtractFromBase64_EmptyChoices(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		body := `{"choices":[]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}

func TestOCRService_ExtractFromBase64_InvalidJSON(t *testing.T) {
	patches := ApplyMethod(reflect.TypeOf(&http.Client{}), "Do", func(_ *http.Client, req *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"not json"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})
	defer patches.Reset()

	cfg := &config.Config{External: config.ExternalConfig{DashscopeAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}
