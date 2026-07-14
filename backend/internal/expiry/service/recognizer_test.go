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
	calls       int
	sourceType  string
	prompt      string
	imageURLs   []string
	temperature float64
	model       string
}

func (s *expiryVisionClientStub) RunPrecisionJSONWithImagesTemperature(_ context.Context, sourceType, prompt string, imageURLs []string, modelName string, temperature float64) (map[string]any, error) {
	s.calls++
	s.sourceType = sourceType
	s.prompt = prompt
	s.imageURLs = append([]string(nil), imageURLs...)
	s.temperature = temperature
	s.model = modelName
	return s.result, s.err
}

func newTestExpiryRecognizer(client *expiryVisionClientStub) *Recognizer {
	recognizer := NewRecognizer(&config.Config{})
	recognizer.ConfigureVisionClient(client)
	return recognizer
}

func TestRecognizerRecognizeSuccessUsesGemini35AnalysisPath(t *testing.T) {
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
	assert.Equal(t, "image", client.sourceType)
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
	client := &expiryVisionClientStub{err: errors.New("Gemini 3.5 和 Qwen 3.6 均调用失败")}
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

func TestRecognizerPinsGemini35PrimaryModel(t *testing.T) {
	client := &expiryVisionClientStub{result: map[string]any{
		"items": []any{map[string]any{"food_name": "酸奶", "expire_date": "2026-08-12"}},
	}}
	recognizer := NewRecognizer(&config.Config{External: config.ExternalConfig{Gemini35Model: "wrong-model"}})
	recognizer.ConfigureVisionClient(client)

	_, err := recognizer.Recognize(context.Background(), RecognizeInput{ImageURLs: []string{"https://example.com/yogurt.jpg"}})

	require.NoError(t, err)
	assert.Equal(t, expiryRecognitionModel, client.model)
}
