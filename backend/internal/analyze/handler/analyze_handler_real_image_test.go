package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"food_link/backend/internal/testutil"

	"github.com/stretchr/testify/assert"
)

func foodImagePath(name string) string {
	return testutil.GetTestdataPath(filepath.Join("food", name))
}

func TestAnalyze_WithRealFoodImage_Base64(t *testing.T) {
	base64Image, err := testutil.LoadImageAsBase64(foodImagePath("6781F1707431AC4E3BAB1416242E433D.jpg"))
	assert.NoError(t, err)

	mockSvc := &mockAnalyzeService{
		analyzeResult: map[string]any{
			"description": "一碗米饭配炒菜",
			"items":       []any{map[string]any{"name": "米饭", "calories": 200}},
		},
	}
	h := NewAnalyzeHandler(mockSvc, &mockTaskService{}, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": base64Image})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
	data := resp["data"].(map[string]any)
	assert.Equal(t, "一碗米饭配炒菜", data["description"])
}

func TestAnalyze_WithRealFoodImage_ImageURL(t *testing.T) {
	mockSvc := &mockAnalyzeService{
		analyzeResult: map[string]any{"description": "测试食物"},
	}
	h := NewAnalyzeHandler(mockSvc, &mockTaskService{}, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"image_url": "https://example.com/real_food.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestAnalyzeCompare_WithRealFoodImages(t *testing.T) {
	base64Image, err := testutil.LoadImageAsBase64(foodImagePath("9F1F4BC7A2986BBFEFE4854FFA939035.jpg"))
	assert.NoError(t, err)

	mockSvc := &mockAnalyzeService{
		analyzeCompareResult: map[string]any{
			"qwen":   map[string]any{"description": "Qwen分析结果"},
			"gemini": map[string]any{"description": "Gemini分析结果"},
		},
	}
	h := NewAnalyzeHandler(mockSvc, &mockTaskService{}, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": base64Image})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze-compare", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
	data := resp["data"].(map[string]any)
	assert.Contains(t, data, "qwen")
	assert.Contains(t, data, "gemini")
}

func TestAnalyze_WithRealFoodImage_ServiceError(t *testing.T) {
	base64Image, err := testutil.LoadImageAsBase64(foodImagePath("6781F1707431AC4E3BAB1416242E433D.jpg"))
	assert.NoError(t, err)

	mockSvc := &mockAnalyzeService{
		analyzeErr: errors.New("llm service unavailable"),
	}
	h := NewAnalyzeHandler(mockSvc, &mockTaskService{}, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": base64Image})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestAnalyze_WithInvalidBase64(t *testing.T) {
	mockSvc := &mockAnalyzeService{}
	h := NewAnalyzeHandler(mockSvc, &mockTaskService{}, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": "not-valid-base64!!!"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	// Handler passes the base64 to the service; the service decides if it's valid.
	// The mock service just returns success, so we expect 200 here.
	assert.Equal(t, http.StatusOK, w.Code)
}

func TestAnalyze_MultipleRealFoodImages(t *testing.T) {
	images := []string{
		"6781F1707431AC4E3BAB1416242E433D.jpg",
		"9F1F4BC7A2986BBFEFE4854FFA939035.jpg",
	}

	for _, img := range images {
		t.Run(img, func(t *testing.T) {
			base64Image, err := testutil.LoadImageAsBase64(foodImagePath(img))
			assert.NoError(t, err)
			assert.NotEmpty(t, base64Image)
			assert.Contains(t, base64Image, "data:image/jpeg;base64,")

			mockSvc := &mockAnalyzeService{
				analyzeResult: map[string]any{"description": "ok"},
			}
			h := NewAnalyzeHandler(mockSvc, &mockTaskService{}, "admin-key")
			r := setupRouter(h)

			body, _ := json.Marshal(map[string]string{"base64Image": base64Image})
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodPost, "/api/analyze", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)
			var resp map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &resp)
			assert.Equal(t, float64(0), resp["code"])
		})
	}
}

func TestAnalyzeBatch_WithRealFoodImages(t *testing.T) {
	img1, err := testutil.LoadImageAsBase64(foodImagePath("6781F1707431AC4E3BAB1416242E433D.jpg"))
	assert.NoError(t, err)
	img2, err := testutil.LoadImageAsBase64(foodImagePath("9F1F4BC7A2986BBFEFE4854FFA939035.jpg"))
	assert.NoError(t, err)

	mockSvc := &mockAnalyzeService{
		analyzeBatchResult: map[string]any{"batch_result": "ok"},
	}
	mockTask := &mockTaskService{batchTaskID: "batch-123"}
	h := NewAnalyzeHandler(mockSvc, mockTask, "admin-key")
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"image_urls": []string{img1, img2},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/analyze/batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}
