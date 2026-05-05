package handler

import (
	"context"
	"strconv"

	"food_link/backend/internal/common/response"
	"food_link/backend/internal/utility/domain"

	"github.com/gin-gonic/gin"
)

type LocationService interface {
	ReverseGeocode(ctx context.Context, lat, lng float64) (map[string]any, error)
	SearchAddress(ctx context.Context, keyword string) (map[string]any, error)
}

type QRCodeService interface {
	GenerateQRCode(ctx context.Context, scene, page string) (string, error)
}

type ManualFoodService interface {
	Browse(ctx context.Context, category string, limit int) ([]domain.ManualFood, error)
	Search(ctx context.Context, keyword string, limit int) ([]domain.ManualFood, error)
}

type UtilityHandler struct {
	locationSvc    LocationService
	qrcodeSvc      QRCodeService
	manualFoodSvc  ManualFoodService
}

func NewUtilityHandler(
	locationSvc LocationService,
	qrcodeSvc QRCodeService,
	manualFoodSvc ManualFoodService,
) *UtilityHandler {
	return &UtilityHandler{
		locationSvc:   locationSvc,
		qrcodeSvc:     qrcodeSvc,
		manualFoodSvc: manualFoodSvc,
	}
}

// POST /api/location/reverse
func (h *UtilityHandler) LocationReverse(c *gin.Context) {
	var body struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	data, err := h.locationSvc.ReverseGeocode(c.Request.Context(), body.Lat, body.Lon)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/location/search
func (h *UtilityHandler) LocationSearch(c *gin.Context) {
	var body struct {
		Keyword string `json:"keyword"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	data, err := h.locationSvc.SearchAddress(c.Request.Context(), body.Keyword)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, data)
}

// POST /api/qrcode
func (h *UtilityHandler) QRCode(c *gin.Context) {
	var body struct {
		Scene string `json:"scene"`
		Page  string `json:"page"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	base64, err := h.qrcodeSvc.GenerateQRCode(c.Request.Context(), body.Scene, body.Page)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"base64": base64})
}

// GET /api/manual-food/browse
func (h *UtilityHandler) ManualFoodBrowse(c *gin.Context) {
	category := c.Query("category")
	limitStr := c.Query("limit")
	limit := 20
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}
	items, err := h.manualFoodSvc.Browse(c.Request.Context(), category, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

// GET /api/manual-food/search
func (h *UtilityHandler) ManualFoodSearch(c *gin.Context) {
	keyword := c.Query("keyword")
	limitStr := c.Query("limit")
	limit := 20
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}
	items, err := h.manualFoodSvc.Search(c.Request.Context(), keyword, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}
