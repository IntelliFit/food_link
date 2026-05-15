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

func reportImagePath(name string) string {
	return testutil.GetTestdataPath(filepath.Join("health_report", name))
}

func TestHealthReportOCR_WithRealReport_Base64(t *testing.T) {
	base64Image, err := testutil.LoadImageAsBase64(reportImagePath("1.png"))
	assert.NoError(t, err)

	mockSvc := &mockOCRService{
		result: map[string]any{
			"indicators": []any{
				map[string]any{"name": "血糖", "value": "5.6", "unit": "mmol/L"},
			},
			"conclusions": "各项指标正常",
		},
	}
	h := NewUserHandler(&mockUserService{}, nil, nil, mockSvc, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": base64Image})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/user/health-profile/ocr", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
	data := resp["data"].(map[string]any)
	extracted := data["extracted"].(map[string]any)
	assert.Equal(t, "各项指标正常", extracted["conclusions"])
}

func TestHealthReportOCRExtract_WithRealReport_Base64(t *testing.T) {
	base64Image, err := testutil.LoadImageAsBase64(reportImagePath("2.png"))
	assert.NoError(t, err)

	mockSvc := &mockOCRService{
		result: map[string]any{"indicators": []any{}, "conclusions": "未见异常"},
	}
	h := NewUserHandler(&mockUserService{}, nil, nil, mockSvc, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": base64Image})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/user/health-profile/ocr-extract", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestHealthReportOCRExtract_WithRealReport_ImageURL(t *testing.T) {
	mockSvc := &mockOCRService{
		result: map[string]any{"indicators": []any{}, "conclusions": "正常"},
	}
	h := NewUserHandler(&mockUserService{}, nil, nil, mockSvc, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"imageUrl": "https://cdn.example.com/report_3.png"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/user/health-profile/ocr-extract", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, float64(0), resp["code"])
}

func TestHealthReportOCR_WithRealReport_ServiceError(t *testing.T) {
	base64Image, err := testutil.LoadImageAsBase64(reportImagePath("1.png"))
	assert.NoError(t, err)

	mockSvc := &mockOCRService{err: errors.New("ocr service timeout")}
	h := NewUserHandler(&mockUserService{}, nil, nil, mockSvc, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": base64Image})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/user/health-profile/ocr", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestHealthReportOCR_MultipleRealReports(t *testing.T) {
	reports := []string{"1.png", "2.png", "3.png"}

	for _, name := range reports {
		t.Run(name, func(t *testing.T) {
			base64Image, err := testutil.LoadImageAsBase64(reportImagePath(name))
			assert.NoError(t, err)
			assert.NotEmpty(t, base64Image)
			assert.Contains(t, base64Image, "data:image/png;base64,")

			mockSvc := &mockOCRService{
				result: map[string]any{"indicators": []any{}},
			}
			h := NewUserHandler(&mockUserService{}, nil, nil, mockSvc, nil)
			r := setupRouter(h)

			body, _ := json.Marshal(map[string]string{"base64Image": base64Image})
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodPost, "/api/user/health-profile/ocr", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)
			var resp map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &resp)
			assert.Equal(t, float64(0), resp["code"])
		})
	}
}
