package handler

import (
	"context"
	"strconv"
	"time"

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
	UserCollectionsForViewer(ctx context.Context, viewerUserID, targetUserID string) ([]domain.PublicFoodView, error)
	Get(ctx context.Context, userID, itemID string) (*domain.PublicFoodView, error)
	GetCampusDetail(ctx context.Context, userID, itemID string) (*domain.CampusFoodDetailView, error)
	Like(ctx context.Context, userID, itemID string) error
	Unlike(ctx context.Context, userID, itemID string) error
	Collect(ctx context.Context, userID, itemID string) error
	Uncollect(ctx context.Context, userID, itemID string) error
	ContributeCampusImages(ctx context.Context, userID, itemID string, imagePaths []string) (*service.CampusImageContributionResult, error)
	Update(ctx context.Context, userID, itemID string, input service.CreateInput) error
	Delete(ctx context.Context, userID, itemID string) error
	Comments(ctx context.Context, userID, itemID string) ([]domain.PublicFoodComment, error)
	AddComment(ctx context.Context, userID, itemID string, input service.CommentInput) (*domain.PublicFoodComment, error)
	DeleteComment(ctx context.Context, userID, itemID, commentID string) error
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
		Type               string           `json:"type"`
		IsCampusFood       bool             `json:"is_campus_food"`
		SchoolID           *string          `json:"school_id"`
		CampusID           *string          `json:"campus_id"`
		CanteenID          *string          `json:"canteen_id"`
		WindowID           *string          `json:"window_id"`
		SchoolName         *string          `json:"school_name"`
		CampusName         *string          `json:"campus_name"`
		CanteenName        *string          `json:"canteen_name"`
		Floor              *string          `json:"floor"`
		WindowName         *string          `json:"window_name"`
		Price              *float64         `json:"price"`
		PriceType          *string          `json:"price_type"`
		PriceMin           *float64         `json:"price_min"`
		PriceMax           *float64         `json:"price_max"`
		PriceUnit          *string          `json:"price_unit"`
		PriceCollectedAt   *time.Time       `json:"price_collected_at"`
		PortionDescription *string          `json:"portion_description"`
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
		Type:               body.Type,
		IsCampusFood:       body.IsCampusFood,
		SchoolID:           body.SchoolID,
		CampusID:           body.CampusID,
		CanteenID:          body.CanteenID,
		WindowID:           body.WindowID,
		SchoolName:         body.SchoolName,
		CampusName:         body.CampusName,
		CanteenName:        body.CanteenName,
		Floor:              body.Floor,
		WindowName:         body.WindowName,
		Price:              body.Price,
		PriceType:          body.PriceType,
		PriceMin:           body.PriceMin,
		PriceMax:           body.PriceMax,
		PriceUnit:          body.PriceUnit,
		PriceCollectedAt:   body.PriceCollectedAt,
		PortionDescription: body.PortionDescription,
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
		Keyword:      c.Query("keyword"),
		MerchantName: c.Query("merchant_name"),
		SortBy:       c.DefaultQuery("sort_by", "latest"),
		Limit:        intQuery(c, "limit", 20),
		Offset:       intQuery(c, "offset", 0),
		Type:         c.Query("type"),
		SchoolID:     c.Query("school_id"),
		CampusID:     c.Query("campus_id"),
		CanteenID:    c.Query("canteen_id"),
		WindowID:     c.Query("window_id"),
		SchoolName:   c.Query("school_name"),
		CanteenName:  c.Query("canteen_name"),
		Floor:        c.Query("floor"),
		WindowName:   c.Query("window_name"),
	}
	if raw := c.Query("suitable_for_fat_loss"); raw != "" {
		if v, err := strconv.ParseBool(raw); err == nil {
			filter.SuitableForFatLoss = &v
		}
	}
	if raw := c.Query("is_campus_food"); raw != "" {
		if v, err := strconv.ParseBool(raw); err == nil {
			filter.IsCampusFood = &v
		}
	}
	if raw := c.Query("is_campus_highlight"); raw != "" {
		if v, err := strconv.ParseBool(raw); err == nil {
			filter.IsCampusHighlight = &v
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

func (h *PublicFoodHandler) GetCampusDetail(c *gin.Context) {
	detail, err := h.svc.GetCampusDetail(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, detail)
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

func (h *PublicFoodHandler) ContributeCampusImages(c *gin.Context) {
	var body struct {
		ImagePaths []string `json:"image_paths"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	result, err := h.svc.ContributeCampusImages(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id"), body.ImagePaths)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// GET /api/user/:user_id/collections
func (h *PublicFoodHandler) UserCollections(c *gin.Context) {
	targetUserID := c.Param("user_id")
	items, err := h.svc.UserCollectionsForViewer(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), targetUserID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"list": items})
}

func (h *PublicFoodHandler) Update(c *gin.Context) {
	var body struct {
		ImagePath          *string    `json:"image_path"`
		ImagePaths         []string   `json:"image_paths"`
		Description        *string    `json:"description"`
		Insight            *string    `json:"insight"`
		FoodName           *string    `json:"food_name"`
		MerchantName       *string    `json:"merchant_name"`
		MerchantAddress    *string    `json:"merchant_address"`
		TasteRating        *int       `json:"taste_rating"`
		SuitableForFatLoss bool       `json:"suitable_for_fat_loss"`
		UserTags           []string   `json:"user_tags"`
		UserNotes          *string    `json:"user_notes"`
		Latitude           *float64   `json:"latitude"`
		Longitude          *float64   `json:"longitude"`
		Province           *string    `json:"province"`
		City               *string    `json:"city"`
		District           *string    `json:"district"`
		DetailAddress      *string    `json:"detail_address"`
		Type               string     `json:"type"`
		IsCampusFood       bool       `json:"is_campus_food"`
		SchoolID           *string    `json:"school_id"`
		CampusID           *string    `json:"campus_id"`
		CanteenID          *string    `json:"canteen_id"`
		WindowID           *string    `json:"window_id"`
		SchoolName         *string    `json:"school_name"`
		CampusName         *string    `json:"campus_name"`
		CanteenName        *string    `json:"canteen_name"`
		Floor              *string    `json:"floor"`
		WindowName         *string    `json:"window_name"`
		Price              *float64   `json:"price"`
		PriceType          *string    `json:"price_type"`
		PriceMin           *float64   `json:"price_min"`
		PriceMax           *float64   `json:"price_max"`
		PriceUnit          *string    `json:"price_unit"`
		PriceCollectedAt   *time.Time `json:"price_collected_at"`
		PortionDescription *string    `json:"portion_description"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	if err := h.svc.Update(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id"), service.CreateInput{
		ImagePath:          body.ImagePath,
		ImagePaths:         body.ImagePaths,
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
		Type:               body.Type,
		IsCampusFood:       body.IsCampusFood,
		SchoolID:           body.SchoolID,
		CampusID:           body.CampusID,
		CanteenID:          body.CanteenID,
		WindowID:           body.WindowID,
		SchoolName:         body.SchoolName,
		CampusName:         body.CampusName,
		CanteenName:        body.CanteenName,
		Floor:              body.Floor,
		WindowName:         body.WindowName,
		Price:              body.Price,
		PriceType:          body.PriceType,
		PriceMin:           body.PriceMin,
		PriceMax:           body.PriceMax,
		PriceUnit:          body.PriceUnit,
		PriceCollectedAt:   body.PriceCollectedAt,
		PortionDescription: body.PortionDescription,
	}); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "更新成功"})
}

func (h *PublicFoodHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "删除成功"})
}

func (h *PublicFoodHandler) Comments(c *gin.Context) {
	items, err := h.svc.Comments(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"list": items})
}

func (h *PublicFoodHandler) AddComment(c *gin.Context) {
	var body struct {
		Content         string  `json:"content"`
		Rating          *int    `json:"rating"`
		ParentCommentID *string `json:"parent_comment_id"`
		ReplyToUserID   *string `json:"reply_to_user_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	comment, err := h.svc.AddComment(c.Request.Context(), c.GetString(authmw.ContextUserIDKey), c.Param("item_id"), service.CommentInput{
		Content:         body.Content,
		Rating:          body.Rating,
		ParentCommentID: body.ParentCommentID,
		ReplyToUserID:   body.ReplyToUserID,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"comment": comment})
}

func (h *PublicFoodHandler) DeleteComment(c *gin.Context) {
	err := h.svc.DeleteComment(
		c.Request.Context(),
		c.GetString(authmw.ContextUserIDKey),
		c.Param("item_id"),
		c.Param("comment_id"),
	)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已删除"})
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
