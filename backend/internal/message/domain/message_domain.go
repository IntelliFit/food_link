package domain

import "time"

// SystemSenderID 是系统消息的固定发送者 ID。
const SystemSenderID = "00000000-0000-0000-0000-000000000000"

// PrivateMessage — table: private_messages
type PrivateMessage struct {
	ID              string     `json:"id"`
	SenderID        string     `json:"sender_id"`
	ReceiverID      string     `json:"receiver_id"`
	Content         string     `json:"content"`
	ImageURL        string     `json:"image_url"`
	ContentType     string     `json:"content_type"` // text | image | system
	IsRead          bool       `json:"is_read"`
	CreatedAt       time.Time  `json:"created_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	DeletedByUserID string     `json:"deleted_by_user_id,omitempty"`
}

type PrivateMessageReport struct {
	ID                 string    `json:"id"`
	ReporterUserID     string    `json:"reporter_user_id"`
	ReportedUserID     string    `json:"reported_user_id"`
	MessageID          string    `json:"message_id"`
	Reason             string    `json:"reason"`
	ExtraContent       string    `json:"extra_content"`
	MessageContent     string    `json:"message_content"`
	MessageImageURL    string    `json:"message_image_url"`
	MessageContentType string    `json:"message_content_type"`
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"created_at"`
}
