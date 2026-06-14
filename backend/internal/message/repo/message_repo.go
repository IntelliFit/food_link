package repo

import (
	"context"
	"time"

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
	UserID       string
	Nickname     string
	Avatar       string
	LastMessage  domain.PrivateMessage
	UnreadCount  int64
}

type MessageRepo struct {
	db *gorm.DB
}

func NewMessageRepo(db *gorm.DB) *MessageRepo {
	return &MessageRepo{db: db}
}

// CreateMessage inserts a new private message
func (r *MessageRepo) CreateMessage(ctx context.Context, msg *domain.PrivateMessage) error {
	do := &privateMessageDO{
		ID:          uuid.New().String(),
		SenderID:    msg.SenderID,
		ReceiverID:  msg.ReceiverID,
		Content:     msg.Content,
		ImageURL:    msg.ImageURL,
		ContentType: msg.ContentType,
		IsRead:      false,
	}
	return r.db.WithContext(ctx).Create(do).Error
}

// GetMessages returns messages between two users, ordered by created_at DESC
func (r *MessageRepo) GetMessages(ctx context.Context, userA, userB string, offset, limit int) ([]domain.PrivateMessage, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var rows []privateMessageDO
	err := r.db.WithContext(ctx).
		Where("(sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)", userA, userB, userB, userA).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return toDomainList(rows), nil
}

// GetConversations returns one summary per conversation partner for a user
func (r *MessageRepo) GetConversations(ctx context.Context, userID string) ([]ConversationSummary, error) {
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
  u.id AS other_id,
  COALESCE(u.nickname, CASE WHEN CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END = ? THEN '系统消息' ELSE '' END) AS nickname,
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
  WHERE sender_id = ? OR receiver_id = ?
  ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC
) m
LEFT JOIN weapp_user u ON u.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS unread_count
  FROM private_messages
  WHERE sender_id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END AND receiver_id = ? AND is_read = false
) uc ON true
ORDER BY m.created_at DESC
`

	err := r.db.WithContext(ctx).Raw(sql, userID, domain.SystemSenderID, userID, userID, userID, userID, userID).Scan(&rows).Error
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
		Where("receiver_id = ? AND sender_id = ? AND is_read = false", userID, senderID).
		Update("is_read", true).Error
}

// CountUnread returns total unread messages for a user
func (r *MessageRepo) CountUnread(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&privateMessageDO{}).
		Where("receiver_id = ? AND is_read = false", userID).
		Count(&count).Error
	return count, err
}

// --- internal DO ---

type privateMessageDO struct {
	ID          string     `gorm:"column:id"`
	SenderID    string     `gorm:"column:sender_id"`
	ReceiverID  string     `gorm:"column:receiver_id"`
	Content     string     `gorm:"column:content"`
	ImageURL    string     `gorm:"column:image_url"`
	ContentType string     `gorm:"column:content_type"`
	IsRead      bool       `gorm:"column:is_read"`
	CreatedAt   *time.Time `gorm:"column:created_at"`
}

func (privateMessageDO) TableName() string { return "private_messages" }

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
	}
	if r.CreatedAt != nil {
		m.CreatedAt = *r.CreatedAt
	}
	return m
}
