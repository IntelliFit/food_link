package domain

import "time"

// UserFollow — table: user_follows
type UserFollow struct {
	ID         string     `gorm:"column:id"`
	FollowerID string     `gorm:"column:follower_id"`
	FolloweeID string     `gorm:"column:followee_id"`
	CreatedAt  *time.Time `gorm:"column:created_at"`
}

func (UserFollow) TableName() string { return "user_follows" }
