package domain

import "time"

// ExpiryItem — table: user_food_expiry_items
type ExpiryItem struct {
	ID         string     `gorm:"column:id" json:"id"`
	UserID     string     `gorm:"column:user_id" json:"user_id"`
	Name       string     `gorm:"column:name" json:"name"`
	Category   string     `gorm:"column:category" json:"category"`
	ExpiryDate *time.Time `gorm:"column:expiry_date" json:"expiry_date"`
	Quantity   *int       `gorm:"column:quantity" json:"quantity"`
	Location   *string    `gorm:"column:location" json:"location"`
	Notes      *string    `gorm:"column:notes" json:"notes"`
	ImageURL   *string    `gorm:"column:image_url" json:"image_url"`
	Status     string     `gorm:"column:status" json:"status"` // active, consumed, expired
	CreatedAt  *time.Time `gorm:"column:created_at" json:"created_at"`
}

func (ExpiryItem) TableName() string { return "user_food_expiry_items" }
