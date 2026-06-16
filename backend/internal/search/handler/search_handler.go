package handler

import (
	"context"
	"strconv"
	"strings"

	authmw "food_link/backend/internal/auth"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/search/service"

	"github.com/gin-gonic/gin"
)

type SearchService interface {
	SearchContent(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]service.ContentSearchResult, bool, error)
	SearchUsers(ctx context.Context, currentUserID, keyword string, offset, limit int) ([]service.UserSearchResult, bool, error)
	GetSearchCounts(ctx context.Context, currentUserID, keyword string) (*service.SearchCounts, error)
}

type SearchHandler struct {
	svc SearchService
}

func NewSearchHandler(svc SearchService) *SearchHandler {
	return &SearchHandler{svc: svc}
}

func (h *SearchHandler) Search(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("keyword"))
	if keyword == "" {
		response.Error(c, &commonerrors.AppError{Code: 10002, Message: "请输入搜索关键词", HTTPStatus: 400})
		return
	}

	userID := c.GetString(authmw.ContextUserIDKey)
	tab := c.DefaultQuery("tab", "content")
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}

	// 始终获取两个 tab 的数量统计
	counts, _ := h.svc.GetSearchCounts(c.Request.Context(), userID, keyword)
	contentCount := int64(0)
	userCount := int64(0)
	if counts != nil {
		contentCount = counts.ContentCount
		userCount = counts.UserCount
	}

	switch tab {
	case "users":
		list, hasMore, err := h.svc.SearchUsers(c.Request.Context(), userID, keyword, offset, limit)
		if err != nil {
			response.Error(c, err)
			return
		}
		if list == nil {
			list = []service.UserSearchResult{}
		}
		response.Success(c, gin.H{
			"list":          list,
			"has_more":      hasMore,
			"content_count": contentCount,
			"user_count":    userCount,
		})
	default:
		list, hasMore, err := h.svc.SearchContent(c.Request.Context(), userID, keyword, offset, limit)
		if err != nil {
			response.Error(c, err)
			return
		}
		if list == nil {
			list = []service.ContentSearchResult{}
		}
		response.Success(c, gin.H{
			"list":          list,
			"has_more":      hasMore,
			"content_count": contentCount,
			"user_count":    userCount,
		})
	}
}
