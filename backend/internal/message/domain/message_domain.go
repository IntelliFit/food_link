package domain

import "time"

// SystemSenderID 是系统消息的固定发送者 ID。
const SystemSenderID = "00000000-0000-0000-0000-000000000000"

// PrivateMessage — table: private_messages
type PrivateMessage struct {
	ID          string    `json:"id"`
	SenderID    string    `json:"sender_id"`
	ReceiverID  string    `json:"receiver_id"`
	Content     string    `json:"content"`
	ImageURL    string    `json:"image_url"`
	ContentType string    `json:"content_type"` // text | image | system
	IsRead      bool      `json:"is_read"`
	CreatedAt   time.Time `json:"created_at"`
}
