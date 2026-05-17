package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"food_link/backend/pkg/config"
)

type ocrRoundTripFunc func(*http.Request) (*http.Response, error)

func (f ocrRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

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
	cfg := &config.Config{External: config.ExternalConfig{DoubaoAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	svc.client = &http.Client{Transport: ocrRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https://ark.cn-beijing.volces.com/api/v3/chat/completions", req.URL.String())
		var payload map[string]any
		require.NoError(t, json.NewDecoder(req.Body).Decode(&payload))
		assert.Equal(t, "doubao-seed-2-0-lite-260428", payload["model"])
		return mockOCRResponse(), nil
	})}
	ctx := context.Background()

	result, err := svc.ExtractFromBase64(ctx, "data:image/jpeg;base64,abc123")
	require.NoError(t, err)
	assert.NotNil(t, result)
	indicators, ok := result["indicators"].([]any)
	assert.True(t, ok)
	assert.Len(t, indicators, 1)
}

func TestOCRService_ExtractFromURL_Success(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{DoubaoAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	svc.client = &http.Client{Transport: ocrRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		return mockOCRResponse(), nil
	})}
	ctx := context.Background()

	result, err := svc.ExtractFromURL(ctx, "https://example.com/report.jpg")
	require.NoError(t, err)
	assert.NotNil(t, result)
}

func TestOCRService_ExtractFromBase64_MissingKey(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{DoubaoAPIKey: ""}}
	svc := NewOCRService(cfg)
	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}

func TestOCRService_ExtractFromBase64_HTTPError(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{DoubaoAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	svc.client = &http.Client{Transport: ocrRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return nil, assert.AnError
	})}

	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}

func TestOCRService_ExtractFromBase64_StatusError(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{DoubaoAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	svc.client = &http.Client{Transport: ocrRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString("error")),
			Header:     make(http.Header),
		}, nil
	})}

	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}

func TestOCRService_ExtractFromBase64_EmptyChoices(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{DoubaoAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	svc.client = &http.Client{Transport: ocrRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		body := `{"choices":[]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}

func TestOCRService_ExtractFromBase64_InvalidJSON(t *testing.T) {
	cfg := &config.Config{External: config.ExternalConfig{DoubaoAPIKey: "fake-key"}}
	svc := NewOCRService(cfg)
	svc.client = &http.Client{Transport: ocrRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		body := `{"choices":[{"message":{"content":"not json"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(body)),
			Header:     make(http.Header),
		}, nil
	})}

	ctx := context.Background()

	_, err := svc.ExtractFromBase64(ctx, "base64data")
	assert.Error(t, err)
}
