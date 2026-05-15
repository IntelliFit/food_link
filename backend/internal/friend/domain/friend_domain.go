package domain

import "time"

// FriendRequest — table: friend_requests
type FriendRequest struct {
	ID         string     `gorm:"column:id"`
	FromUserID string     `gorm:"column:from_user_id"`
	ToUserID   string     `gorm:"column:to_user_id"`
	Status     string     `gorm:"column:status"` // pending, accepted, rejected
	CreatedAt  *time.Time `gorm:"column:created_at"`
	UpdatedAt  *time.Time `gorm:"column:updated_at"`
}

func (FriendRequest) TableName() string { return "friend_requests" }

// UserFriend — table: user_friends
type UserFriend struct {
	ID       string `gorm:"column:id"`
	UserID   string `gorm:"column:user_id"`
	FriendID string `gorm:"column:friend_id"`
}

func (UserFriend) TableName() string { return "user_friends" }

// FriendRequestExt extends FriendRequest with counterpart profile
type FriendRequestExt struct {
	FriendRequest
	CounterpartUserID   string `gorm:"-"`
	CounterpartNickname string `gorm:"-"`
	CounterpartAvatar   string `gorm:"-"`
}
