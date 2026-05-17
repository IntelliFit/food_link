package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"testing"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type expiryRoundTripFunc func(*http.Request) (*http.Response, error)

func (f expiryRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func newTestExpiryRecognizer(handler expiryRoundTripFunc) *Recognizer {
	recognizer := NewRecognizer(&config.Config{
		External: config.ExternalConfig{
			DoubaoAPIKey: "fake-key",
		},
	})
	recognizer.client = &http.Client{Transport: handler}
	return recognizer
}

func TestRecognizerRecognizeSuccess(t *testing.T) {
	recognizer := newTestExpiryRecognizer(func(req *http.Request) (*http.Response, error) {
		assert.Equal(t, "https://ark.cn-beijing.volces.com/api/v3/chat/completions", req.URL.String())
		var body map[string]any
		require.NoError(t, json.NewDecoder(req.Body).Decode(&body))
		assert.Equal(t, "doubao-seed-2-0-lite-260428", body["model"])
		assert.Equal(t, "medium", body["reasoning_effort"])

		responseBody := `{"choices":[{"message":{"content":"{\"items\":[{\"food_name\":\"牛奶\",\"category\":\"乳制品\",\"storage_type\":\"refrigerated\",\"quantity_note\":\"1盒\",\"expire_date\":\"2026-05-12\",\"confidence\":0.8}]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})

	result, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/milk.jpg"},
	})

	require.NoError(t, err)
	require.Len(t, result.Items, 1)
	assert.Equal(t, "牛奶", result.Items[0]["food_name"])
}

func TestRecognizerRecognizeNoItemsReturnsBadRequest(t *testing.T) {
	recognizer := newTestExpiryRecognizer(func(req *http.Request) (*http.Response, error) {
		responseBody := `{"choices":[{"message":{"content":"{\"items\":[]}"}}]}`
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(bytes.NewBufferString(responseBody)),
			Header:     make(http.Header),
		}, nil
	})

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/not-food.jpg"},
	})

	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusBadRequest, appErr.HTTPStatus)
	assert.Contains(t, appErr.Message, "未识别到可用于保质期录入的食物")
}

func TestRecognizerRecognizeUpstreamErrorReturnsBadGateway(t *testing.T) {
	recognizer := newTestExpiryRecognizer(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusInternalServerError,
			Body:       io.NopCloser(bytes.NewBufferString(`{"error":"bad upstream"}`)),
			Header:     http.Header{"Content-Type": []string{"application/json"}},
		}, nil
	})

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/milk.jpg"},
	})

	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusBadGateway, appErr.HTTPStatus)
	assert.Equal(t, "保质期识别服务暂时不可用，请稍后再试", appErr.Message)
}

func TestRecognizerRecognizeMissingConfigReturnsServerError(t *testing.T) {
	recognizer := NewRecognizer(&config.Config{})

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/milk.jpg"},
	})

	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusInternalServerError, appErr.HTTPStatus)
	assert.Equal(t, "后端未配置保质期识别模型", appErr.Message)
}

func TestRecognizerDoesNotFallbackToOfoxWhenDoubaoMissing(t *testing.T) {
	recognizer := NewRecognizer(&config.Config{
		External: config.ExternalConfig{OfoxAIAPIKey: "fake-ofox-key"},
	})

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/milk.jpg"},
	})

	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusInternalServerError, appErr.HTTPStatus)
	assert.Equal(t, "后端未配置保质期识别模型", appErr.Message)
}
