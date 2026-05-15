package domain

import "time"

type FeedLike struct {
	ID        string     `gorm:"column:id"`
	UserID    string     `gorm:"column:user_id"`
	RecordID  string     `gorm:"column:record_id"`
	CreatedAt *time.Time `gorm:"column:created_at"`
}

func (FeedLike) TableName() string { return "feed_likes" }

type FeedComment struct {
	ID              string     `gorm:"column:id"`
	UserID          string     `gorm:"column:user_id"`
	RecordID        string     `gorm:"column:record_id"`
	ParentCommentID *string    `gorm:"column:parent_comment_id"`
	ReplyToUserID   *string    `gorm:"column:reply_to_user_id"`
	Content         string     `gorm:"column:content"`
	CreatedAt       *time.Time `gorm:"column:created_at"`
}

func (FeedComment) TableName() string { return "feed_comments" }

type FeedInteractionNotification struct {
	ID               string     `gorm:"column:id"`
	RecipientUserID  string     `gorm:"column:recipient_user_id"`
	ActorUserID      *string    `gorm:"column:actor_user_id"`
	RecordID         *string    `gorm:"column:record_id"`
	CommentID        *string    `gorm:"column:comment_id"`
	ParentCommentID  *string    `gorm:"column:parent_comment_id"`
	NotificationType string     `gorm:"column:notification_type"`
	ContentPreview   *string    `gorm:"column:content_preview"`
	IsRead           bool       `gorm:"column:is_read"`
	CreatedAt        *time.Time `gorm:"column:created_at"`
}

func (FeedInteractionNotification) TableName() string { return "feed_interaction_notifications" }

type CommentTask struct {
	ID          string     `gorm:"column:id"`
	UserID      string     `gorm:"column:user_id"`
	TargetID    string     `gorm:"column:target_id"`
	Content     string     `gorm:"column:content"`
	Status      string     `gorm:"column:status"`
	CommentType string     `gorm:"column:comment_type"`
	CreatedAt   *time.Time `gorm:"column:created_at"`
	UpdatedAt   *time.Time `gorm:"column:updated_at"`
}

func (CommentTask) TableName() string { return "comment_tasks" }
