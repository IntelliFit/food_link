package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"testing"

	"food_link/backend/internal/campuscatalog/domain"
	"food_link/backend/internal/campuscatalog/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type fakeCatalogService struct {
	uploadAdminID  string
	uploadType     string
	uploadCalls    int
	createAdminID  string
	createInput    service.CreateBatchInput
	updateAdminID  string
	updateItemID   string
	updateInput    service.UpdateCatalogItemInput
	publishAdminID string
	publishItemID  string
	listInput      service.CatalogItemListInput
	deleteAdminID  string
	deleteItemID   string
}

func (f *fakeCatalogService) UploadImage(_ context.Context, adminID, _, contentType string, _ []byte) (string, error) {
	f.uploadAdminID = adminID
	f.uploadType = contentType
	f.uploadCalls++
	return "https://cdn.example.com/campus-food/test.jpg", nil
}

func (f *fakeCatalogService) CreateBatch(_ context.Context, adminID string, input service.CreateBatchInput) (*service.CreateBatchResult, error) {
	f.createAdminID = adminID
	f.createInput = input
	return &service.CreateBatchResult{Batch: domain.CollectionBatch{ID: "batch-1"}}, nil
}

func (f *fakeCatalogService) ListBatches(context.Context, int, int) (*service.BatchListResult, error) {
	return &service.BatchListResult{}, nil
}

func (f *fakeCatalogService) ListItemsByBatch(context.Context, string) ([]domain.CatalogItem, error) {
	return nil, nil
}

func (f *fakeCatalogService) ListItems(_ context.Context, input service.CatalogItemListInput) (*service.CatalogItemListResult, error) {
	f.listInput = input
	return &service.CatalogItemListResult{Items: []domain.CatalogItem{{ID: "item-1"}}, Page: input.Page, Limit: input.Limit, Total: 1}, nil
}

func (f *fakeCatalogService) GetAnalysisProgress(context.Context) (*domain.AnalysisProgress, error) {
	return &domain.AnalysisProgress{
		Total: 2107, AnalyzableTotal: 2017, Completed: 13, CompletedPercent: 0.6445,
		StatusCounts: map[string]int64{"published": 13, "analysis_pending": 2004, "analysis_failed": 0, "draft": 90},
	}, nil
}

func (f *fakeCatalogService) UpdateItem(_ context.Context, adminID, itemID string, input service.UpdateCatalogItemInput) (*domain.CatalogItem, error) {
	f.updateAdminID = adminID
	f.updateItemID = itemID
	f.updateInput = input
	return &domain.CatalogItem{ID: itemID, Name: input.Name}, nil
}

func (f *fakeCatalogService) PublishItem(_ context.Context, adminID, itemID string) (*domain.CatalogItem, error) {
	f.publishAdminID = adminID
	f.publishItemID = itemID
	return &domain.CatalogItem{ID: itemID, Status: "analysis_pending"}, nil
}

func (f *fakeCatalogService) DeleteItem(_ context.Context, adminID, itemID string) error {
	f.deleteAdminID = adminID
	f.deleteItemID = itemID
	return nil
}

func newCatalogTestRouter(svc CatalogService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("admin_account_id", "admin-1")
		c.Next()
	})
	handler := NewCatalogHandler(svc)
	router.POST("/images", handler.UploadImage)
	router.POST("/batches", handler.CreateBatch)
	router.GET("/items", handler.ListItems)
	router.GET("/analysis-progress", handler.GetAnalysisProgress)
	router.PATCH("/items/:item_id", handler.UpdateItem)
	router.POST("/items/:item_id/publish", handler.PublishItem)
	router.DELETE("/items/:item_id", handler.DeleteItem)
	return router
}

func TestGetAnalysisProgressReturnsPipelineCounts(t *testing.T) {
	router := newCatalogTestRouter(&fakeCatalogService{})
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/analysis-progress", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	var envelope struct {
		Data domain.AnalysisProgress `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &envelope))
	require.Equal(t, int64(2107), envelope.Data.Total)
	require.Equal(t, int64(2004), envelope.Data.StatusCounts["analysis_pending"])
	require.Equal(t, int64(13), envelope.Data.StatusCounts["published"])
}

func TestListItemsAcceptsHierarchyFilters(t *testing.T) {
	svc := &fakeCatalogService{}
	router := newCatalogTestRouter(svc)
	request := httptest.NewRequest(http.MethodGet, "/items?school_id=school-1&canteen_id=canteen-1&window_id=window-1&page=2&limit=25", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "school-1", svc.listInput.SchoolID)
	require.Equal(t, "canteen-1", svc.listInput.CanteenID)
	require.Equal(t, "window-1", svc.listInput.WindowID)
	require.Equal(t, 2, svc.listInput.Page)
	require.Equal(t, 25, svc.listInput.Limit)
}

func TestDeleteItemUsesAdminIdentity(t *testing.T) {
	svc := &fakeCatalogService{}
	router := newCatalogTestRouter(svc)
	request := httptest.NewRequest(http.MethodDelete, "/items/item-1", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "admin-1", svc.deleteAdminID)
	require.Equal(t, "item-1", svc.deleteItemID)
}

func TestPublishItemUsesAdminIdentity(t *testing.T) {
	svc := &fakeCatalogService{}
	router := newCatalogTestRouter(svc)
	request := httptest.NewRequest(http.MethodPost, "/items/item-1/publish", nil)
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusAccepted, recorder.Code)
	require.Equal(t, "admin-1", svc.publishAdminID)
	require.Equal(t, "item-1", svc.publishItemID)
}

func TestUploadImageUsesAdminIdentity(t *testing.T) {
	svc := &fakeCatalogService{}
	router := newCatalogTestRouter(svc)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "dish.jpg")
	require.NoError(t, err)
	_, err = part.Write([]byte{0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43})
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	request := httptest.NewRequest(http.MethodPost, "/images", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "admin-1", svc.uploadAdminID)
	require.Equal(t, "image/jpeg", svc.uploadType)
}

func TestUploadImageRejectsSpoofedImageContentType(t *testing.T) {
	svc := &fakeCatalogService{}
	router := newCatalogTestRouter(svc)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="dish.jpg"`)
	header.Set("Content-Type", "image/jpeg")
	part, err := writer.CreatePart(header)
	require.NoError(t, err)
	_, err = part.Write([]byte("this is plain text, not an image"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	request := httptest.NewRequest(http.MethodPost, "/images", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusBadRequest, recorder.Code)
	require.Zero(t, svc.uploadCalls)
}

func TestLooksLikeHEIF(t *testing.T) {
	require.True(t, looksLikeHEIF([]byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'h', 'e', 'i', 'c'}))
	require.False(t, looksLikeHEIF([]byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 't', 'e', 'x', 't'}))
	require.False(t, looksLikeHEIF([]byte("too short")))
}

func TestCreateBatchMapsPayload(t *testing.T) {
	svc := &fakeCatalogService{}
	router := newCatalogTestRouter(svc)
	payload := map[string]any{
		"client_batch_key":  "client-1",
		"venue_type":        "university",
		"organization_name": "清华大学",
		"canteen_name":      "桃李园",
		"entries": []map[string]any{{
			"entry_type": "menu_item",
			"name":       "老北京炸鸡排",
		}},
	}
	data, err := json.Marshal(payload)
	require.NoError(t, err)

	request := httptest.NewRequest(http.MethodPost, "/batches", bytes.NewReader(data))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "admin-1", svc.createAdminID)
	require.Equal(t, "桃李园", svc.createInput.CanteenName)
	require.Len(t, svc.createInput.Entries, 1)
}

func TestUpdateItemMapsPayloadAndAdminIdentity(t *testing.T) {
	svc := &fakeCatalogService{}
	router := newCatalogTestRouter(svc)
	payload := map[string]any{
		"entry_type":   "menu_item",
		"name":         "鸡蛋饼",
		"service_mode": "fixed_portion",
		"price_type":   "fixed",
		"price":        1.5,
		"image_kind":   "menu_board",
	}
	data, err := json.Marshal(payload)
	require.NoError(t, err)

	request := httptest.NewRequest(http.MethodPatch, "/items/item-1", bytes.NewReader(data))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "admin-1", svc.updateAdminID)
	require.Equal(t, "item-1", svc.updateItemID)
	require.Equal(t, "鸡蛋饼", svc.updateInput.Name)
}
