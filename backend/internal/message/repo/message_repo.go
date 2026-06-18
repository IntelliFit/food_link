package repo

import (
	"context"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/message/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// User — minimal weapp_user struct for message queries
type User struct {
	ID       string `gorm:"column:id"`
	Nickname string `gorm:"column:nickname"`
	Avatar   string `gorm:"column:avatar"`
}

func (User) TableName() string { return "weapp_user" }

// ConversationSummary — last message + unread count per conversation partner
type ConversationSummary struct {
	UserID      string                `json:"user_id"`
	Nickname    string                `json:"nickname"`
	Avatar      string                `json:"avatar"`
	LastMessage domain.PrivateMessage `json:"last_message"`
	UnreadCount int64                 `json:"unread_count"`
}

type MessageRepo struct {
	db *gorm.DB
}

func NewMessageRepo(db *gorm.DB) *MessageRepo {
	return &MessageRepo{db: db}
}

// CreateMessage inserts a new private message
func (r *MessageRepo) CreateMessage(ctx context.Context, msg *domain.PrivateMessage) error {
	now := time.Now()
	id := uuid.New().String()
	do := &privateMessageDO{
		ID:          id,
		SenderID:    msg.SenderID,
		ReceiverID:  msg.ReceiverID,
		Content:     msg.Content,
		ImageURL:    msg.ImageURL,
		ContentType: msg.ContentType,
		IsRead:      false,
		CreatedAt:   &now,
	}
	if err := r.db.WithContext(ctx).Create(do).Error; err != nil {
		return err
	}
	msg.ID = id
	msg.IsRead = false
	msg.CreatedAt = now
	return nil
}

// GetMessages returns messages between two users, ordered by created_at DESC
func (r *MessageRepo) GetMessages(ctx context.Context, userA, userB string, offset, limit int) ([]domain.PrivateMessage, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var rows []privateMessageDO
	err := r.db.WithContext(ctx).
		Where("(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)", userA, userB, userB, userA).
		Where("deleted_at IS NULL").
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return toDomainList(rows), nil
}

// GetConversations returns one summary per conversation partner for a user
func (r *MessageRepo) GetConversations(ctx context.Context, userID string, offset, limit int) ([]ConversationSummary, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	type rawRow struct {
		OtherID      string    `gorm:"column:other_id"`
		Nickname     string    `gorm:"column:nickname"`
		Avatar       string    `gorm:"column:avatar"`
		LastID       string    `gorm:"column:last_id"`
		LastContent  string    `gorm:"column:last_content"`
		LastImageURL string    `gorm:"column:last_image_url"`
		LastType     string    `gorm:"column:last_type"`
		LastSenderID string    `gorm:"column:last_sender_id"`
		LastCreated  time.Time `gorm:"column:last_created"`
		UnreadCount  int64     `gorm:"column:unread_count"`
	}

	var rows []rawRow
	sql := `
SELECT
  CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AS other_id,
  COALESCE(NULLIF(u.nickname, ''), CASE WHEN CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END = ? THEN '系统消息' ELSE '' END) AS nickname,
  COALESCE(u.avatar, '') AS avatar,
  m.id AS last_id,
  m.content AS last_content,
  m.image_url AS last_image_url,
  m.content_type AS last_type,
  m.sender_id AS last_sender_id,
  m.created_at AS last_created,
  COALESCE(uc.unread_count, 0) AS unread_count
FROM (
  SELECT DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
    id,
    sender_id,
    receiver_id,
    content,
    image_url,
    content_type,
    created_at
  FROM private_messages
  WHERE (sender_id = ? OR receiver_id = ?) AND deleted_at IS NULL
  ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC
) m
LEFT JOIN weapp_user u ON u.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS unread_count
  FROM private_messages
  WHERE sender_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AND receiver_id = ? AND is_read = false AND deleted_at IS NULL
) uc ON true
ORDER BY m.created_at DESC
LIMIT ? OFFSET ?
`

	err := r.db.WithContext(ctx).Raw(sql, userID, userID, domain.SystemSenderID, userID, userID, userID, userID, userID, limit, offset).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	out := make([]ConversationSummary, 0, len(rows))
	for _, r := range rows {
		out = append(out, ConversationSummary{
			UserID:   r.OtherID,
			Nickname: r.Nickname,
			Avatar:   r.Avatar,
			LastMessage: domain.PrivateMessage{
				ID:          r.LastID,
				SenderID:    r.LastSenderID,
				Content:     r.LastContent,
				ImageURL:    r.LastImageURL,
				ContentType: r.LastType,
				CreatedAt:   r.LastCreated,
			},
			UnreadCount: r.UnreadCount,
		})
	}
	return out, nil
}

// MarkRead marks all messages from senderID to userID as read
func (r *MessageRepo) MarkRead(ctx context.Context, userID, senderID string) error {
	return r.db.WithContext(ctx).
		Model(&privateMessageDO{}).
		Where("receiver_id = ? AND sender_id = ? AND is_read = false AND deleted_at IS NULL", userID, senderID).
		Update("is_read", true).Error
}

// CountUnread returns total unread messages for a user
func (r *MessageRepo) CountUnread(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&privateMessageDO{}).
		Where("receiver_id = ? AND is_read = false AND deleted_at IS NULL", userID).
		Count(&count).Error
	return count, err
}

func (r *MessageRepo) FindMessageByID(ctx context.Context, messageID string) (*domain.PrivateMessage, error) {
	var row privateMessageDO
	err := r.db.WithContext(ctx).Where("id = ?", messageID).First(&row).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, &commonerrors.AppError{Code: 10001, Message: "消息不存在", HTTPStatus: 404}
		}
		return nil, err
	}
	msg := toDomain(row)
	return &msg, nil
}

func (r *MessageRepo) SoftDeleteMessage(ctx context.Context, messageID, userID string) error {
	now := time.Now()
	return r.db.WithContext(ctx).
		Model(&privateMessageDO{}).
		Where("id = ? AND deleted_at IS NULL", messageID).
		Updates(map[string]any{
			"deleted_at":         now,
			"deleted_by_user_id": userID,
		}).Error
}

func (r *MessageRepo) FindReport(ctx context.Context, reporterUserID, messageID string) (*domain.PrivateMessageReport, error) {
	var row privateMessageReportDO
	err := r.db.WithContext(ctx).
		Where("reporter_user_id = ? AND message_id = ?", reporterUserID, messageID).
		First(&row).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	report := toReportDomain(row)
	return &report, nil
}

func (r *MessageRepo) CreateReport(ctx context.Context, report *domain.PrivateMessageReport) error {
	now := time.Now()
	id := uuid.New().String()
	row := &privateMessageReportDO{
		ID:                 id,
		ReporterUserID:     report.ReporterUserID,
		ReportedUserID:     report.ReportedUserID,
		MessageID:          report.MessageID,
		Reason:             report.Reason,
		ExtraContent:       report.ExtraContent,
		MessageContent:     report.MessageContent,
		MessageImageURL:    report.MessageImageURL,
		MessageContentType: report.MessageContentType,
		Status:             "pending",
		CreatedAt:          &now,
	}
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		return err
	}
	report.ID = id
	report.Status = row.Status
	report.CreatedAt = now
	return nil
}

// --- internal DO ---

type privateMessageDO struct {
	ID              string     `gorm:"column:id"`
	SenderID        string     `gorm:"column:sender_id"`
	ReceiverID      string     `gorm:"column:receiver_id"`
	Content         string     `gorm:"column:content"`
	ImageURL        string     `gorm:"column:image_url"`
	ContentType     string     `gorm:"column:content_type"`
	IsRead          bool       `gorm:"column:is_read"`
	CreatedAt       *time.Time `gorm:"column:created_at"`
	DeletedAt       *time.Time `gorm:"column:deleted_at"`
	DeletedByUserID *string    `gorm:"column:deleted_by_user_id"`
}

func (privateMessageDO) TableName() string { return "private_messages" }

type privateMessageReportDO struct {
	ID                 string     `gorm:"column:id"`
	ReporterUserID     string     `gorm:"column:reporter_user_id"`
	ReportedUserID     string     `gorm:"column:reported_user_id"`
	MessageID          string     `gorm:"column:message_id"`
	Reason             string     `gorm:"column:reason"`
	ExtraContent       string     `gorm:"column:extra_content"`
	MessageContent     string     `gorm:"column:message_content"`
	MessageImageURL    string     `gorm:"column:message_image_url"`
	MessageContentType string     `gorm:"column:message_content_type"`
	Status             string     `gorm:"column:status"`
	CreatedAt          *time.Time `gorm:"column:created_at"`
}

func (privateMessageReportDO) TableName() string { return "private_message_reports" }

func toDomainList(rows []privateMessageDO) []domain.PrivateMessage {
	out := make([]domain.PrivateMessage, 0, len(rows))
	for _, r := range rows {
		out = append(out, toDomain(r))
	}
	return out
}

func toDomain(r privateMessageDO) domain.PrivateMessage {
	m := domain.PrivateMessage{
		ID:          r.ID,
		SenderID:    r.SenderID,
		ReceiverID:  r.ReceiverID,
		Content:     r.Content,
		ImageURL:    r.ImageURL,
		ContentType: r.ContentType,
		IsRead:      r.IsRead,
		DeletedAt:   r.DeletedAt,
	}
	if r.DeletedByUserID != nil {
		m.DeletedByUserID = *r.DeletedByUserID
	}
	if r.CreatedAt != nil {
		m.CreatedAt = *r.CreatedAt
	}
	return m
}

func toReportDomain(r privateMessageReportDO) domain.PrivateMessageReport {
	report := domain.PrivateMessageReport{
		ID:                 r.ID,
		ReporterUserID:     r.ReporterUserID,
		ReportedUserID:     r.ReportedUserID,
		MessageID:          r.MessageID,
		Reason:             r.Reason,
		ExtraContent:       r.ExtraContent,
		MessageContent:     r.MessageContent,
		MessageImageURL:    r.MessageImageURL,
		MessageContentType: r.MessageContentType,
		Status:             r.Status,
	}
	if r.CreatedAt != nil {
		report.CreatedAt = *r.CreatedAt
	}
	return report
}
