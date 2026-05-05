package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"food_link/backend/internal/utility/domain"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

type mockLocationService struct {
	reverseData map[string]any
	reverseErr  error
	searchData  map[string]any
	searchErr   error
}

func (m *mockLocationService) ReverseGeocode(ctx context.Context, lat, lng float64) (map[string]any, error) {
	return m.reverseData, m.reverseErr
}
func (m *mockLocationService) SearchAddress(ctx context.Context, keyword string) (map[string]any, error) {
	return m.searchData, m.searchErr
}

type mockQRCodeService struct {
	base64 string
	err    error
}

func (m *mockQRCodeService) GenerateQRCode(ctx context.Context, scene, page string) (string, error) {
	return m.base64, m.err
}

type mockManualFoodService struct {
	browseItems []domain.ManualFood
	browseErr   error
	searchItems []domain.ManualFood
	searchErr   error
}

func (m *mockManualFoodService) Browse(ctx context.Context, category string, limit int) ([]domain.ManualFood, error) {
	return m.browseItems, m.browseErr
}
func (m *mockManualFoodService) Search(ctx context.Context, keyword string, limit int) ([]domain.ManualFood, error) {
	return m.searchItems, m.searchErr
}

func setupRouter(h *UtilityHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/location/reverse", h.LocationReverse)
	r.POST("/api/location/search", h.LocationSearch)
	r.POST("/api/qrcode", h.QRCode)
	r.GET("/api/manual-food/browse", h.ManualFoodBrowse)
	r.GET("/api/manual-food/search", h.ManualFoodSearch)
	return r
}

func TestLocationReverse(t *testing.T) {
	mockLoc := &mockLocationService{reverseData: map[string]any{"address": "Beijing"}}
	h := NewUtilityHandler(mockLoc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]float64{"lat": 39.9, "lon": 116.4})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/location/reverse", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "Beijing", data["address"])
}

func TestLocationSearch(t *testing.T) {
	mockLoc := &mockLocationService{searchData: map[string]any{"pois": []any{}}}
	h := NewUtilityHandler(mockLoc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"keyword": "restaurant"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/location/search", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestQRCode(t *testing.T) {
	mockQR := &mockQRCodeService{base64: "data:image/png;base64,mock"}
	h := NewUtilityHandler(nil, mockQR, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"scene": "test", "page": "pages/index"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/qrcode", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "data:image/png;base64,mock", data["base64"])
}

func TestManualFoodBrowse(t *testing.T) {
	mockFood := &mockManualFoodService{browseItems: []domain.ManualFood{{ID: "f1", Name: "apple"}}}
	h := NewUtilityHandler(nil, nil, mockFood)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/manual-food/browse?category=fruit&limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	items := data["items"].([]any)
	assert.Len(t, items, 1)
}

func TestManualFoodSearch(t *testing.T) {
	mockFood := &mockManualFoodService{searchItems: []domain.ManualFood{{ID: "f1", Name: "green apple"}}}
	h := NewUtilityHandler(nil, nil, mockFood)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/manual-food/search?keyword=apple&limit=5", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	items := data["items"].([]any)
	assert.Len(t, items, 1)
}

func TestLocationReverseError(t *testing.T) {
	mockLoc := &mockLocationService{reverseErr: errors.New("timeout")}
	h := NewUtilityHandler(mockLoc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]float64{"lat": 39.9, "lon": 116.4})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/location/reverse", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
