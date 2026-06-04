package handler

import (
	"context"
	"strconv"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/utility/domain"
	"food_link/backend/internal/utility/repo"

	"github.com/gin-gonic/gin"
)

type LocationService interface {
	ReverseGeocode(ctx context.Context, lat, lng float64) (map[string]any, error)
	SearchAddress(ctx context.Context, keyword string) (map[string]any, error)
}

type QRCodeService interface {
	GenerateQRCode(ctx context.Context, scene, page string, width int, checkPath bool, envVersion string) (string, error)
	GenerateURLLink(ctx context.Context, path, query, envVersion string) (string, error)
}

type ManualFoodService interface {
	Browse(ctx context.Context, userID string, limit int) (*domain.ManualFoodBrowseResult, error)
	Catalog(ctx context.Context, userID string, category string, page int, pageSize int) (*domain.ManualFoodCatalogResult, error)
	Search(ctx context.Context, userID string, keyword string, limit int) ([]domain.ManualFoodResult, error)
	SearchPackaged(ctx context.Context, keyword string, limit int) ([]domain.ManualFoodResult, error)
	ListCustomFoods(ctx context.Context, userID string, limit int, offset int) ([]domain.ManualFoodResult, bool, error)
	SaveCustomFood(ctx context.Context, userID string, input repo.CustomFoodInput) (domain.ManualFoodResult, error)
}

type UtilityHandler struct {
	locationSvc   LocationService
	qrcodeSvc     QRCodeService
	manualFoodSvc ManualFoodService
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
		Scene      string `json:"scene"`
		Page       string `json:"page"`
		Width      int    `json:"width"`
		CheckPath  bool   `json:"check_path"`
		EnvVersion string `json:"env_version"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	base64, err := h.qrcodeSvc.GenerateQRCode(c.Request.Context(), body.Scene, body.Page, body.Width, body.CheckPath, body.EnvVersion)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"base64": base64})
}

// GET /api/miniprogram/launch-url
func (h *UtilityHandler) MiniProgramLaunchURL(c *gin.Context) {
	path := c.DefaultQuery("path", "pages/index/index")
	query := c.Query("query")
	envVersion := c.DefaultQuery("env_version", "release")

	link, err := h.qrcodeSvc.GenerateURLLink(c.Request.Context(), path, query, envVersion)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"url_link": link})
}

// GET /api/manual-food/browse
func (h *UtilityHandler) ManualFoodBrowse(c *gin.Context) {
	limitStr := c.Query("limit")
	limit := 20
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}
	userID, _ := c.Get(authmw.ContextUserIDKey)
	items, err := h.manualFoodSvc.Browse(c.Request.Context(), stringValue(userID), limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, items)
}

// GET /api/manual-food/catalog
func (h *UtilityHandler) ManualFoodCatalog(c *gin.Context) {
	category := c.Query("category")
	page := parsePositiveInt(c.Query("page"), 1)
	pageSize := parsePositiveInt(c.Query("page_size"), 30)
	userID, _ := c.Get(authmw.ContextUserIDKey)
	result, err := h.manualFoodSvc.Catalog(c.Request.Context(), stringValue(userID), category, page, pageSize)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// GET /api/manual-food/search
func (h *UtilityHandler) ManualFoodSearch(c *gin.Context) {
	keyword := c.Query("q")
	if keyword == "" {
		keyword = c.Query("keyword")
	}
	limitStr := c.Query("limit")
	limit := 20
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
			limit = n
		}
	}
	userID, _ := c.Get(authmw.ContextUserIDKey)
	var (
		items []domain.ManualFoodResult
		err   error
	)
	if c.Query("source") == "packaged_food" {
		items, err = h.manualFoodSvc.SearchPackaged(c.Request.Context(), keyword, limit)
	} else {
		items, err = h.manualFoodSvc.Search(c.Request.Context(), stringValue(userID), keyword, limit)
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"results": items})
}

// GET /api/manual-food/custom
func (h *UtilityHandler) ManualFoodCustomList(c *gin.Context) {
	limit := parsePositiveInt(c.Query("limit"), 60)
	offset := parseNonNegativeInt(c.Query("offset"), 0)
	items, hasMore, err := h.manualFoodSvc.ListCustomFoods(
		c.Request.Context(),
		c.GetString(authmw.ContextUserIDKey),
		limit,
		offset,
	)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"items": items, "has_more": hasMore})
}

// POST /api/manual-food/custom
func (h *UtilityHandler) ManualFoodCustomSave(c *gin.Context) {
	var body struct {
		ID                 string         `json:"id"`
		Title              string         `json:"title"`
		DefaultWeightGrams float64        `json:"default_weight_grams"`
		TotalCalories      float64        `json:"total_calories"`
		TotalProtein       float64        `json:"total_protein"`
		TotalCarbs         float64        `json:"total_carbs"`
		TotalFat           float64        `json:"total_fat"`
		NutrientsPer100g   map[string]any `json:"nutrients_per_100g"`
		ExtraNutrients     map[string]any `json:"extra_nutrients"`
		ImagePath          *string        `json:"image_path"`
		ImagePaths         []string       `json:"image_paths"`
		PortionLabel       string         `json:"portion_label"`
		RecommendReason    string         `json:"recommend_reason"`
		ShareToPublic      bool           `json:"share_to_public"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	item, err := h.manualFoodSvc.SaveCustomFood(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), repo.CustomFoodInput{
		ID:                 body.ID,
		Title:              body.Title,
		DefaultWeightGrams: body.DefaultWeightGrams,
		TotalCalories:      body.TotalCalories,
		TotalProtein:       body.TotalProtein,
		TotalCarbs:         body.TotalCarbs,
		TotalFat:           body.TotalFat,
		NutrientsPer100g:   body.NutrientsPer100g,
		ExtraNutrients:     body.ExtraNutrients,
		ImagePath:          body.ImagePath,
		ImagePaths:         body.ImagePaths,
		PortionLabel:       body.PortionLabel,
		RecommendReason:    body.RecommendReason,
		ShareToPublic:      body.ShareToPublic,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"item": item})
}

func parsePositiveInt(value string, fallback int) int {
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil || n <= 0 {
		return fallback
	}
	return n
}

func parseNonNegativeInt(value string, fallback int) int {
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 0 {
		return fallback
	}
	return n
}

func stringValue(value any) string {
	if v, ok := value.(string); ok {
		return v
	}
	return ""
}
