package handler

import (
	"context"
	"strconv"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/message/domain"
	"food_link/backend/internal/message/repo"

	"github.com/gin-gonic/gin"
)

type MessageService interface {
	SendMessage(ctx context.Context, senderID, receiverID, content, contentType, imageURL string) (*domain.PrivateMessage, error)
	GetMessages(ctx context.Context, userA, userB string, offset, limit int) ([]domain.PrivateMessage, error)
	GetConversations(ctx context.Context, userID string, offset, limit int) ([]repo.ConversationSummary, error)
	IsBlockedBetween(ctx context.Context, userA, userB string) (bool, error)
	MarkRead(ctx context.Context, userID, senderID string) error
	CountUnread(ctx context.Context, userID string) (int64, error)
	DeleteMessage(ctx context.Context, userID, messageID string) error
	ReportMessage(ctx context.Context, reporterUserID, messageID, reason, extraContent string) (*domain.PrivateMessageReport, error)
}

type MessageHandler struct {
	msgSvc MessageService
}

func NewMessageHandler(msgSvc MessageService) *MessageHandler {
	return &MessageHandler{msgSvc: msgSvc}
}

// POST /api/messages/send
func (h *MessageHandler) Send(c *gin.Context) {
	senderID := c.GetString(authmw.ContextUserIDKey)
	var body struct {
		ReceiverID  string `json:"receiver_id" binding:"required"`
		Content     string `json:"content"`
		ContentType string `json:"content_type"`
		ImageURL    string `json:"image_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	msg, err := h.msgSvc.SendMessage(c.Request.Context(), senderID, body.ReceiverID, body.Content, body.ContentType, body.ImageURL)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, msg)
}

// GET /api/messages/conversation/:user_id
func (h *MessageHandler) GetConversation(c *gin.Context) {
	currentUserID := c.GetString(authmw.ContextUserIDKey)
	otherUserID := c.Param("user_id")
	offset, _ := strconv.Atoi(c.Query("offset"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	msgs, err := h.msgSvc.GetMessages(c.Request.Context(), currentUserID, otherUserID, offset, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	if msgs == nil {
		msgs = []domain.PrivateMessage{}
	}
	blocked, err := h.msgSvc.IsBlockedBetween(c.Request.Context(), currentUserID, otherUserID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]any{
		"list":     msgs,
		"has_more": len(msgs) >= limit,
		"offset":   offset,
		"blocked":  blocked,
	})
}

// GET /api/messages/conversations
func (h *MessageHandler) GetConversations(c *gin.Context) {
	currentUserID := c.GetString(authmw.ContextUserIDKey)
	offset, _ := strconv.Atoi(c.Query("offset"))
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	sums, err := h.msgSvc.GetConversations(c.Request.Context(), currentUserID, offset, limit)
	if err != nil {
		response.Error(c, err)
		return
	}
	if sums == nil {
		sums = []repo.ConversationSummary{}
	}
	response.Success(c, map[string]any{
		"list":     sums,
		"offset":   offset,
		"limit":    limit,
		"has_more": len(sums) >= limit,
	})
}

// PUT /api/messages/read/:user_id
func (h *MessageHandler) MarkRead(c *gin.Context) {
	currentUserID := c.GetString(authmw.ContextUserIDKey)
	senderID := c.Param("user_id")
	if err := h.msgSvc.MarkRead(c.Request.Context(), currentUserID, senderID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]bool{"success": true})
}

// GET /api/messages/unread-count
func (h *MessageHandler) GetUnreadCount(c *gin.Context) {
	currentUserID := c.GetString(authmw.ContextUserIDKey)
	count, err := h.msgSvc.CountUnread(c.Request.Context(), currentUserID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, map[string]int64{"count": count})
}

// DELETE /api/messages/message/:message_id
func (h *MessageHandler) DeleteMessage(c *gin.Context) {
	currentUserID := c.GetString(authmw.ContextUserIDKey)
	messageID := c.Param("message_id")
	if err := h.msgSvc.DeleteMessage(c.Request.Context(), currentUserID, messageID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已删除"})
}

// POST /api/messages/message/:message_id/report
func (h *MessageHandler) ReportMessage(c *gin.Context) {
	currentUserID := c.GetString(authmw.ContextUserIDKey)
	messageID := c.Param("message_id")
	var body struct {
		Reason       string `json:"reason"`
		ExtraContent string `json:"extra_content"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	report, err := h.msgSvc.ReportMessage(c.Request.Context(), currentUserID, messageID, body.Reason, body.ExtraContent)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"id": report.ID, "status": report.Status})
}
