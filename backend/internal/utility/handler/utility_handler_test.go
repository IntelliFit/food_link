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

func (m *mockQRCodeService) GenerateQRCode(ctx context.Context, scene, page string, width int, checkPath bool, envVersion string) (string, error) {
	return m.base64, m.err
}

type mockManualFoodService struct {
	browseItems          *domain.ManualFoodBrowseResult
	browseErr            error
	catalog              *domain.ManualFoodCatalogResult
	catalogErr           error
	searchItems          []domain.ManualFoodResult
	searchErr            error
	searchPackagedItems  []domain.ManualFoodResult
	searchPackagedErr    error
	searchPackagedCalled bool
}

func (m *mockManualFoodService) Browse(ctx context.Context, userID string, limit int) (*domain.ManualFoodBrowseResult, error) {
	return m.browseItems, m.browseErr
}
func (m *mockManualFoodService) Catalog(ctx context.Context, userID string, category string, page int, pageSize int) (*domain.ManualFoodCatalogResult, error) {
	return m.catalog, m.catalogErr
}
func (m *mockManualFoodService) Search(ctx context.Context, userID string, keyword string, limit int) ([]domain.ManualFoodResult, error) {
	return m.searchItems, m.searchErr
}
func (m *mockManualFoodService) SearchPackaged(ctx context.Context, keyword string, limit int) ([]domain.ManualFoodResult, error) {
	m.searchPackagedCalled = true
	return m.searchPackagedItems, m.searchPackagedErr
}

func setupRouter(h *UtilityHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/location/reverse", h.LocationReverse)
	r.POST("/api/location/search", h.LocationSearch)
	r.POST("/api/qrcode", h.QRCode)
	r.GET("/api/manual-food/browse", h.ManualFoodBrowse)
	r.GET("/api/manual-food/catalog", h.ManualFoodCatalog)
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
	mockFood := &mockManualFoodService{browseItems: &domain.ManualFoodBrowseResult{
		PublicLibrary: []domain.ManualFoodResult{{ID: "f1", Title: "apple", Source: "public_library"}},
	}}
	h := NewUtilityHandler(nil, nil, mockFood)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/manual-food/browse?limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	items := data["public_library"].([]any)
	assert.Len(t, items, 1)
}

func TestManualFoodCatalog(t *testing.T) {
	mockFood := &mockManualFoodService{catalog: &domain.ManualFoodCatalogResult{
		Categories: []domain.ManualFoodCatalogCategory{{Key: "common", Label: "常见"}},
		Items:      []domain.ManualFoodResult{{ID: "catalog:米饭", Title: "米饭", Source: "nutrition_library"}},
		Category:   "common",
		Page:       1,
		PageSize:   30,
		HasMore:    true,
	}}
	h := NewUtilityHandler(nil, nil, mockFood)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/manual-food/catalog?category=common&page=1&page_size=30", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "common", data["category"])
	assert.Equal(t, true, data["has_more"])
	assert.Len(t, data["items"].([]any), 1)
}

func TestManualFoodSearch(t *testing.T) {
	mockFood := &mockManualFoodService{searchItems: []domain.ManualFoodResult{{ID: "f1", Title: "green apple", Source: "nutrition_library"}}}
	h := NewUtilityHandler(nil, nil, mockFood)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/manual-food/search?q=apple&limit=5", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	items := data["results"].([]any)
	assert.Len(t, items, 1)
}

func TestManualFoodSearchPackagedOnly(t *testing.T) {
	mockFood := &mockManualFoodService{searchPackagedItems: []domain.ManualFoodResult{{ID: "p1", Title: "雀巢咖啡", Source: "packaged_food"}}}
	h := NewUtilityHandler(nil, nil, mockFood)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/manual-food/search?q=咖啡&limit=5&source=packaged_food", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.True(t, mockFood.searchPackagedCalled)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	items := data["results"].([]any)
	assert.Len(t, items, 1)
	assert.Equal(t, "packaged_food", items[0].(map[string]any)["source"])
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

func TestLocationSearchError(t *testing.T) {
	mockLoc := &mockLocationService{searchErr: errors.New("timeout")}
	h := NewUtilityHandler(mockLoc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"keyword": "restaurant"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/location/search", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestQRCodeBindError(t *testing.T) {
	mockQR := &mockQRCodeService{}
	h := NewUtilityHandler(nil, mockQR, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/qrcode", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestQRCodeError(t *testing.T) {
	mockQR := &mockQRCodeService{err: errors.New("qr error")}
	h := NewUtilityHandler(nil, mockQR, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"scene": "test", "page": "pages/index"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/qrcode", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestManualFoodBrowseError(t *testing.T) {
	mockFood := &mockManualFoodService{browseErr: errors.New("db error")}
	h := NewUtilityHandler(nil, nil, mockFood)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/manual-food/browse?limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestManualFoodSearchError(t *testing.T) {
	mockFood := &mockManualFoodService{searchErr: errors.New("db error")}
	h := NewUtilityHandler(nil, nil, mockFood)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/manual-food/search?q=apple&limit=5", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}
