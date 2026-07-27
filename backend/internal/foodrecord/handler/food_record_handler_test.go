package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockFoodRecordService struct {
	saveRecord              *domain.FoodRecord
	saveErr                 error
	saveInput               *service.SaveFoodRecordInput
	listRecords             []domain.FoodRecord
	listErr                 error
	getRecord               *domain.FoodRecord
	getErr                  error
	updateRecord            *domain.FoodRecord
	updateErr               error
	updateInput             *service.UpdateFoodRecordInput
	deleteErr               error
	shareRecord             *domain.FoodRecord
	shareErr                error
	saveCriticalSamplesErr  error
	recommendMealType       string
	recommendMealTypeSource string
	recommendMealTypeErr    error
	recommendMealTypeInput  struct {
		userID string
		date   string
	}
}

func (m *mockFoodRecordService) Save(ctx context.Context, userID string, input service.SaveFoodRecordInput) (*domain.FoodRecord, error) {
	m.saveInput = &input
	return m.saveRecord, m.saveErr
}
func (m *mockFoodRecordService) List(ctx context.Context, userID, date string) ([]domain.FoodRecord, error) {
	return m.listRecords, m.listErr
}
func (m *mockFoodRecordService) Get(ctx context.Context, userID, recordID string) (*domain.FoodRecord, error) {
	return m.getRecord, m.getErr
}
func (m *mockFoodRecordService) Update(ctx context.Context, userID, recordID string, input service.UpdateFoodRecordInput) (*domain.FoodRecord, error) {
	m.updateInput = &input
	return m.updateRecord, m.updateErr
}
func (m *mockFoodRecordService) Delete(ctx context.Context, userID, recordID string) error {
	return m.deleteErr
}
func (m *mockFoodRecordService) Share(ctx context.Context, recordID string) (*domain.FoodRecord, error) {
	return m.shareRecord, m.shareErr
}
func (m *mockFoodRecordService) SaveCriticalSamples(ctx context.Context, userID string, items []domain.CriticalSample) error {
	return m.saveCriticalSamplesErr
}
func (m *mockFoodRecordService) GetEntryDistribution(ctx context.Context, userID, startDate, endDate string) (*service.EntryDistributionResult, error) {
	return nil, nil
}
func (m *mockFoodRecordService) RecommendMealType(ctx context.Context, userID string, date string, refTime *time.Time) (string, string, error) {
	m.recommendMealTypeInput.userID = userID
	m.recommendMealTypeInput.date = date
	return m.recommendMealType, m.recommendMealTypeSource, m.recommendMealTypeErr
}

type mockUploadService struct {
	url string
	err error
}

func (m *mockUploadService) UploadBase64(base64Image string) (string, error) {
	return m.url, m.err
}
func (m *mockUploadService) UploadFile(fileBytes []byte, ext, contentType string) (string, error) {
	return m.url, m.err
}

type mockNutritionService struct {
	items                    []map[string]any
	logs                     []domain.FoodUnresolvedLog
	item                     *domain.PackagedFood
	err                      error
	submitPackagedExtractErr error
	submitPackagedInputs     []service.SubmitPackagedProductExtractInput
}

func (m *mockNutritionService) Search(ctx context.Context, query string, limit int) ([]map[string]any, error) {
	return m.items, m.err
}
func (m *mockNutritionService) GetUnresolvedTop(ctx context.Context, limit int) ([]domain.FoodUnresolvedLog, error) {
	return m.logs, m.err
}
func (m *mockNutritionService) CreatePackagedFood(ctx context.Context, input service.PackagedFoodInput) (*domain.PackagedFood, error) {
	if m.item != nil || m.err != nil {
		return m.item, m.err
	}
	return &domain.PackagedFood{ID: "p1", ProductName: input.ProductName, NetWeightG: input.NetWeightG, IsActive: true}, nil
}
func (m *mockNutritionService) RecognizePackagedNutritionLabel(ctx context.Context, imageURL string) (*service.PackagedNutritionLabelResult, error) {
	if m.err != nil {
		return nil, m.err
	}
	return &service.PackagedNutritionLabelResult{KcalPer100g: 420, ProteinPer100g: 12, SodiumMgPer100g: 280, RawText: imageURL}, nil
}
func (m *mockNutritionService) SubmitPackagedNutritionLabelTask(ctx context.Context, userID, imageURL string) (string, error) {
	if m.err != nil {
		return "", m.err
	}
	return "label-task-1", nil
}
func (m *mockNutritionService) SubmitPackagedProductExtractTask(ctx context.Context, userID string, input service.SubmitPackagedProductExtractInput) (string, error) {
	m.submitPackagedInputs = append(m.submitPackagedInputs, input)
	if m.submitPackagedExtractErr != nil {
		return "", m.submitPackagedExtractErr
	}
	if m.err != nil {
		return "", m.err
	}
	return "packaged-extract-task-1", nil
}

func setupRouter(h *FoodRecordHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("user_id", "test-user-id")
		c.Next()
	})
	r.POST("/api/food-record/save", h.SaveFoodRecord)
	r.GET("/api/food-record/list", h.ListFoodRecords)
	r.GET("/api/food-record/recommend-meal-type", h.RecommendMealType)
	r.GET("/api/food-record/:record_id", h.GetFoodRecord)
	r.PUT("/api/food-record/:record_id", h.UpdateFoodRecord)
	r.DELETE("/api/food-record/:record_id", h.DeleteFoodRecord)
	r.OPTIONS("/api/food-record/share/:record_id", h.ShareFoodRecordOptions)
	r.GET("/api/food-record/share/:record_id", h.ShareFoodRecord)
	r.GET("/share/food-record/:record_id", h.ShareFoodRecordPage)
	r.POST("/api/upload-analyze-image", h.UploadAnalyzeImage)
	r.POST("/api/upload-analyze-image-file", h.UploadAnalyzeImageFile)
	r.GET("/api/food-nutrition/search", h.SearchFoodNutrition)
	r.GET("/api/food-nutrition/unresolved/top", h.GetUnresolvedTop)
	r.POST("/api/packaged-food", h.CreatePackagedFood)
	r.POST("/api/packaged-food/nutrition-label/recognize", h.RecognizePackagedNutritionLabel)
	r.POST("/api/packaged-food/nutrition-label/submit", h.SubmitPackagedNutritionLabelTask)
	r.POST("/api/packaged-food/extract/submit", h.SubmitPackagedProductExtractTask)
	r.POST("/api/critical-samples", h.SaveCriticalSamples)
	return r
}

func TestSaveFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{saveRecord: &domain.FoodRecord{ID: "r1"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"meal_type": "lunch"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/food-record/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "r1", data["id"])
	assert.Equal(t, "记录成功", data["message"])
}

func TestSaveFoodRecordRoundsFloatTotalWeight(t *testing.T) {
	mockSvc := &mockFoodRecordService{saveRecord: &domain.FoodRecord{ID: "r1"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"meal_type":          "dinner",
		"total_weight_grams": 126.15,
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/food-record/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, mockSvc.saveInput)
	assert.Equal(t, 126, mockSvc.saveInput.TotalWeightGrams)
}

func TestSaveFoodRecordPassesEatingMood(t *testing.T) {
	mockSvc := &mockFoodRecordService{saveRecord: &domain.FoodRecord{ID: "r1"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"meal_type": "lunch", "eating_mood": "calm"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/food-record/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, mockSvc.saveInput)
	require.NotNil(t, mockSvc.saveInput.EatingMood)
	assert.Equal(t, "calm", *mockSvc.saveInput.EatingMood)
}

func TestUpdateFoodRecordRoundsFloatTotalWeight(t *testing.T) {
	mockSvc := &mockFoodRecordService{updateRecord: &domain.FoodRecord{ID: "r1"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"total_weight_grams": 88.88,
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/food-record/r1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, mockSvc.updateInput)
	require.NotNil(t, mockSvc.updateInput.TotalWeightGrams)
	assert.Equal(t, 89, *mockSvc.updateInput.TotalWeightGrams)
}

func TestSaveFoodRecordPreservesPackagedAnalysisMetadata(t *testing.T) {
	mockSvc := &mockFoodRecordService{saveRecord: &domain.FoodRecord{ID: "r1"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"meal_type": "lunch",
		"items": []map[string]any{{
			"name":                      "雀巢咖啡1+2奶香",
			"weight":                    52.5,
			"ratio":                     75,
			"intake":                    39.375,
			"gross_weight_grams":        105,
			"edible_portion_ratio":      1,
			"edible_portion_reason":     "完整包装",
			"edible_portion_source":     "vision",
			"suggested_ratio":           75,
			"suggested_ratio_reason":    "建议少喝一些",
			"suggested_ratio_source":    "ai",
			"water_ml":                  0,
			"nutrition_source":          "packaged_food_library",
			"nutrition_source_category": "database",
			"matched_food_id":           "nutrition:coffee",
			"packaged_food_id":          "packaged:nescafe-105g",
			"package_match_status":      "matched",
			"package_match_confidence":  0.96,
			"package_weight_source":     "packaged_food_library",
			"package_weight_applied":    true,
			"package_weight_reason":     "命中包装库净含量105g",
			"packaged_candidates":       []map[string]any{{"id": "packaged:nescafe-105g", "net_weight_g": 105}},
			"nutrients":                 map[string]any{"calories": 52.5, "protein": 1, "carbs": 10, "fat": 1},
		}},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/food-record/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	if assert.NotNil(t, mockSvc.saveInput) && assert.Len(t, mockSvc.saveInput.Items, 1) {
		item := mockSvc.saveInput.Items[0]
		assert.Equal(t, "雀巢咖啡1+2奶香", item.Name)
		assert.Equal(t, 52.5, item.Weight)
		assert.Equal(t, 105.0, item.GrossWeightGrams)
		if assert.NotNil(t, item.SuggestedRatioSource) {
			assert.Equal(t, "ai", *item.SuggestedRatioSource)
		}
		if assert.NotNil(t, item.NutritionSource) {
			assert.Equal(t, "packaged_food_library", *item.NutritionSource)
		}
		if assert.NotNil(t, item.NutritionSourceCategory) {
			assert.Equal(t, "database", *item.NutritionSourceCategory)
		}
		if assert.NotNil(t, item.PackagedFoodID) {
			assert.Equal(t, "packaged:nescafe-105g", *item.PackagedFoodID)
		}
		if assert.NotNil(t, item.PackageWeightApplied) {
			assert.True(t, *item.PackageWeightApplied)
		}
		assert.Len(t, item.PackagedCandidates, 1)
	}
}

func TestListFoodRecords(t *testing.T) {
	mockSvc := &mockFoodRecordService{listRecords: []domain.FoodRecord{{ID: "r1", MealType: "breakfast"}}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/list", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	records := data["records"].([]any)
	assert.Len(t, records, 1)
}

func TestGetFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{getRecord: &domain.FoodRecord{ID: "r1", MealType: "lunch"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestUpdateFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{updateRecord: &domain.FoodRecord{ID: "r1", MealType: "dinner"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"total_calories": 300})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/food-record/r1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestUpdateFoodRecordPreservesPackagedAnalysisMetadata(t *testing.T) {
	mockSvc := &mockFoodRecordService{updateRecord: &domain.FoodRecord{ID: "r1", MealType: "lunch"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"items": []map[string]any{{
			"name":                      "喜之郎CiCi果粒爽橙汁饮料",
			"weight":                    258,
			"ratio":                     80,
			"intake":                    206.4,
			"suggested_ratio":           80,
			"suggested_ratio_source":    "ai",
			"nutrition_source":          "packaged_food_library",
			"nutrition_source_category": "database",
			"packaged_food_id":          "packaged:cici-orange-258g",
			"package_match_status":      "matched",
			"package_match_confidence":  0.93,
			"package_weight_source":     "packaged_food_library",
			"package_weight_applied":    true,
			"package_weight_reason":     "命中包装库净含量258g",
			"packaged_candidates":       []map[string]any{{"id": "packaged:cici-orange-258g", "net_weight_g": 258}},
			"nutrients":                 map[string]any{"calories": 178, "protein": 0, "carbs": 44, "fat": 0},
		}},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/food-record/r1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	if assert.NotNil(t, mockSvc.updateInput) && assert.Len(t, mockSvc.updateInput.Items, 1) {
		item := mockSvc.updateInput.Items[0]
		assert.Equal(t, "喜之郎CiCi果粒爽橙汁饮料", item.Name)
		if assert.NotNil(t, item.SuggestedRatioSource) {
			assert.Equal(t, "ai", *item.SuggestedRatioSource)
		}
		if assert.NotNil(t, item.NutritionSource) {
			assert.Equal(t, "packaged_food_library", *item.NutritionSource)
		}
		if assert.NotNil(t, item.NutritionSourceCategory) {
			assert.Equal(t, "database", *item.NutritionSourceCategory)
		}
		if assert.NotNil(t, item.PackagedFoodID) {
			assert.Equal(t, "packaged:cici-orange-258g", *item.PackagedFoodID)
		}
		if assert.NotNil(t, item.PackageWeightApplied) {
			assert.True(t, *item.PackageWeightApplied)
		}
		assert.Len(t, item.PackagedCandidates, 1)
	}
}

func TestDeleteFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/food-record/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestShareFoodRecord(t *testing.T) {
	mockSvc := &mockFoodRecordService{shareRecord: &domain.FoodRecord{ID: "r1", MealType: "lunch"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/share/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestShareFoodRecordAllowsHealthymaxCORS(t *testing.T) {
	mockSvc := &mockFoodRecordService{shareRecord: &domain.FoodRecord{ID: "r1", MealType: "lunch"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/share/r1", nil)
	req.Header.Set("Origin", "https://healthymax.cn")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "https://healthymax.cn", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "Origin", w.Header().Get("Vary"))
}

func TestShareFoodRecordRejectsUnknownCORSOrigin(t *testing.T) {
	mockSvc := &mockFoodRecordService{shareRecord: &domain.FoodRecord{ID: "r1", MealType: "lunch"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/share/r1", nil)
	req.Header.Set("Origin", "https://evil.example")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, w.Header().Get("Access-Control-Allow-Origin"))
}

func TestShareFoodRecordOptionsAllowsHealthymaxCORS(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodOptions, "/api/food-record/share/r1", nil)
	req.Header.Set("Origin", "https://healthymax.cn")
	req.Header.Set("Access-Control-Request-Method", http.MethodGet)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNoContent, w.Code)
	assert.Equal(t, "https://healthymax.cn", w.Header().Get("Access-Control-Allow-Origin"))
	assert.Contains(t, w.Header().Get("Access-Control-Allow-Methods"), http.MethodGet)
}

func TestShareFoodRecordPageRedirectsToFrontend(t *testing.T) {
	mockSvc := &mockFoodRecordService{shareRecord: &domain.FoodRecord{ID: "r1", MealType: "lunch"}}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/share/food-record/r%201%20%E4%B8%AD%E6%96%87", nil)
	req.Host = "dev.api.healthymax.cn"
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "https://healthymax.cn/share/food-record/r%201%20%E4%B8%AD%E6%96%87?api_env=dev", w.Header().Get("Location"))
}

func TestShareFoodRecordForbidden(t *testing.T) {
	mockSvc := &mockFoodRecordService{shareErr: commonerrors.ErrForbidden}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/share/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestUploadAnalyzeImage(t *testing.T) {
	mockSvc := &mockUploadService{url: "https://cdn.example.com/img.jpg"}
	h := NewFoodRecordHandler(nil, mockSvc, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": "data:image/jpeg;base64,test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "https://cdn.example.com/img.jpg", data["imageUrl"])
}

func TestSearchFoodNutrition(t *testing.T) {
	mockSvc := &mockNutritionService{items: []map[string]any{{"food_id": "f1", "canonical_name": "apple"}}}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/search?query=apple", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetUnresolvedTop(t *testing.T) {
	mockSvc := &mockNutritionService{logs: []domain.FoodUnresolvedLog{{ID: "u1", RawName: "foo", HitCount: 5}}}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/unresolved/top", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestCreatePackagedFood(t *testing.T) {
	mockSvc := &mockNutritionService{}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"product_name":       "蛋白棒",
		"source_image_urls":  []string{"https://cdn.example.com/protein-bar.jpg"},
		"net_weight_g":       60,
		"kcal_per_100g":      420,
		"protein_per_100g":   28,
		"carbs_per_100g":     42,
		"fat_per_100g":       14,
		"sodium_mg_per_100g": 200,
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/packaged-food", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	data := resp["data"].(map[string]any)
	item := data["item"].(map[string]any)
	assert.Equal(t, "蛋白棒", item["product_name"])
	assert.Equal(t, float64(60), item["net_weight_g"])
}

func TestCreatePackagedFoodRejectsMissingImage(t *testing.T) {
	mockSvc := &mockNutritionService{}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"product_name":     "蛋白棒",
		"net_weight_g":     60,
		"kcal_per_100g":    420,
		"protein_per_100g": 28,
		"carbs_per_100g":   42,
		"fat_per_100g":     14,
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/packaged-food", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestRecognizePackagedNutritionLabel(t *testing.T) {
	mockSvc := &mockNutritionService{}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"image_url": "https://cdn.example.com/label.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/packaged-food/nutrition-label/recognize", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	data := resp["data"].(map[string]any)
	nutrition := data["nutrition"].(map[string]any)
	assert.Equal(t, float64(420), nutrition["kcal_per_100g"])
	assert.Equal(t, float64(280), nutrition["sodium_mg_per_100g"])
}

func TestSubmitPackagedNutritionLabelTask(t *testing.T) {
	mockSvc := &mockNutritionService{}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{"image_url": "https://cdn.example.com/label.jpg"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/packaged-food/nutrition-label/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	data := resp["data"].(map[string]any)
	assert.Equal(t, "label-task-1", data["task_id"])
}

func TestSubmitPackagedProductExtractTask(t *testing.T) {
	mockSvc := &mockNutritionService{}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"image_urls":           []string{"https://cdn.example.com/front.jpg", "https://cdn.example.com/nutrition.jpg", "https://cdn.example.com/extra.jpg"},
		"recognized_name_hint": "蛋白棒",
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/packaged-food/extract/submit", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	assert.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	data := resp["data"].(map[string]any)
	assert.Equal(t, "packaged-extract-task-1", data["task_id"])
	assert.Len(t, mockSvc.submitPackagedInputs, 1)
	assert.Len(t, mockSvc.submitPackagedInputs[0].ImageURLs, 3)
	assert.Equal(t, "蛋白棒", mockSvc.submitPackagedInputs[0].RecognizedNameHint)
}

func TestSubmitPackagedProductExtractTaskRejectsImageCount(t *testing.T) {
	tests := []struct {
		name      string
		imageURLs []string
	}{
		{name: "empty", imageURLs: []string{}},
		{name: "too many", imageURLs: []string{"1", "2", "3", "4"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockSvc := &mockNutritionService{
				submitPackagedExtractErr: &commonerrors.AppError{Code: 10002, Message: "同一种商品最多上传 3 张包装图片", HTTPStatus: 400},
			}
			h := NewFoodRecordHandler(nil, nil, mockSvc)
			r := setupRouter(h)

			body, _ := json.Marshal(map[string]any{"image_urls": tt.imageURLs})
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodPost, "/api/packaged-food/extract/submit", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)

			assert.Equal(t, http.StatusBadRequest, w.Code)
		})
	}
}

func TestSaveCriticalSamples(t *testing.T) {
	mockSvc := &mockFoodRecordService{}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"items": []map[string]any{{"food_name": "apple", "ai_weight": 100, "user_weight": 120, "deviation_percent": 20}},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/critical-samples", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "已保存偏差样本", data["message"])
	assert.Equal(t, float64(1), data["count"])
}

func TestSaveFoodRecordValidationError(t *testing.T) {
	mockSvc := &mockFoodRecordService{saveErr: errors.New("bad request")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"meal_type": "invalid"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/food-record/save", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestUploadAnalyzeImageFile(t *testing.T) {
	mockSvc := &mockUploadService{url: "https://cdn.example.com/file.jpg"}
	h := NewFoodRecordHandler(nil, mockSvc, nil)
	r := setupRouter(h)

	body := "--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.jpg\"\r\nContent-Type: image/jpeg\r\n\r\ntestdata\r\n--boundary--\r\n"
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image-file", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=boundary")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]any)
	assert.Equal(t, "https://cdn.example.com/file.jpg", data["imageUrl"])
}

func TestUploadAnalyzeImageFileMissingFile(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image-file", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUploadAnalyzeImageFileNonImage(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	body := "--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.txt\"\r\nContent-Type: text/plain\r\n\r\ntestdata\r\n--boundary--\r\n"
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image-file", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=boundary")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUploadAnalyzeImageEmpty(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": ""})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUploadAnalyzeImageError(t *testing.T) {
	mockSvc := &mockUploadService{err: errors.New("upload error")}
	h := NewFoodRecordHandler(nil, mockSvc, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]string{"base64Image": "data:image/jpeg;base64,test"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/upload-analyze-image", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSaveFoodRecordBindError(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/food-record/save", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdateFoodRecordBindError(t *testing.T) {
	h := NewFoodRecordHandler(nil, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/food-record/r1", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestGetFoodRecordError(t *testing.T) {
	mockSvc := &mockFoodRecordService{getErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestDeleteFoodRecordError(t *testing.T) {
	mockSvc := &mockFoodRecordService{deleteErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/food-record/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestListFoodRecordsError(t *testing.T) {
	mockSvc := &mockFoodRecordService{listErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/list", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestShareFoodRecordError(t *testing.T) {
	mockSvc := &mockFoodRecordService{shareErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/share/r1", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSearchFoodNutritionError(t *testing.T) {
	mockSvc := &mockNutritionService{err: errors.New("db error")}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/search?query=apple", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestSearchFoodNutritionWithLimit(t *testing.T) {
	mockSvc := &mockNutritionService{items: []map[string]any{{"food_id": "f1", "canonical_name": "apple"}}}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/search?query=apple&limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestGetUnresolvedTopError(t *testing.T) {
	mockSvc := &mockNutritionService{err: errors.New("db error")}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/unresolved/top", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestGetUnresolvedTopWithLimit(t *testing.T) {
	mockSvc := &mockNutritionService{logs: []domain.FoodUnresolvedLog{{ID: "u1", RawName: "foo", HitCount: 5}}}
	h := NewFoodRecordHandler(nil, nil, mockSvc)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-nutrition/unresolved/top?limit=10", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

func TestSaveCriticalSamplesError(t *testing.T) {
	mockSvc := &mockFoodRecordService{saveCriticalSamplesErr: errors.New("db error")}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	body, _ := json.Marshal(map[string]any{
		"items": []map[string]any{{"food_name": "apple", "ai_weight": 100, "user_weight": 120, "deviation_percent": 20}},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/critical-samples", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
}

func TestRecommendMealType(t *testing.T) {
	mockSvc := &mockFoodRecordService{
		recommendMealType:       "lunch",
		recommendMealTypeSource: "shifted_by_record",
	}
	h := NewFoodRecordHandler(mockSvc, nil, nil)
	r := setupRouter(h)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/food-record/recommend-meal-type?date=2026-06-22&ref_time=2026-06-22T12:10:00%2B08:00", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	data := resp["data"].(map[string]any)
	assert.Equal(t, "lunch", data["meal_type"])
	assert.Equal(t, "shifted_by_record", data["generated_by"])
	assert.Equal(t, "test-user-id", mockSvc.recommendMealTypeInput.userID)
	assert.Equal(t, "2026-06-22", mockSvc.recommendMealTypeInput.date)
}
