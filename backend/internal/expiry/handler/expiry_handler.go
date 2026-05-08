package handler

import (
	"context"
	"net/http"
	"strings"
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

type ExpiryContextRecognizer interface {
	RecognizeWithContext(ctx context.Context, userID string, imageURLs []string, additionalContext string) (*service.RecognizeResult, error)
}

type ExpiryContextSubscriber interface {
	SubscribeWithContext(ctx context.Context, userID, itemID, openID, subscribeStatus, errMsg string) (*service.SubscribeResult, error)
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
	preview := make([]map[string]any, 0, len(data.ExpiringSoon))
	for _, item := range data.ExpiringSoon {
		preview = append(preview, formatExpiryItem(item))
	}
	response.Success(c, gin.H{
		"active_count":    data.ActiveCount,
		"expired_count":   data.ExpiredCount,
		"today_count":     data.TodayCount,
		"soon_count":      data.SoonCount,
		"processed_count": data.ProcessedCount,
		"preview_items":   preview,
	})
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
	response.Success(c, gin.H{"items": formatExpiryItems(items)})
}

// POST /api/expiry/items
func (h *ExpiryHandler) CreateItem(c *gin.Context) {
	var body struct {
		Name         string  `json:"name"`
		FoodName     string  `json:"food_name"`
		Category     string  `json:"category"`
		ExpiryDate   *string `json:"expiry_date"`
		ExpireDate   *string `json:"expire_date"`
		Quantity     *int    `json:"quantity"`
		QuantityNote *string `json:"quantity_note"`
		Location     *string `json:"location"`
		StorageType  string  `json:"storage_type"`
		Notes        *string `json:"notes"`
		Note         *string `json:"note"`
		ImageURL     *string `json:"image_url"`
		OpenedDate   *string `json:"opened_date"`
		SourceType   string  `json:"source_type"`
		Status       string  `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	expireDate, err := parseOptionalExpiryDate(firstStringPtr(body.ExpireDate, body.ExpiryDate), true)
	if err != nil {
		response.Error(c, err)
		return
	}
	openedDate, err := parseOptionalExpiryDate(body.OpenedDate, false)
	if err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	item, err := h.svc.CreateItem(c.Request.Context(), userID, service.CreateItemInput{
		Name:         body.Name,
		FoodName:     body.FoodName,
		Category:     body.Category,
		ExpireDate:   expireDate,
		Quantity:     body.Quantity,
		QuantityNote: body.QuantityNote,
		Location:     body.Location,
		StorageType:  body.StorageType,
		Notes:        body.Notes,
		Note:         body.Note,
		ImageURL:     body.ImageURL,
		OpenedDate:   openedDate,
		SourceType:   body.SourceType,
		Status:       body.Status,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "创建成功", "item": formatExpiryItem(*item)})
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
	response.Success(c, gin.H{"item": formatExpiryItem(*item)})
}

// PUT /api/expiry/items/:item_id
func (h *ExpiryHandler) UpdateItem(c *gin.Context) {
	var body struct {
		Name         *string `json:"name"`
		FoodName     *string `json:"food_name"`
		Category     *string `json:"category"`
		ExpiryDate   *string `json:"expiry_date"`
		ExpireDate   *string `json:"expire_date"`
		Quantity     *int    `json:"quantity"`
		QuantityNote *string `json:"quantity_note"`
		Location     *string `json:"location"`
		StorageType  *string `json:"storage_type"`
		Notes        *string `json:"notes"`
		Note         *string `json:"note"`
		ImageURL     *string `json:"image_url"`
		OpenedDate   *string `json:"opened_date"`
		SourceType   *string `json:"source_type"`
		Status       *string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	expireDate, err := parseOptionalExpiryDate(firstStringPtr(body.ExpireDate, body.ExpiryDate), false)
	if err != nil {
		response.Error(c, err)
		return
	}
	openedDate, err := parseOptionalExpiryDate(body.OpenedDate, false)
	if err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	itemID := c.Param("item_id")
	item, err := h.svc.UpdateItem(c.Request.Context(), userID, itemID, service.UpdateItemInput{
		Name:         body.Name,
		FoodName:     body.FoodName,
		Category:     body.Category,
		ExpireDate:   expireDate,
		Quantity:     body.Quantity,
		QuantityNote: body.QuantityNote,
		Location:     body.Location,
		StorageType:  body.StorageType,
		Notes:        body.Notes,
		Note:         body.Note,
		ImageURL:     body.ImageURL,
		OpenedDate:   openedDate,
		SourceType:   body.SourceType,
		Status:       body.Status,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "更新成功", "item": formatExpiryItem(*item)})
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
	response.Success(c, gin.H{"message": "状态已更新", "item": formatExpiryItem(*item)})
}

// POST /api/expiry/items/:item_id/subscribe
func (h *ExpiryHandler) Subscribe(c *gin.Context) {
	var body struct {
		SubscribeStatus string `json:"subscribe_status"`
		ErrMsg          string `json:"err_msg"`
	}
	_ = c.ShouldBindJSON(&body)
	userID := c.GetString(authmw.ContextUserIDKey)
	openID := c.GetString(authmw.ContextOpenIDKey)
	itemID := c.Param("item_id")
	var result *service.SubscribeResult
	var err error
	if svc, ok := h.svc.(ExpiryContextSubscriber); ok {
		result, err = svc.SubscribeWithContext(c.Request.Context(), userID, itemID, openID, body.SubscribeStatus, body.ErrMsg)
	} else {
		result, err = h.svc.Subscribe(c.Request.Context(), userID, itemID)
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/expiry/recognize
func (h *ExpiryHandler) Recognize(c *gin.Context) {
	var body struct {
		ImageURLs         []string `json:"image_urls"`
		AdditionalContext string   `json:"additional_context"`
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
	var result *service.RecognizeResult
	var err error
	if svc, ok := h.svc.(ExpiryContextRecognizer); ok {
		result, err = svc.RecognizeWithContext(c.Request.Context(), userID, body.ImageURLs, body.AdditionalContext)
	} else {
		result, err = h.svc.Recognize(c.Request.Context(), userID, body.ImageURLs)
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func parseOptionalExpiryDate(raw *string, required bool) (*time.Time, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		if required {
			return nil, &commonerrors.AppError{Code: 10002, Message: "expire_date is required", HTTPStatus: http.StatusBadRequest}
		}
		return nil, nil
	}
	value := strings.TrimSpace(*raw)
	if t, err := time.ParseInLocation("2006-01-02", value, time.FixedZone("Asia/Shanghai", 8*60*60)); err == nil {
		return &t, nil
	}
	if t, err := time.Parse(time.RFC3339, value); err == nil {
		return &t, nil
	}
	return nil, &commonerrors.AppError{Code: 10002, Message: "expire_date format is invalid", HTTPStatus: http.StatusBadRequest}
}

func firstStringPtr(values ...*string) *string {
	for _, value := range values {
		if value != nil && strings.TrimSpace(*value) != "" {
			return value
		}
	}
	return nil
}

func formatExpiryItems(items []domain.ExpiryItem) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		out = append(out, formatExpiryItem(item))
	}
	return out
}

func formatExpiryItem(item domain.ExpiryItem) map[string]any {
	china := time.FixedZone("Asia/Shanghai", 8*60*60)
	todayNow := time.Now().In(china)
	today := time.Date(todayNow.Year(), todayNow.Month(), todayNow.Day(), 0, 0, 0, 0, china)
	expire := item.ExpireDate.In(china)
	expireDay := time.Date(expire.Year(), expire.Month(), expire.Day(), 0, 0, 0, 0, china)
	days := int(expireDay.Sub(today).Hours() / 24)
	urgency := "fresh"
	if item.Status == "active" {
		switch {
		case days < 0:
			urgency = "expired"
		case days == 0:
			urgency = "today"
		case days <= 3:
			urgency = "soon"
		}
	}
	openedDate := any(nil)
	if item.OpenedDate != nil {
		openedDate = item.OpenedDate.In(china).Format("2006-01-02")
	}
	return map[string]any{
		"id":                 item.ID,
		"user_id":            item.UserID,
		"food_name":          item.FoodName,
		"category":           item.Category,
		"storage_type":       item.StorageType,
		"storage_type_label": expiryStorageTypeLabel(item.StorageType),
		"quantity_note":      item.QuantityNote,
		"expire_date":        expireDay.Format("2006-01-02"),
		"opened_date":        openedDate,
		"note":               item.Note,
		"source_type":        item.SourceType,
		"status":             item.Status,
		"status_label":       expiryStatusLabel(item.Status),
		"urgency":            urgency,
		"urgency_label":      expiryUrgencyLabel(urgency),
		"days_until_expire":  days,
		"created_at":         item.CreatedAt.Format(time.RFC3339),
		"updated_at":         item.UpdatedAt.Format(time.RFC3339),
	}
}

func expiryStorageTypeLabel(value string) string {
	switch value {
	case "room_temp":
		return "常温"
	case "frozen":
		return "冷冻"
	default:
		return "冷藏"
	}
}

func expiryStatusLabel(value string) string {
	switch value {
	case "consumed":
		return "已食用"
	case "discarded":
		return "已丢弃"
	default:
		return "保鲜中"
	}
}

func expiryUrgencyLabel(value string) string {
	switch value {
	case "expired":
		return "已过期"
	case "today":
		return "今天到期"
	case "soon":
		return "即将到期"
	default:
		return "新鲜"
	}
}
