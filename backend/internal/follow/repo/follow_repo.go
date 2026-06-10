package repo

import (
	"context"
	"errors"

	"food_link/backend/internal/follow/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// User — minimal weapp_user struct for follow queries
type User struct {
	ID       string `gorm:"column:id"`
	Nickname string `gorm:"column:nickname"`
	Avatar   string `gorm:"column:avatar"`
}

func (User) TableName() string { return "weapp_user" }

type FollowRepo struct {
	db *gorm.DB
}

func NewFollowRepo(db *gorm.DB) *FollowRepo {
	return &FollowRepo{db: db}
}

// Follow creates a follow relationship (idempotent)
func (r *FollowRepo) Follow(ctx context.Context, followerID, followeeID string) error {
	var existing domain.UserFollow
	err := r.db.WithContext(ctx).Where("follower_id = ? AND followee_id = ?", followerID, followeeID).First(&existing).Error
	if err == nil {
		return nil // already following
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	uf := domain.UserFollow{
		ID:         uuid.New().String(),
		FollowerID: followerID,
		FolloweeID: followeeID,
	}
	return r.db.WithContext(ctx).Create(&uf).Error
}

// Unfollow removes a follow relationship (idempotent)
func (r *FollowRepo) Unfollow(ctx context.Context, followerID, followeeID string) error {
	return r.db.WithContext(ctx).Where("follower_id = ? AND followee_id = ?", followerID, followeeID).Delete(&domain.UserFollow{}).Error
}

// IsFollowing checks if followerID is following followeeID
func (r *FollowRepo) IsFollowing(ctx context.Context, followerID, followeeID string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.UserFollow{}).
		Where("follower_id = ? AND followee_id = ?", followerID, followeeID).
		Count(&count).Error
	return count > 0, err
}

// CountFollowers returns the number of followers for a user
func (r *FollowRepo) CountFollowers(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.UserFollow{}).
		Where("followee_id = ?", userID).
		Count(&count).Error
	return count, err
}

// CountFollowing returns the number of users that a user is following
func (r *FollowRepo) CountFollowing(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.UserFollow{}).
		Where("follower_id = ?", userID).
		Count(&count).Error
	return count, err
}

// GetFollowers returns the list of followers for a user with pagination
func (r *FollowRepo) GetFollowers(ctx context.Context, userID string, offset, limit int) ([]User, error) {
	if limit <= 0 {
		limit = 20
	}
	var followers []User
	err := r.db.WithContext(ctx).Model(&User{}).
		Select("weapp_user.id, weapp_user.nickname, weapp_user.avatar").
		Joins("INNER JOIN user_follows ON user_follows.follower_id = weapp_user.id").
		Where("user_follows.followee_id = ?", userID).
		Order("user_follows.created_at DESC").
		Limit(limit).Offset(offset).
		Find(&followers).Error
	return followers, err
}

// GetFollowing returns the list of users that a user is following with pagination
func (r *FollowRepo) GetFollowing(ctx context.Context, userID string, offset, limit int) ([]User, error) {
	if limit <= 0 {
		limit = 20
	}
	var following []User
	err := r.db.WithContext(ctx).Model(&User{}).
		Select("weapp_user.id, weapp_user.nickname, weapp_user.avatar").
		Joins("INNER JOIN user_follows ON user_follows.followee_id = weapp_user.id").
		Where("user_follows.follower_id = ?", userID).
		Order("user_follows.created_at DESC").
		Limit(limit).Offset(offset).
		Find(&following).Error
	return following, err
}
