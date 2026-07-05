package service

import (
	"context"
	"log/slog"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/message/domain"
	"food_link/backend/internal/message/repo"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
)

type MessageService struct {
	msgRepo      *repo.MessageRepo
	storage      *storage.Client
	blockChecker BlockChecker
}

type BlockChecker interface {
	IsBlockedEither(ctx context.Context, userA, userB string) (bool, error)
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

func (s *MessageService) ConfigureBlockChecker(checker BlockChecker) {
	s.blockChecker = checker
}

// SendMessage validates and creates a new private message
func (s *MessageService) SendMessage(ctx context.Context, senderID, receiverID, content, contentType, imageURL string) (*domain.PrivateMessage, error) {
	if senderID == receiverID {
		return nil, &commonerrors.AppError{Code: 10002, Message: "不能给自己发送消息", HTTPStatus: 400}
	}
	if blocked, err := s.IsBlockedBetween(ctx, senderID, receiverID); err != nil {
		return nil, err
	} else if blocked {
		return nil, &commonerrors.AppError{Code: 20003, Message: "无法发送消息", HTTPStatus: 403}
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

func (s *MessageService) IsBlockedBetween(ctx context.Context, userA, userB string) (bool, error) {
	if s.blockChecker == nil || strings.TrimSpace(userA) == "" || strings.TrimSpace(userB) == "" || userA == userB {
		return false, nil
	}
	return s.blockChecker.IsBlockedEither(ctx, userA, userB)
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

// DeleteMessage soft-deletes a private message for both conversation members.
// Only the sender can recall a message, and only within 15 minutes of sending.
func (s *MessageService) DeleteMessage(ctx context.Context, userID, messageID string) error {
	userID = strings.TrimSpace(userID)
	messageID = strings.TrimSpace(messageID)
	if userID == "" || messageID == "" {
		return &commonerrors.AppError{Code: 10002, Message: "消息 ID 不能为空", HTTPStatus: 400}
	}
	msg, err := s.msgRepo.FindMessageByID(ctx, messageID)
	if err != nil {
		return err
	}
	if msg.ContentType == "system" || msg.SenderID == domain.SystemSenderID {
		return &commonerrors.AppError{Code: 10002, Message: "系统消息不能撤回", HTTPStatus: 400}
	}
	if msg.SenderID != userID {
		logger.Warn(ctx, "私信撤回权限校验失败",
			slog.String("user_id", userID),
			slog.String("message_id", messageID),
			slog.String("sender_id", msg.SenderID),
		)
		return &commonerrors.AppError{Code: 20003, Message: "只能撤回自己发送的消息", HTTPStatus: 403}
	}
	if time.Since(msg.CreatedAt) > 15*time.Minute {
		return &commonerrors.AppError{Code: 10002, Message: "消息已超过 15 分钟，无法撤回", HTTPStatus: 400}
	}
	if msg.DeletedAt != nil {
		return nil
	}
	if err := s.msgRepo.SoftDeleteMessage(ctx, messageID, userID); err != nil {
		logger.Error(ctx, "撤回私信失败", err,
			slog.String("user_id", userID),
			slog.String("message_id", messageID),
		)
		return err
	}
	logger.Info(ctx, "私信已撤回",
		slog.String("user_id", userID),
		slog.String("message_id", messageID),
		slog.String("receiver_id", msg.ReceiverID),
	)
	return nil
}

func (s *MessageService) ReportMessage(ctx context.Context, reporterUserID, messageID, reason, extraContent string) (*domain.PrivateMessageReport, error) {
	reporterUserID = strings.TrimSpace(reporterUserID)
	messageID = strings.TrimSpace(messageID)
	if reporterUserID == "" || messageID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "消息 ID 不能为空", HTTPStatus: 400}
	}
	reason = normalizePrivateMessageReportReason(reason)
	extraContent = strings.TrimSpace(extraContent)
	if len([]rune(extraContent)) > 500 {
		extraContent = string([]rune(extraContent)[:500])
	}
	msg, err := s.msgRepo.FindMessageByID(ctx, messageID)
	if err != nil {
		return nil, err
	}
	if msg.DeletedAt != nil {
		return nil, &commonerrors.AppError{Code: 10001, Message: "消息不存在", HTTPStatus: 404}
	}
	if msg.ContentType == "system" || msg.SenderID == domain.SystemSenderID {
		return nil, &commonerrors.AppError{Code: 10002, Message: "系统消息不能举报", HTTPStatus: 400}
	}
	if msg.SenderID == reporterUserID {
		return nil, &commonerrors.AppError{Code: 10002, Message: "不能举报自己的消息", HTTPStatus: 400}
	}
	if msg.ReceiverID != reporterUserID {
		logger.Warn(ctx, "私信举报权限校验失败",
			slog.String("reporter_user_id", reporterUserID),
			slog.String("message_id", messageID),
			slog.String("sender_id", msg.SenderID),
			slog.String("receiver_id", msg.ReceiverID),
		)
		return nil, &commonerrors.AppError{Code: 20003, Message: "无权举报这条消息", HTTPStatus: 403}
	}
	existing, err := s.msgRepo.FindReport(ctx, reporterUserID, messageID)
	if err != nil {
		logger.Error(ctx, "查询私信举报记录失败", err,
			slog.String("reporter_user_id", reporterUserID),
			slog.String("message_id", messageID),
		)
		return nil, err
	}
	if existing != nil {
		logger.Info(ctx, "私信举报记录已存在",
			slog.String("report_id", existing.ID),
			slog.String("reporter_user_id", reporterUserID),
			slog.String("message_id", messageID),
		)
		return existing, nil
	}
	report := &domain.PrivateMessageReport{
		ReporterUserID:     reporterUserID,
		ReportedUserID:     msg.SenderID,
		MessageID:          msg.ID,
		Reason:             reason,
		ExtraContent:       extraContent,
		MessageContent:     msg.Content,
		MessageImageURL:    msg.ImageURL,
		MessageContentType: msg.ContentType,
		Status:             "pending",
	}
	if err := s.msgRepo.CreateReport(ctx, report); err != nil {
		logger.Error(ctx, "创建私信举报记录失败", err,
			slog.String("reporter_user_id", reporterUserID),
			slog.String("reported_user_id", msg.SenderID),
			slog.String("message_id", messageID),
		)
		return nil, err
	}
	logger.Info(ctx, "私信举报记录已创建",
		slog.String("report_id", report.ID),
		slog.String("reporter_user_id", reporterUserID),
		slog.String("reported_user_id", report.ReportedUserID),
		slog.String("message_id", messageID),
		slog.String("reason", reason),
	)
	return report, nil
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
	resolved := s.storage.ResolveUserAvatarURL(value)
	if resolved == "" {
		return value
	}
	return resolved
}

func normalizePrivateMessageReportReason(reason string) string {
	switch strings.TrimSpace(reason) {
	case "spam", "porn", "illegal", "abuse", "other":
		return strings.TrimSpace(reason)
	case "harassment":
		return "abuse"
	case "inappropriate":
		return "porn"
	default:
		return "other"
	}
}
