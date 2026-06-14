package domain

import "time"

// SystemSenderID 是系统消息的固定发送者 ID。
const SystemSenderID = "00000000-0000-0000-0000-000000000000"

// PrivateMessage — table: private_messages
type PrivateMessage struct {
	ID          string
	SenderID    string
	ReceiverID  string
	Content     string
	ImageURL    string
	ContentType string // text | image | system
	IsRead      bool
	CreatedAt   time.Time
}
