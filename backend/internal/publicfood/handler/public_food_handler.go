package handler

import (
	"context"
	"strconv"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/publicfood/domain"
	"food_link/backend/internal/publicfood/repo"
	"food_link/backend/internal/publicfood/service"

	"github.com/gin-gonic/gin"
)

type PublicFoodService interface {
	Create(ctx context.Context, userID string, input service.CreateInput) (string, error)
	List(ctx context.Context, userID string, filter repo.ListFilter) ([]domain.PublicFoodView, error)
	Mine(ctx context.Context, userID string) ([]domain.PublicFoodItem, error)
	Collections(ctx context.Context, userID string) ([]domain.PublicFoodView, error)
	Get(ctx context.Context, userID, itemID string) (*domain.PublicFoodView, error)
	Like(ctx context.Context, userID, itemID string) error
	Unlike(ctx context.Context, userID, itemID string) error
	Collect(ctx context.Context, userID, itemID string) error
	Uncollect(ctx context.Context, userID, itemID string) error
	Delete(ctx context.Context, userID, itemID string) error
	Comments(ctx context.Context, itemID string) ([]domain.PublicFoodComment, error)
	AddComment(ctx context.Context, userID, itemID, content string, rating *int) (*domain.PublicFoodComment, error)
	Feedback(ctx context.Context, userID, content string, itemID *string) (string, error)
}

type PublicFoodHandler struct {
	svc PublicFoodService
}

func NewPublicFoodHandler(svc PublicFoodService) *PublicFoodHandler {
	return &PublicFoodHandler{svc: svc}
}

func (h *PublicFoodHandler) Create(c *gin.Context) {
	var body struct {
		ImagePath          *string          `json:"image_path"`
		ImagePaths         []string         `json:"image_paths"`
		SourceRecordID     *string          `json:"source_record_id"`
		TotalCalories      float64          `json:"total_calories"`
		TotalProtein       float64          `json:"total_protein"`
		TotalCarbs         float64          `json:"total_carbs"`
		TotalFat           float64          `json:"total_fat"`
		Items              []map[string]any `json:"items"`
		Description        *string          `json:"description"`
		Insight            *string          `json:"insight"`
		FoodName           *string          `json:"food_name"`
		MerchantName       *string          `json:"merchant_name"`
		MerchantAddress    *string          `json:"merchant_address"`
		TasteRating        *int             `json:"taste_rating"`
		SuitableForFatLoss bool             `json:"suitable_for_fat_loss"`
		UserTags           []string         `json:"user_tags"`
		UserNotes          *string          `json:"user_notes"`
		Latitude           *float64         `json:"latitude"`
		Longitude          *float64         `json:"longitude"`
		Province           *string          `json:"province"`
		City               *string          `json:"city"`
		District           *string          `json:"district"`
		DetailAddress      *string          `json:"detail_address"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	id, err := h.svc.Create(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), service.CreateInput{
		ImagePath:          body.ImagePath,
		ImagePaths:         body.ImagePaths,
		SourceRecordID:     body.SourceRecordID,
		TotalCalories:      body.TotalCalories,
		TotalProtein:       body.TotalProtein,
		TotalCarbs:         body.TotalCarbs,
		TotalFat:           body.TotalFat,
		Items:              body.Items,
		Description:        body.Description,
		Insight:            body.Insight,
		FoodName:           body.FoodName,
		MerchantName:       body.MerchantName,
		MerchantAddress:    body.MerchantAddress,
		TasteRating:        body.TasteRating,
		SuitableForFatLoss: body.SuitableForFatLoss,
		UserTags:           body.UserTags,
		UserNotes:          body.UserNotes,
		Latitude:           body.Latitude,
		Longitude:          body.Longitude,
		Province:           body.Province,
		City:               body.City,
		District:           body.District,
		DetailAddress:      body.DetailAddress,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"id": id, "message": "分享成功"})
}

func (h *PublicFoodHandler) List(c *gin.Context) {
	filter := repo.ListFilter{
		City:         c.Query("city"),
		MerchantName: c.Query("merchant_name"),
		SortBy:       c.DefaultQuery("sort_by", "latest"),
		Limit:        intQuery(c, "limit", 20),
		Offset:       intQuery(c, "offset", 0),
	}
	if raw := c.Query("suitable_for_fat_loss"); raw != "" {
		if v, err := strconv.ParseBool(raw); err == nil {
			filter.SuitableForFatLoss = &v
		}
	}
	if raw := c.Query("min_calories"); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil {
			filter.MinCalories = &v
		}
	}
	if raw := c.Query("max_calories"); raw != "" {
		if v, err := strconv.ParseFloat(raw, 64); err == nil {
			filter.MaxCalories = &v
		}
	}
	items, err := h.svc.List(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), filter)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"list": items})
}

func (h *PublicFoodHandler) Mine(c *gin.Context) {
	items, err := h.svc.Mine(c.Request.Context(), c.GetString(authmw.ContextUserIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"list": items})
}

func (h *PublicFoodHandler) Collections(c *gin.Context) {
	items, err := h.svc.Collections(c.Request.Context(), c.GetString(authmw.ContextUserIDKey))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"list": items})
}

func (h *PublicFoodHandler) Get(c *gin.Context) {
	item, err := h.svc.Get(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, item)
}

func (h *PublicFoodHandler) Like(c *gin.Context) {
	if err := h.svc.Like(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已点赞"})
}

func (h *PublicFoodHandler) Unlike(c *gin.Context) {
	if err := h.svc.Unlike(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已取消"})
}

func (h *PublicFoodHandler) Collect(c *gin.Context) {
	if err := h.svc.Collect(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已收藏"})
}

func (h *PublicFoodHandler) Uncollect(c *gin.Context) {
	if err := h.svc.Uncollect(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已取消"})
}

func (h *PublicFoodHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "删除成功"})
}

func (h *PublicFoodHandler) Comments(c *gin.Context) {
	items, err := h.svc.Comments(c.Request.Context(), c.Param("item_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"list": items})
}

func (h *PublicFoodHandler) AddComment(c *gin.Context) {
	var body struct {
		Content string `json:"content"`
		Rating  *int   `json:"rating"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	comment, err := h.svc.AddComment(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id"), body.Content, body.Rating)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"comment": comment})
}

func (h *PublicFoodHandler) Feedback(c *gin.Context) {
	var body struct {
		Content       string  `json:"content"`
		LibraryItemID *string `json:"library_item_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	id, err := h.svc.Feedback(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), body.Content, body.LibraryItemID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"id": id, "message": "反馈提交成功"})
}

func intQuery(c *gin.Context, key string, fallback int) int {
	if raw := c.Query(key); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil {
			return v
		}
	}
	return fallback
}
