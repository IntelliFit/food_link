package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/membership/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type MembershipRepo struct {
	db *gorm.DB
}

func NewMembershipRepo(db *gorm.DB) *MembershipRepo {
	return &MembershipRepo{db: db}
}

func (r *MembershipRepo) ListActivePlans(ctx context.Context) ([]domain.MembershipPlan, error) {
	var plans []domain.MembershipPlan
	err := r.db.WithContext(ctx).Where("is_active = ?", true).Find(&plans).Error
	return plans, err
}

func (r *MembershipRepo) GetPlanByID(ctx context.Context, planID string) (*domain.MembershipPlan, error) {
	var plan domain.MembershipPlan
	err := r.db.WithContext(ctx).Where("id = ?", planID).First(&plan).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &plan, err
}

func (r *MembershipRepo) GetActiveMembership(ctx context.Context, userID string) (*domain.UserMembership, error) {
	var um domain.UserMembership
	err := r.db.WithContext(ctx).
		Where("user_id = ? AND status = ? AND (expires_at IS NULL OR expires_at > ?)", userID, "active", time.Now()).
		Order("created_at DESC").
		First(&um).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &um, err
}

func (r *MembershipRepo) CreateMembership(ctx context.Context, um *domain.UserMembership) error {
	if um.ID == "" {
		um.ID = uuid.New().String()
	}
	now := time.Now()
	if um.CreatedAt == nil {
		um.CreatedAt = &now
	}
	return r.db.WithContext(ctx).Create(um).Error
}

func (r *MembershipRepo) UpdateMembership(ctx context.Context, id string, updates map[string]any) error {
	return r.db.WithContext(ctx).Model(&domain.UserMembership{}).Where("id = ?", id).Updates(updates).Error
}

func (r *MembershipRepo) CreatePayment(ctx context.Context, p *domain.MembershipPayment) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	now := time.Now()
	if p.CreatedAt == nil {
		p.CreatedAt = &now
	}
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *MembershipRepo) GetPaymentByID(ctx context.Context, id string) (*domain.MembershipPayment, error) {
	var p domain.MembershipPayment
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &p, err
}

func (r *MembershipRepo) UpdatePaymentStatus(ctx context.Context, id string, status string) error {
	return r.db.WithContext(ctx).Model(&domain.MembershipPayment{}).Where("id = ?", id).Update("status", status).Error
}

func (r *MembershipRepo) CountAnalysisTasksToday(ctx context.Context, userID string) (int64, error) {
	now := time.Now()
	startOfDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	endOfDay := startOfDay.Add(24 * time.Hour)

	var count int64
	err := r.db.WithContext(ctx).Model(&analysisTask{}).
		Where("user_id = ? AND created_at >= ? AND created_at < ?", userID, startOfDay, endOfDay).
		Count(&count).Error
	return count, err
}

func (r *MembershipRepo) HasShareReward(ctx context.Context, userID, recordID string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&domain.MembershipShareReward{}).
		Where("user_id = ? AND record_id = ?", userID, recordID).
		Count(&count).Error
	return count > 0, err
}

func (r *MembershipRepo) CreateShareReward(ctx context.Context, reward *domain.MembershipShareReward) error {
	if reward.ID == "" {
		reward.ID = uuid.New().String()
	}
	now := time.Now()
	if reward.CreatedAt == nil {
		reward.CreatedAt = &now
	}
	return r.db.WithContext(ctx).Create(reward).Error
}

type analysisTask struct {
	ID        string     `gorm:"column:id"`
	UserID    string     `gorm:"column:user_id"`
	CreatedAt *time.Time `gorm:"column:created_at"`
}

func (analysisTask) TableName() string { return "analysis_tasks" }
