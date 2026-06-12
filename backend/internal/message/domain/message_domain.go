package domain

import "time"

// PrivateMessage — table: private_messages
type PrivateMessage struct {
	ID          string
	SenderID    string
	ReceiverID  string
	Content     string
	ImageURL    string
	ContentType string // text | image
	IsRead      bool
	CreatedAt   time.Time
}
