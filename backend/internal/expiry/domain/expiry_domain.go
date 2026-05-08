package domain

import "time"

// ExpiryItem — table: food_expiry_items
type ExpiryItem struct {
	ID           string     `gorm:"column:id" json:"id"`
	UserID       string     `gorm:"column:user_id" json:"user_id"`
	FoodName     string     `gorm:"column:food_name" json:"food_name"`
	Category     string     `gorm:"column:category" json:"category"`
	StorageType  string     `gorm:"column:storage_type" json:"storage_type"`
	QuantityNote *string    `gorm:"column:quantity_note" json:"quantity_note"`
	ExpireDate   time.Time  `gorm:"column:expire_date" json:"expire_date"`
	OpenedDate   *time.Time `gorm:"column:opened_date" json:"opened_date"`
	Note         *string    `gorm:"column:note" json:"note"`
	SourceType   string     `gorm:"column:source_type" json:"source_type"`
	Status       string     `gorm:"column:status" json:"status"` // active, consumed, discarded
	CreatedAt    time.Time  `gorm:"column:created_at" json:"created_at"`
	UpdatedAt    time.Time  `gorm:"column:updated_at" json:"updated_at"`
}

func (ExpiryItem) TableName() string { return "food_expiry_items" }

// ExpiryNotificationJob — table: food_expiry_notification_jobs
type ExpiryNotificationJob struct {
	ID              string         `gorm:"column:id" json:"id"`
	UserID          string         `gorm:"column:user_id" json:"user_id"`
	ExpiryItemID    string         `gorm:"column:expiry_item_id" json:"expiry_item_id"`
	TemplateID      string         `gorm:"column:template_id" json:"template_id"`
	OpenID          string         `gorm:"column:openid" json:"openid"`
	Status          string         `gorm:"column:status" json:"status"`
	ScheduledAt     time.Time      `gorm:"column:scheduled_at" json:"scheduled_at"`
	SentAt          *time.Time     `gorm:"column:sent_at" json:"sent_at"`
	LastError       *string        `gorm:"column:last_error" json:"last_error"`
	RetryCount      int            `gorm:"column:retry_count" json:"retry_count"`
	MaxRetryCount   int            `gorm:"column:max_retry_count" json:"max_retry_count"`
	PayloadSnapshot map[string]any `gorm:"column:payload_snapshot;serializer:json" json:"payload_snapshot"`
	CreatedAt       time.Time      `gorm:"column:created_at" json:"created_at"`
	UpdatedAt       time.Time      `gorm:"column:updated_at" json:"updated_at"`
}

func (ExpiryNotificationJob) TableName() string { return "food_expiry_notification_jobs" }
