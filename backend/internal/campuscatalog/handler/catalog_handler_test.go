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
	uploadAdminID string
	uploadType    string
	uploadCalls   int
	createAdminID string
	createInput   service.CreateBatchInput
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
	return router
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
