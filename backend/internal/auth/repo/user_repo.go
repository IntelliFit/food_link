package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID                     string         `gorm:"column:id"`
	OpenID                 string         `gorm:"column:openid"`
	UnionID                *string        `gorm:"column:unionid"`
	Nickname               string         `gorm:"column:nickname"`
	Avatar                 string         `gorm:"column:avatar"`
	Telephone              *string        `gorm:"column:telephone"`
	DietGoal               *string        `gorm:"column:diet_goal"`
	HealthCondition        map[string]any `gorm:"column:health_condition;serializer:json"`
	CreatedAt              *time.Time     `gorm:"column:create_time"`
	OnboardingCompleted    *bool          `gorm:"column:onboarding_completed"`
	Height                 *float64       `gorm:"column:height"`
	Weight                 *float64       `gorm:"column:weight"`
	Birthday               *string        `gorm:"column:birthday"`
	Gender                 *string        `gorm:"column:gender"`
	ActivityLevel          *string        `gorm:"column:activity_level"`
	BMR                    *float64       `gorm:"column:bmr"`
	TDEE                   *float64       `gorm:"column:tdee"`
	ExecutionMode          *string        `gorm:"column:execution_mode"`
	ModeSetBy              *string        `gorm:"column:mode_set_by"`
	ModeSetAt              *time.Time     `gorm:"column:mode_set_at"`
	ModeReason             *string        `gorm:"column:mode_reason"`
	ModeCommitmentDays     *int           `gorm:"column:mode_commitment_days"`
	ModeSwitchCount30d     *int           `gorm:"column:mode_switch_count_30d"`
	Searchable             *bool          `gorm:"column:searchable"`
	PublicRecords          *bool          `gorm:"column:public_records"`
	LastSeenAnalyzeHistory *time.Time     `gorm:"column:last_seen_analyze_history"`
}

func (User) TableName() string { return "weapp_user" }

type UserRepo struct {
	db *gorm.DB
}

func NewUserRepo(db *gorm.DB) *UserRepo {
	return &UserRepo{db: db}
}

func (r *UserRepo) FindByOpenID(ctx context.Context, openID string) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("openid = ?", openID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *UserRepo) FindByID(ctx context.Context, userID string) (*User, error) {
	var user User
	err := r.db.WithContext(ctx).Where("id = ?", userID).First(&user).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &user, err
}

func (r *UserRepo) Create(ctx context.Context, user *User) error {
	if user.ID == "" {
		user.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *UserRepo) UpdateFields(ctx context.Context, userID string, updates map[string]any) (*User, error) {
	if err := r.db.WithContext(ctx).Table("weapp_user").Where("id = ?", userID).Updates(updates).Error; err != nil {
		return nil, err
	}
	return r.FindByID(ctx, userID)
}

func (r *UserRepo) ExchangeCode(ctx context.Context, appID, secret, code string) (string, string, error) {
	if code == "" {
		return "", "", fmt.Errorf("code 不能为空")
	}
	type wxResp struct {
		OpenID  string `json:"openid"`
		UnionID string `json:"unionid"`
		ErrCode int    `json:"errcode"`
		ErrMsg  string `json:"errmsg"`
	}
	var resp wxResp
	if err := simpleJSONGet(ctx, "https://api.weixin.qq.com/sns/jscode2session", map[string]string{
		"appid":      appID,
		"secret":     secret,
		"js_code":    code,
		"grant_type": "authorization_code",
	}, &resp); err != nil {
		return "", "", err
	}
	if resp.ErrCode != 0 {
		return "", "", fmt.Errorf("微信登录失败: %s (%d)", resp.ErrMsg, resp.ErrCode)
	}
	return resp.OpenID, resp.UnionID, nil
}

func (r *UserRepo) UpdateLastSeenAnalyzeHistory(ctx context.Context, userID string) error {
	return r.db.WithContext(ctx).Table("weapp_user").Where("id = ?", userID).Update("last_seen_analyze_history", time.Now()).Error
}

func (r *UserRepo) CountFoodRecordDays(ctx context.Context, userID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Raw(`
		SELECT COUNT(DISTINCT DATE(record_time))
		FROM user_food_records
		WHERE user_id = ?
	`, userID).Scan(&count).Error
	return count, err
}
