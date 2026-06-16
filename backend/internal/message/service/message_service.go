package service

import (
	"context"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/message/domain"
	"food_link/backend/internal/message/repo"
	"food_link/backend/pkg/storage"
)

type MessageService struct {
	msgRepo *repo.MessageRepo
	storage *storage.Client
}

func NewMessageService(msgRepo *repo.MessageRepo, storageClient ...*storage.Client) *MessageService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &MessageService{
		msgRepo: msgRepo,
		storage: client,
	}
}

// SendMessage validates and creates a new private message
func (s *MessageService) SendMessage(ctx context.Context, senderID, receiverID, content, contentType, imageURL string) (*domain.PrivateMessage, error) {
	if senderID == receiverID {
		return nil, &commonerrors.AppError{Code: 10002, Message: "不能给自己发送消息", HTTPStatus: 400}
	}
	if contentType != "text" && contentType != "image" {
		contentType = "text"
	}
	if contentType == "text" && strings.TrimSpace(content) == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "消息内容不能为空", HTTPStatus: 400}
	}
	if contentType == "image" && strings.TrimSpace(imageURL) == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "图片不能为空", HTTPStatus: 400}
	}

	msg := &domain.PrivateMessage{
		SenderID:    senderID,
		ReceiverID:  receiverID,
		Content:     strings.TrimSpace(content),
		ImageURL:    imageURL,
		ContentType: contentType,
		CreatedAt:   time.Now(),
	}
	if err := s.msgRepo.CreateMessage(ctx, msg); err != nil {
		return nil, err
	}
	// resolve image URL for response
	if msg.ImageURL != "" {
		msg.ImageURL = s.resolveImageURL(msg.ImageURL)
	}
	return msg, nil
}

// SendSystemMessage 向指定用户发送一条系统消息。
func (s *MessageService) SendSystemMessage(ctx context.Context, receiverID, content string) error {
	receiverID = strings.TrimSpace(receiverID)
	if receiverID == "" {
		return &commonerrors.AppError{Code: 10002, Message: "接收者 ID 不能为空", HTTPStatus: 400}
	}
	if strings.TrimSpace(content) == "" {
		return &commonerrors.AppError{Code: 10002, Message: "消息内容不能为空", HTTPStatus: 400}
	}
	msg := &domain.PrivateMessage{
		SenderID:    domain.SystemSenderID,
		ReceiverID:  receiverID,
		Content:     strings.TrimSpace(content),
		ContentType: "system",
		CreatedAt:   time.Now(),
	}
	return s.msgRepo.CreateMessage(ctx, msg)
}

// GetMessages returns paginated messages between two users (newest first)
func (s *MessageService) GetMessages(ctx context.Context, userA, userB string, offset, limit int) ([]domain.PrivateMessage, error) {
	msgs, err := s.msgRepo.GetMessages(ctx, userA, userB, offset, limit)
	if err != nil {
		return nil, err
	}
	for i := range msgs {
		if msgs[i].ImageURL != "" {
			msgs[i].ImageURL = s.resolveImageURL(msgs[i].ImageURL)
		}
	}
	return msgs, nil
}

// GetConversations returns conversation summaries for a user
func (s *MessageService) GetConversations(ctx context.Context, userID string, offset, limit int) ([]repo.ConversationSummary, error) {
	sums, err := s.msgRepo.GetConversations(ctx, userID, offset, limit)
	if err != nil {
		return nil, err
	}
	for i := range sums {
		if sums[i].Avatar != "" {
			sums[i].Avatar = s.resolveAvatarURL(sums[i].Avatar)
		}
		if sums[i].LastMessage.ImageURL != "" {
			sums[i].LastMessage.ImageURL = s.resolveImageURL(sums[i].LastMessage.ImageURL)
		}
	}
	return sums, nil
}

// MarkRead marks all messages from senderID to userID as read
func (s *MessageService) MarkRead(ctx context.Context, userID, senderID string) error {
	return s.msgRepo.MarkRead(ctx, userID, senderID)
}

// CountUnread returns total unread count for a user
func (s *MessageService) CountUnread(ctx context.Context, userID string) (int64, error) {
	return s.msgRepo.CountUnread(ctx, userID)
}

func (s *MessageService) resolveImageURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("food-images", value)
	if resolved == "" {
		return value
	}
	return resolved
}

func (s *MessageService) resolveAvatarURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("user-avatars", value)
	if resolved == "" {
		return value
	}
	return resolved
}
