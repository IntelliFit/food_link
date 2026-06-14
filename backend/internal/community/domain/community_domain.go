package domain

import "time"

type FeedLike struct {
	ID         string     `gorm:"column:id"`
	UserID     string     `gorm:"column:user_id"`
	RecordID   *string    `gorm:"column:record_id"`
	TargetType string     `gorm:"column:target_type"`
	TargetID   string     `gorm:"column:target_id"`
	CreatedAt  *time.Time `gorm:"column:created_at"`
}

func (FeedLike) TableName() string { return "feed_likes" }

type FeedComment struct {
	ID              string     `gorm:"column:id"`
	UserID          string     `gorm:"column:user_id"`
	RecordID        *string    `gorm:"column:record_id"`
	TargetType      string     `gorm:"column:target_type"`
	TargetID        string     `gorm:"column:target_id"`
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
	TargetType       string     `gorm:"column:target_type"`
	TargetID         *string    `gorm:"column:target_id"`
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

type UserCirclePost struct {
	ID               string     `gorm:"column:id"`
	UserID           string     `gorm:"column:user_id"`
	Title            *string    `gorm:"column:title"`
	Body             *string    `gorm:"column:body"`
	Content          string     `gorm:"column:content"`
	ImagePaths       []string   `gorm:"column:image_paths;serializer:json"`
	TotalCalories    *float64   `gorm:"column:total_calories"`
	TotalProtein     *float64   `gorm:"column:total_protein"`
	TotalCarbs       *float64   `gorm:"column:total_carbs"`
	TotalFat         *float64   `gorm:"column:total_fat"`
	Fiber            *float64   `gorm:"column:fiber"`
	Sugar            *float64   `gorm:"column:sugar"`
	SodiumMg         *float64   `gorm:"column:sodium_mg"`
	TotalWeightGrams *float64   `gorm:"column:total_weight_grams"`
	HiddenFromFeed   bool       `gorm:"column:hidden_from_feed"`
	CreatedAt        *time.Time `gorm:"column:created_at"`
	UpdatedAt        *time.Time `gorm:"column:updated_at"`
}

func (UserCirclePost) TableName() string { return "user_circle_posts" }

type FeedReport struct {
	ID             string     `gorm:"column:id"`
	ReporterUserID string     `gorm:"column:reporter_user_id"`
	TargetType     string     `gorm:"column:target_type"`
	TargetID       string     `gorm:"column:target_id"`
	ReportedUserID string     `gorm:"column:reported_user_id"`
	Reason         string     `gorm:"column:reason"`
	ExtraContent   string     `gorm:"column:extra_content"`
	Status         string     `gorm:"column:status"`
	ResolutionNote string     `gorm:"column:resolution_note"`
	HandledBy      *string    `gorm:"column:handled_by"`
	HandledAt      *time.Time `gorm:"column:handled_at"`
	CreatedAt      *time.Time `gorm:"column:created_at"`
	UpdatedAt      *time.Time `gorm:"column:updated_at"`
}

func (FeedReport) TableName() string { return "feed_reports" }

type CirclePostNutrition struct {
	TotalCalories    *float64
	TotalProtein     *float64
	TotalCarbs       *float64
	TotalFat         *float64
	Fiber            *float64
	Sugar            *float64
	SodiumMg         *float64
	TotalWeightGrams *float64
}
