package handler

import (
	"context"
	"strconv"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"

	"github.com/gin-gonic/gin"
)

type FollowService interface {
	Follow(ctx context.Context, followerID, followeeID string) error
	Unfollow(ctx context.Context, followerID, followeeID string) error
	GetFollowers(ctx context.Context, userID string, offset, limit int) ([]map[string]any, error)
	GetFollowing(ctx context.Context, userID string, offset, limit int) ([]map[string]any, error)
	GetFollowStats(ctx context.Context, userID, currentUserID string) (map[string]any, error)
}

type FollowHandler struct {
	followSvc FollowService
}

func NewFollowHandler(followSvc FollowService) *FollowHandler {
	return &FollowHandler{followSvc: followSvc}
}

// POST /api/user/:user_id/follow
func (h *FollowHandler) Follow(c *gin.Context) {
	followerID := c.GetString(authmw.ContextUserIDKey)
	followeeID := c.Param("user_id")
	if err := h.followSvc.Follow(c.Request.Context(), followerID, followeeID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]bool{"success": true})
}

// DELETE /api/user/:user_id/follow
func (h *FollowHandler) Unfollow(c *gin.Context) {
	followerID := c.GetString(authmw.ContextUserIDKey)
	followeeID := c.Param("user_id")
	if err := h.followSvc.Unfollow(c.Request.Context(), followerID, followeeID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]bool{"success": true})
}

// GET /api/user/:user_id/followers
func (h *FollowHandler) GetFollowers(c *gin.Context) {
	userID := c.Param("user_id")
	offset, _ := strconv.Atoi(c.Query("offset"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	list, err := h.followSvc.GetFollowers(c.Request.Context(), userID, offset, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	if list == nil {
		list = []map[string]any{}
	}
	response.Success(c, map[string]any{
		"list":      list,
		"has_more":  len(list) >= limit,
		"offset":    offset,
	})
}

// GET /api/user/:user_id/following
func (h *FollowHandler) GetFollowing(c *gin.Context) {
	userID := c.Param("user_id")
	offset, _ := strconv.Atoi(c.Query("offset"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	list, err := h.followSvc.GetFollowing(c.Request.Context(), userID, offset, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	if list == nil {
		list = []map[string]any{}
	}
	response.Success(c, map[string]any{
		"list":      list,
		"has_more":  len(list) >= limit,
		"offset":    offset,
	})
}

// GET /api/user/:user_id/follow-stats
func (h *FollowHandler) GetFollowStats(c *gin.Context) {
	userID := c.Param("user_id")
	currentUserID := c.GetString(authmw.ContextUserIDKey)
	stats, err := h.followSvc.GetFollowStats(c.Request.Context(), userID, currentUserID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, stats)
}
