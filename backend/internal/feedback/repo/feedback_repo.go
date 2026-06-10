package repo

import (
	"context"

	"food_link/backend/internal/feedback/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type FeedbackRepo struct {
	db *gorm.DB
}

func NewFeedbackRepo(db *gorm.DB) *FeedbackRepo {
	return &FeedbackRepo{db: db}
}

func (r *FeedbackRepo) Create(ctx context.Context, feedback *domain.UserFeedback) error {
	if feedback.ID == "" {
		feedback.ID = uuid.NewString()
	}
	return r.db.WithContext(ctx).Create(feedback).Error
}
