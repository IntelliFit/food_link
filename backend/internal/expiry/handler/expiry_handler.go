package handler

import (
	"context"
	"net/http"
	"time"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/expiry/domain"
	"food_link/backend/internal/expiry/service"

	"github.com/gin-gonic/gin"
)

type ExpiryService interface {
	Dashboard(ctx context.Context, userID string) (*service.DashboardResult, error)
	ListItems(ctx context.Context, userID, status string) ([]domain.ExpiryItem, error)
	CreateItem(ctx context.Context, userID string, input service.CreateItemInput) (*domain.ExpiryItem, error)
	GetItem(ctx context.Context, userID, itemID string) (*domain.ExpiryItem, error)
	UpdateItem(ctx context.Context, userID, itemID string, input service.UpdateItemInput) (*domain.ExpiryItem, error)
	UpdateStatus(ctx context.Context, userID, itemID, status string) (*domain.ExpiryItem, error)
	Subscribe(ctx context.Context, userID, itemID string) (*service.SubscribeResult, error)
	Recognize(ctx context.Context, userID string, imageURLs []string) (*service.RecognizeResult, error)
}

type ExpiryHandler struct {
	svc ExpiryService
}

func NewExpiryHandler(svc ExpiryService) *ExpiryHandler {
	return &ExpiryHandler{svc: svc}
}

// GET /api/expiry/dashboard
func (h *ExpiryHandler) Dashboard(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	data, err := h.svc.Dashboard(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// GET /api/expiry/items
func (h *ExpiryHandler) ListItems(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	status := c.Query("status")
	items, err := h.svc.ListItems(c.Request.Context(), userID, status)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

// POST /api/expiry/items
func (h *ExpiryHandler) CreateItem(c *gin.Context) {
	var body struct {
		Name       string     `json:"name"`
		Category   string     `json:"category"`
		ExpiryDate *time.Time `json:"expiry_date"`
		Quantity   *int       `json:"quantity"`
		Location   *string    `json:"location"`
		Notes      *string    `json:"notes"`
		ImageURL   *string    `json:"image_url"`
		Status     string     `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	item, err := h.svc.CreateItem(c.Request.Context(), userID, service.CreateItemInput{
		Name:       body.Name,
		Category:   body.Category,
		ExpiryDate: body.ExpiryDate,
		Quantity:   body.Quantity,
		Location:   body.Location,
		Notes:      body.Notes,
		ImageURL:   body.ImageURL,
		Status:     body.Status,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "item": item})
}

// GET /api/expiry/items/:item_id
func (h *ExpiryHandler) GetItem(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	itemID := c.Param("item_id")
	item, err := h.svc.GetItem(c.Request.Context(), userID, itemID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item})
}

// PUT /api/expiry/items/:item_id
func (h *ExpiryHandler) UpdateItem(c *gin.Context) {
	var body struct {
		Name       *string    `json:"name"`
		Category   *string    `json:"category"`
		ExpiryDate *time.Time `json:"expiry_date"`
		Quantity   *int       `json:"quantity"`
		Location   *string    `json:"location"`
		Notes      *string    `json:"notes"`
		ImageURL   *string    `json:"image_url"`
		Status     *string    `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	itemID := c.Param("item_id")
	item, err := h.svc.UpdateItem(c.Request.Context(), userID, itemID, service.UpdateItemInput{
		Name:       body.Name,
		Category:   body.Category,
		ExpiryDate: body.ExpiryDate,
		Quantity:   body.Quantity,
		Location:   body.Location,
		Notes:      body.Notes,
		ImageURL:   body.ImageURL,
		Status:     body.Status,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "更新成功", "item": item})
}

// POST /api/expiry/items/:item_id/status
func (h *ExpiryHandler) UpdateStatus(c *gin.Context) {
	var body struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	itemID := c.Param("item_id")
	item, err := h.svc.UpdateStatus(c.Request.Context(), userID, itemID, body.Status)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "状态已更新", "item": item})
}

// POST /api/expiry/items/:item_id/subscribe
func (h *ExpiryHandler) Subscribe(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	itemID := c.Param("item_id")
	result, err := h.svc.Subscribe(c.Request.Context(), userID, itemID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/expiry/recognize
func (h *ExpiryHandler) Recognize(c *gin.Context) {
	var body struct {
		ImageURLs []string `json:"image_urls"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if len(body.ImageURLs) == 0 {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "请至少提供 1 张图片", HTTPStatus: http.StatusBadRequest})
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.svc.Recognize(c.Request.Context(), userID, body.ImageURLs)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}
