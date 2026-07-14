package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/pkg/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type expiryVisionClientStub struct {
	result      map[string]any
	err         error
	results     []map[string]any
	errors      []error
	calls       int
	prompt      string
	imageURLs   []string
	temperature float64
	model       string
}

func (s *expiryVisionClientStub) AnalyzeWithImagesAndTemperatureModel(_ context.Context, prompt string, imageURLs []string, temperature float64, modelName string) (map[string]any, error) {
	s.calls++
	s.prompt = prompt
	s.imageURLs = append([]string(nil), imageURLs...)
	s.temperature = temperature
	s.model = modelName
	index := s.calls - 1
	if index < len(s.errors) && s.errors[index] != nil {
		return nil, s.errors[index]
	}
	if index < len(s.results) {
		return s.results[index], nil
	}
	return s.result, s.err
}

func newTestExpiryRecognizer(client *expiryVisionClientStub) *Recognizer {
	recognizer := NewRecognizer(&config.Config{})
	recognizer.ConfigureVisionClient(client)
	recognizer.retryDelay = 0
	return recognizer
}

func TestRecognizerRecognizeSuccessUsesGemini35Client(t *testing.T) {
	client := &expiryVisionClientStub{result: map[string]any{
		"items": []any{map[string]any{
			"food_name":     "牛奶",
			"category":      "乳制品",
			"storage_type":  "refrigerated",
			"quantity_note": "1盒",
			"expire_date":   "2026-08-12",
			"confidence":    0.8,
		}},
	}}
	recognizer := newTestExpiryRecognizer(client)

	result, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs:         []string{"https://example.com/milk.jpg"},
		AdditionalContext: "今晚刚买的",
	})

	require.NoError(t, err)
	require.Len(t, result.Items, 1)
	assert.Equal(t, "牛奶", result.Items[0]["food_name"])
	assert.Equal(t, expiryRecognitionModel, client.model)
	assert.Equal(t, []string{"https://example.com/milk.jpg"}, client.imageURLs)
	assert.Equal(t, 0.2, client.temperature)
	assert.Contains(t, client.prompt, "今晚刚买的")
}

func TestRecognizerRecognizeNoItemsReturnsBadRequest(t *testing.T) {
	recognizer := newTestExpiryRecognizer(&expiryVisionClientStub{result: map[string]any{"items": []any{}}})

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/not-food.jpg"},
	})

	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusBadRequest, appErr.HTTPStatus)
	assert.Contains(t, appErr.Message, "未识别到可用于保质期录入的食物")
}

func TestRecognizerRecognizeUpstreamErrorReturnsFriendlyBadGateway(t *testing.T) {
	client := &expiryVisionClientStub{err: errors.New("gemini api error 400: contents is required")}
	recognizer := newTestExpiryRecognizer(client)

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/milk.jpg"},
	})

	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusBadGateway, appErr.HTTPStatus)
	assert.Equal(t, "保质期识别服务暂时不可用，请稍后再试", appErr.Message)
	assert.NotContains(t, strings.ToLower(appErr.Message), "gemini")
	assert.Equal(t, 1, client.calls)
}

func TestRecognizerRetriesTLSHandshakeTimeoutThenSucceeds(t *testing.T) {
	client := &expiryVisionClientStub{
		errors: []error{errors.New(`Post "https://maas-openapi.wanjiedata.com/api/v1beta/models/gemini-3.5-flash:generateContent": net/http: TLS handshake timeout`)},
		results: []map[string]any{nil, {
			"items": []any{map[string]any{
				"food_name":   "鲜奶",
				"expire_date": "2026-07-20",
			}},
		}},
	}
	recognizer := newTestExpiryRecognizer(client)

	result, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/milk.jpg"},
	})

	require.NoError(t, err)
	require.Len(t, result.Items, 1)
	assert.Equal(t, "鲜奶", result.Items[0]["food_name"])
	assert.Equal(t, 2, client.calls)
}

func TestRecognizerRetriesTransientErrorOnlyOnce(t *testing.T) {
	client := &expiryVisionClientStub{
		errors: []error{
			errors.New("net/http: TLS handshake timeout"),
			errors.New("unexpected EOF"),
		},
	}
	recognizer := newTestExpiryRecognizer(client)

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/milk.jpg"},
	})

	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusBadGateway, appErr.HTTPStatus)
	assert.Equal(t, "保质期识别服务暂时不可用，请稍后再试", appErr.Message)
	assert.Equal(t, 2, client.calls)
}

func TestRecognizerDoesNotRetryCanceledContext(t *testing.T) {
	client := &expiryVisionClientStub{err: context.Canceled}
	recognizer := newTestExpiryRecognizer(client)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := recognizer.Recognize(ctx, RecognizeInput{
		ImageURLs: []string{"https://example.com/milk.jpg"},
	})

	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusBadGateway, appErr.HTTPStatus)
	assert.Equal(t, 1, client.calls)
}

func TestRecognizerRecognizeMissingClientReturnsServerError(t *testing.T) {
	recognizer := NewRecognizer(&config.Config{})

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{
		ImageURLs: []string{"https://example.com/milk.jpg"},
	})

	var appErr *commonerrors.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, http.StatusInternalServerError, appErr.HTTPStatus)
	assert.Equal(t, "后端未配置保质期识别模型", appErr.Message)
}

func TestRecognizerPinsGemini35Model(t *testing.T) {
	client := &expiryVisionClientStub{result: map[string]any{
		"items": []any{map[string]any{"food_name": "酸奶", "expire_date": "2026-08-12"}},
	}}
	recognizer := NewRecognizer(&config.Config{External: config.ExternalConfig{Gemini35Model: "wrong-model"}})
	recognizer.ConfigureVisionClient(client)

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{ImageURLs: []string{"https://example.com/yogurt.jpg"}})

	require.NoError(t, err)
	assert.Equal(t, expiryRecognitionModel, client.model)
}
