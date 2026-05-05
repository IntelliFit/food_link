package handler

import (
	authmw "food_link/backend/internal/auth"
	userrepo "food_link/backend/internal/auth/repo"
	homerepo "food_link/backend/internal/home/repo"

	"github.com/gin-gonic/gin"
)

type CommentHandler struct {
	home  *homerepo.HomeRepo
	users *userrepo.UserRepo
}

func NewCommentHandler(home *homerepo.HomeRepo, users *userrepo.UserRepo) *CommentHandler {
	return &CommentHandler{home: home, users: users}
}

func (h *CommentHandler) DeleteComment(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	commentID := c.Param("comment_id")

	record, err := h.home.GetFoodRecordByID(c.Request.Context(), recordID)
	if err != nil {
		c.JSON(500, gin.H{"detail": "删除失败"})
		return
	}
	if record == nil {
		c.JSON(404, gin.H{"detail": "动态不存在"})
		return
	}
	comments, err := h.home.ListRecordComments(c.Request.Context(), recordID)
	if err != nil {
		c.JSON(500, gin.H{"detail": "删除失败"})
		return
	}
	var target *homerepo.FeedComment
	for _, item := range comments {
		if item.ID == commentID {
			target = &item
			break
		}
	}
	if target == nil {
		c.JSON(404, gin.H{"detail": "评论不存在"})
		return
	}
	if target.UserID != userID && record.UserID != userID {
		c.JSON(403, gin.H{"detail": "无权删除该评论"})
		return
	}
	deleted, err := h.home.DeleteCommentCascade(c.Request.Context(), recordID, commentID)
	if err != nil {
		c.JSON(500, gin.H{"detail": "删除失败"})
		return
	}
	c.JSON(200, gin.H{"deleted": deleted})
}
