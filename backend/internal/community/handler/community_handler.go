package handler

import (
	"context"
	"io"
	"strconv"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/community/domain"
	"food_link/backend/internal/community/service"

	"github.com/gin-gonic/gin"
)

type CommunityService interface {
	PublicFeed(ctx context.Context, params service.FeedParams) ([]service.FeedItem, error)
	FriendFeed(ctx context.Context, userID string, params service.FeedParams) ([]service.FeedItem, error)
	CheckinLeaderboard(ctx context.Context, viewerUserID string) (*service.LeaderboardResult, error)
	LikeFeed(ctx context.Context, userID, recordID string) (string, error)
	LikeFeedTarget(ctx context.Context, userID, targetType, targetID string) (string, error)
	UnlikeFeed(ctx context.Context, userID, recordID string) (string, error)
	UnlikeFeedTarget(ctx context.Context, userID, targetType, targetID string) (string, error)
	HideFeed(ctx context.Context, userID, recordID string) error
	HideFeedTarget(ctx context.Context, userID, targetType, targetID string) error
	ListComments(ctx context.Context, viewerUserID, recordID string, limit int) ([]service.CommentItem, error)
	ListTargetComments(ctx context.Context, viewerUserID, targetType, targetID string, limit int) ([]service.CommentItem, error)
	FeedContext(ctx context.Context, userID, recordID string) (*service.FeedContextResult, error)
	FeedTargetContext(ctx context.Context, userID, targetType, targetID string) (*service.FeedContextResult, error)
	PostComment(ctx context.Context, userID, recordID, content string, parentCommentID, replyToUserID *string) (*service.CommentItem, error)
	PostTargetComment(ctx context.Context, userID, targetType, targetID, content string, parentCommentID, replyToUserID *string) (*service.CommentItem, error)
	DeleteTargetComment(ctx context.Context, userID, targetType, targetID, commentID string) (int64, error)
	ListCommentTasks(ctx context.Context, userID string, limit int) ([]domain.CommentTask, error)
	ListNotifications(ctx context.Context, userID, notificationType string, limit, offset int) (*service.NotificationListResult, error)
	MarkNotificationsRead(ctx context.Context, userID string, notificationIDs []string) (*service.MarkReadResult, error)
	UploadCirclePostImage(ctx context.Context, userID string, fileBytes []byte, ext, contentType string) (string, error)
	CreateCirclePost(ctx context.Context, userID, title, body string, imageURLs []string, nutrition *domain.CirclePostNutrition) (string, error)
	UpdateCirclePost(ctx context.Context, userID, postID, title, body string, imageURLs []string, nutrition *domain.CirclePostNutrition) error
	DeleteCirclePost(ctx context.Context, userID, postID string) error
	ReportFeedTarget(ctx context.Context, reporterUserID, targetType, targetID, reason, extraContent string) (*domain.FeedReport, error)
}

type CommunityHandler struct {
	svc CommunityService
}

func NewCommunityHandler(svc CommunityService) *CommunityHandler {
	return &CommunityHandler{svc: svc}
}

func (h *CommunityHandler) PublicFeed(c *gin.Context) {
	params := parseFeedParams(c)
	params.AuthorID = c.Query("author_id")
	params.ViewerUserID = c.GetString(authmw.ContextUserIDKey)
	items, err := h.svc.PublicFeed(c.Request.Context(), params)
	if err != nil {
		response.Error(c, err)
		return
	}
	if items == nil {
		items = []service.FeedItem{}
	}
	response.Success(c, gin.H{"list": items, "has_more": len(items) >= params.Limit})
}

func (h *CommunityHandler) Feed(c *gin.Context) {
	params := parseFeedParams(c)
	params.PriorityAuthorIDs = strings.Split(c.Query("priority_author_ids"), ",")
	params.AuthorScope = c.Query("author_scope")
	params.AuthorID = c.Query("author_id")
	userID := c.GetString(authmw.ContextUserIDKey)
	items, err := h.svc.FriendFeed(c.Request.Context(), userID, params)
	if err != nil {
		response.Error(c, err)
		return
	}
	if items == nil {
		items = []service.FeedItem{}
	}
	response.Success(c, gin.H{"list": items, "has_more": len(items) >= params.Limit})
}

func (h *CommunityHandler) CheckinLeaderboard(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.svc.CheckinLeaderboard(c.Request.Context(), userID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *CommunityHandler) LikeFeed(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	msg, err := h.svc.LikeFeed(c.Request.Context(), userID, recordID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": msg})
}

func (h *CommunityHandler) LikeFeedTarget(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	msg, err := h.svc.LikeFeedTarget(c.Request.Context(), userID, c.Param("target_type"), c.Param("target_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": msg})
}

func (h *CommunityHandler) UnlikeFeed(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	msg, err := h.svc.UnlikeFeed(c.Request.Context(), userID, recordID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": msg})
}

func (h *CommunityHandler) UnlikeFeedTarget(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	msg, err := h.svc.UnlikeFeedTarget(c.Request.Context(), userID, c.Param("target_type"), c.Param("target_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": msg})
}

func (h *CommunityHandler) HideFeed(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	if err := h.svc.HideFeed(c.Request.Context(), userID, recordID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已隐藏"})
}

func (h *CommunityHandler) HideFeedTarget(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.svc.HideFeedTarget(c.Request.Context(), userID, c.Param("target_type"), c.Param("target_id")); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已隐藏"})
}

func (h *CommunityHandler) ListComments(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	items, err := h.svc.ListComments(c.Request.Context(), userID, recordID, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"list": items})
}

func (h *CommunityHandler) ListTargetComments(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	items, err := h.svc.ListTargetComments(c.Request.Context(), userID, c.Param("target_type"), c.Param("target_id"), limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"list": items})
}

func (h *CommunityHandler) FeedContext(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	result, err := h.svc.FeedContext(c.Request.Context(), userID, recordID)
	if err != nil {
		response.Error(c, err)
		return
	}
	if !result.Allowed {
		if result.Reason == "not_found" {
			response.Error(c, commonerrors.ErrNotFound)
			return
		}
		response.Error(c, commonerrors.ErrForbidden)
		return
	}
	response.Success(c, gin.H{"item": result})
}

func (h *CommunityHandler) FeedTargetContext(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.svc.FeedTargetContext(c.Request.Context(), userID, c.Param("target_type"), c.Param("target_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	if !result.Allowed {
		if result.Reason == "not_found" {
			response.Error(c, commonerrors.ErrNotFound)
			return
		}
		response.Error(c, commonerrors.ErrForbidden)
		return
	}
	response.Success(c, gin.H{"item": result})
}

func (h *CommunityHandler) PostComment(c *gin.Context) {
	var body struct {
		Content         string  `json:"content"`
		ParentCommentID *string `json:"parent_comment_id"`
		ReplyToUserID   *string `json:"reply_to_user_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	comment, err := h.svc.PostComment(c.Request.Context(), userID, recordID, body.Content, body.ParentCommentID, body.ReplyToUserID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"comment": comment})
}

func (h *CommunityHandler) PostTargetComment(c *gin.Context) {
	var body struct {
		Content         string  `json:"content"`
		ParentCommentID *string `json:"parent_comment_id"`
		ReplyToUserID   *string `json:"reply_to_user_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	comment, err := h.svc.PostTargetComment(c.Request.Context(), userID, c.Param("target_type"), c.Param("target_id"), body.Content, body.ParentCommentID, body.ReplyToUserID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"comment": comment})
}

func (h *CommunityHandler) DeleteTargetComment(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	deleted, err := h.svc.DeleteTargetComment(c.Request.Context(), userID, c.Param("target_type"), c.Param("target_id"), c.Param("comment_id"))
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"deleted": deleted})
}

func (h *CommunityHandler) ListCommentTasks(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	tasks, err := h.svc.ListCommentTasks(c.Request.Context(), userID, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"list": tasks})
}

func (h *CommunityHandler) ListNotifications(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			limit = n
		}
	}
	notificationType := c.Query("type")
	offset := 0
	if o := c.Query("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}
	result, err := h.svc.ListNotifications(c.Request.Context(), userID, notificationType, limit, offset)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *CommunityHandler) MarkNotificationsRead(c *gin.Context) {
	var body struct {
		NotificationIDs []string `json:"notification_ids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.svc.MarkNotificationsRead(c.Request.Context(), userID, body.NotificationIDs)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

func (h *CommunityHandler) UploadCirclePostImage(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	defer file.Close()
	contentType := header.Header.Get("Content-Type")
	ext := ""
	if header.Filename != "" {
		parts := strings.Split(header.Filename, ".")
		if len(parts) > 1 {
			ext = "." + parts[len(parts)-1]
		}
	}
	fileBytes, err := io.ReadAll(file)
	if err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	imageURL, err := h.svc.UploadCirclePostImage(c.Request.Context(), userID, fileBytes, ext, contentType)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"image_url": imageURL})
}

func (h *CommunityHandler) CreateCirclePost(c *gin.Context) {
	var body struct {
		Title     string   `json:"title"`
		Body      string   `json:"body"`
		ImageURLs []string `json:"image_urls"`
		Nutrition struct {
			TotalCalories    *float64 `json:"total_calories"`
			TotalProtein     *float64 `json:"total_protein"`
			TotalCarbs       *float64 `json:"total_carbs"`
			TotalFat         *float64 `json:"total_fat"`
			Fiber            *float64 `json:"fiber"`
			Sugar            *float64 `json:"sugar"`
			SodiumMg         *float64 `json:"sodium_mg"`
			TotalWeightGrams *float64 `json:"total_weight_grams"`
		} `json:"nutrition"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	nutrition := circlePostNutritionFromBody(body.Nutrition)
	postID, err := h.svc.CreateCirclePost(c.Request.Context(), userID, body.Title, body.Body, body.ImageURLs, nutrition)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"id": postID})
}

func (h *CommunityHandler) UpdateCirclePost(c *gin.Context) {
	var body struct {
		Title     string   `json:"title"`
		Body      string   `json:"body"`
		ImageURLs []string `json:"image_urls"`
		Nutrition struct {
			TotalCalories    *float64 `json:"total_calories"`
			TotalProtein     *float64 `json:"total_protein"`
			TotalCarbs       *float64 `json:"total_carbs"`
			TotalFat         *float64 `json:"total_fat"`
			Fiber            *float64 `json:"fiber"`
			Sugar            *float64 `json:"sugar"`
			SodiumMg         *float64 `json:"sodium_mg"`
			TotalWeightGrams *float64 `json:"total_weight_grams"`
		} `json:"nutrition"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	postID := c.Param("post_id")
	nutrition := circlePostNutritionFromBody(body.Nutrition)
	if err := h.svc.UpdateCirclePost(c.Request.Context(), userID, postID, body.Title, body.Body, body.ImageURLs, nutrition); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"id": postID})
}

func circlePostNutritionFromBody(n struct {
	TotalCalories    *float64 `json:"total_calories"`
	TotalProtein     *float64 `json:"total_protein"`
	TotalCarbs       *float64 `json:"total_carbs"`
	TotalFat         *float64 `json:"total_fat"`
	Fiber            *float64 `json:"fiber"`
	Sugar            *float64 `json:"sugar"`
	SodiumMg         *float64 `json:"sodium_mg"`
	TotalWeightGrams *float64 `json:"total_weight_grams"`
}) *domain.CirclePostNutrition {
	if n.TotalCalories == nil && n.TotalProtein == nil && n.TotalCarbs == nil && n.TotalFat == nil &&
		n.Fiber == nil && n.Sugar == nil && n.SodiumMg == nil && n.TotalWeightGrams == nil {
		return nil
	}
	return &domain.CirclePostNutrition{
		TotalCalories:    n.TotalCalories,
		TotalProtein:     n.TotalProtein,
		TotalCarbs:       n.TotalCarbs,
		TotalFat:         n.TotalFat,
		Fiber:            n.Fiber,
		Sugar:            n.Sugar,
		SodiumMg:         n.SodiumMg,
		TotalWeightGrams: n.TotalWeightGrams,
	}
}

func (h *CommunityHandler) DeleteCirclePost(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	postID := c.Param("post_id")
	if err := h.svc.DeleteCirclePost(c.Request.Context(), userID, postID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已删除"})
}

func (h *CommunityHandler) ReportFeedTarget(c *gin.Context) {
	var body struct {
		Reason       string `json:"reason"`
		ExtraContent string `json:"extra_content"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, commonerrors.ErrBadRequest)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	targetType := c.Param("target_type")
	targetID := c.Param("target_id")
	report, err := h.svc.ReportFeedTarget(c.Request.Context(), userID, targetType, targetID, body.Reason, body.ExtraContent)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"id": report.ID, "status": report.Status})
}

func parseFeedParams(c *gin.Context) service.FeedParams {
	params := service.FeedParams{
		Offset:          0,
		Limit:           20,
		IncludeComments: true,
		CommentsLimit:   5,
		SortBy:          "latest",
	}
	if o := c.Query("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			params.Offset = n
		}
	}
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 {
			params.Limit = n
		}
	}
	if ic := c.Query("include_comments"); ic == "false" {
		params.IncludeComments = false
	}
	if cl := c.Query("comments_limit"); cl != "" {
		if n, err := strconv.Atoi(cl); err == nil && n >= 0 {
			params.CommentsLimit = n
		}
	}
	params.MealType = c.Query("meal_type")
	params.DietGoal = c.Query("diet_goal")
	params.Date = c.Query("date")
	params.ContentType = c.Query("content_type")
	if s := c.Query("sort_by"); s != "" {
		params.SortBy = s
	}
	return params
}
