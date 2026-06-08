package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/publicfood/repo"
	"food_link/backend/internal/publicfood/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type mockPublicFoodService struct {
	createInput        service.CreateInput
	updateInput        service.CreateInput
	updateItemID       string
	listFilter         repo.ListFilter
	campusDetailItemID string
}

func (m *mockPublicFoodService) Create(ctx context.Context, userID string, input service.CreateInput) (string, error) {
	m.createInput = input
	return "public-food-1", nil
}

func (m *mockPublicFoodService) List(ctx context.Context, userID string, filter repo.ListFilter) ([]domain.PublicFoodView, error) {
	m.listFilter = filter
	return []domain.PublicFoodView{{
		PublicFoodItem: domain.PublicFoodItem{
			ID:           "campus-1",
			FoodName:     "鸡胸肉套餐",
			IsCampusFood: true,
			SchoolName:   filter.SchoolName,
			CanteenName:  filter.CanteenName,
		},
	}}, nil
}

func (m *mockPublicFoodService) Mine(ctx context.Context, userID string) ([]domain.PublicFoodItem, error) {
	return nil, nil
}

func (m *mockPublicFoodService) Collections(ctx context.Context, userID string) ([]domain.PublicFoodView, error) {
	return nil, nil
}

func (m *mockPublicFoodService) Get(ctx context.Context, userID, itemID string) (*domain.PublicFoodView, error) {
	return nil, nil
}

func (m *mockPublicFoodService) GetCampusDetail(ctx context.Context, userID, itemID string) (*domain.CampusFoodDetailView, error) {
	m.campusDetailItemID = itemID
	return &domain.CampusFoodDetailView{
		Item: domain.PublicFoodView{PublicFoodItem: domain.PublicFoodItem{
			ID:           itemID,
			FoodName:     "鸡胸肉套餐",
			IsCampusFood: true,
		}},
		Metrics: domain.CampusFoodMetric{ProteinPerYuan: 2.4, PricePer100Kcal: 3.8},
	}, nil
}

func (m *mockPublicFoodService) Like(ctx context.Context, userID, itemID string) error {
	return nil
}

func (m *mockPublicFoodService) Unlike(ctx context.Context, userID, itemID string) error {
	return nil
}

func (m *mockPublicFoodService) Collect(ctx context.Context, userID, itemID string) error {
	return nil
}

func (m *mockPublicFoodService) Uncollect(ctx context.Context, userID, itemID string) error {
	return nil
}

func (m *mockPublicFoodService) Update(ctx context.Context, userID, itemID string, input service.CreateInput) error {
	m.updateInput = input
	m.updateItemID = itemID
	return nil
}

func (m *mockPublicFoodService) Delete(ctx context.Context, userID, itemID string) error {
	return nil
}

func (m *mockPublicFoodService) Comments(ctx context.Context, itemID string) ([]domain.PublicFoodComment, error) {
	return nil, nil
}

func (m *mockPublicFoodService) AddComment(ctx context.Context, userID, itemID, content string, rating *int) (*domain.PublicFoodComment, error) {
	return nil, nil
}

func (m *mockPublicFoodService) Feedback(ctx context.Context, userID, content string, itemID *string) (string, error) {
	return "feedback-1", nil
}

func setupPublicFoodHandlerRouter(svc *mockPublicFoodService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(authmw.ContextUserIDKey, "user-1")
		c.Next()
	})
	h := NewPublicFoodHandler(svc)
	r.GET("/api/public-food-library", h.List)
	r.POST("/api/public-food-library", h.Create)
	r.GET("/api/public-food-library/:item_id/campus-detail", h.GetCampusDetail)
	r.PUT("/api/public-food-library/:item_id", h.Update)
	return r
}

func TestPublicFoodHandlerListMapsCampusFilters(t *testing.T) {
	svc := &mockPublicFoodService{}
	r := setupPublicFoodHandlerRouter(svc)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/public-food-library?is_campus_food=true&school_name=北京大学&canteen_name=学一食堂&sort_by=hot&limit=80", nil)
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	require.NotNil(t, svc.listFilter.IsCampusFood)
	require.True(t, *svc.listFilter.IsCampusFood)
	require.Equal(t, "北京大学", svc.listFilter.SchoolName)
	require.Equal(t, "学一食堂", svc.listFilter.CanteenName)
	require.Equal(t, "hot", svc.listFilter.SortBy)
	require.Equal(t, 80, svc.listFilter.Limit)
}

func TestPublicFoodHandlerCreateMapsCampusUploadFields(t *testing.T) {
	svc := &mockPublicFoodService{}
	r := setupPublicFoodHandlerRouter(svc)
	body, _ := json.Marshal(map[string]any{
		"is_campus_food":      true,
		"food_name":           "鸡胸肉套餐",
		"school_name":         "北京大学",
		"campus_name":         "燕园校区",
		"canteen_name":        "学一食堂",
		"floor":               "一层",
		"window_name":         "低脂窗口",
		"image_path":          "https://example.com/campus-food.jpg",
		"price":               16.5,
		"price_type":          "fixed",
		"price_unit":          "份",
		"portion_description": "一荤一素",
		"total_calories":      420,
		"total_protein":       38,
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/public-food-library", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	require.True(t, svc.createInput.IsCampusFood)
	require.Equal(t, "鸡胸肉套餐", *svc.createInput.FoodName)
	require.Equal(t, "北京大学", *svc.createInput.SchoolName)
	require.Equal(t, "燕园校区", *svc.createInput.CampusName)
	require.Equal(t, "学一食堂", *svc.createInput.CanteenName)
	require.Equal(t, "一层", *svc.createInput.Floor)
	require.Equal(t, "低脂窗口", *svc.createInput.WindowName)
	require.Equal(t, "https://example.com/campus-food.jpg", *svc.createInput.ImagePath)
	require.Equal(t, 16.5, *svc.createInput.Price)
	require.Equal(t, "fixed", *svc.createInput.PriceType)
	require.Equal(t, "份", *svc.createInput.PriceUnit)
	require.Equal(t, "一荤一素", *svc.createInput.PortionDescription)
	require.Equal(t, 420.0, svc.createInput.TotalCalories)
	require.Equal(t, 38.0, svc.createInput.TotalProtein)
}

func TestPublicFoodHandlerGetCampusDetail(t *testing.T) {
	svc := &mockPublicFoodService{}
	r := setupPublicFoodHandlerRouter(svc)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/public-food-library/campus-1/campus-detail", nil)
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "campus-1", svc.campusDetailItemID)
	require.Contains(t, w.Body.String(), "protein_per_yuan")
}

func TestPublicFoodHandlerUpdateMapsFields(t *testing.T) {
	svc := &mockPublicFoodService{}
	r := setupPublicFoodHandlerRouter(svc)

	body, _ := json.Marshal(map[string]any{
		"food_name":             "修改后的菜品",
		"merchant_name":         "修改后的商家",
		"description":           "修改后的描述",
		"suitable_for_fat_loss": true,
		"user_tags":             []string{"高蛋白", "少油"},
		"user_notes":            "修改后的备注",
		"is_campus_food":        true,
		"school_name":           "清华大学",
		"canteen_name":          "清芬园",
		"price":                 18.0,
		"price_type":            "fixed",
	})

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPut, "/api/public-food-library/item-123", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "item-123", svc.updateItemID)
	require.Equal(t, "修改后的菜品", *svc.updateInput.FoodName)
	require.Equal(t, "修改后的商家", *svc.updateInput.MerchantName)
	require.Equal(t, "修改后的描述", *svc.updateInput.Description)
	require.True(t, svc.updateInput.SuitableForFatLoss)
	require.Equal(t, []string{"高蛋白", "少油"}, svc.updateInput.UserTags)
	require.Equal(t, "修改后的备注", *svc.updateInput.UserNotes)
	require.True(t, svc.updateInput.IsCampusFood)
	require.Equal(t, "清华大学", *svc.updateInput.SchoolName)
	require.Equal(t, "清芬园", *svc.updateInput.CanteenName)
	require.Equal(t, 18.0, *svc.updateInput.Price)
	require.Equal(t, "fixed", *svc.updateInput.PriceType)
}
