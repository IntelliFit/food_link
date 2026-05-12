package repo

import (
	"context"

	"food_link/backend/internal/user/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type AnalysisTaskRepo struct {
	db *gorm.DB
}

func NewAnalysisTaskRepo(db *gorm.DB) *AnalysisTaskRepo {
	return &AnalysisTaskRepo{db: db}
}

func (r *AnalysisTaskRepo) Create(ctx context.Context, task *domain.AnalysisTask) error {
	if task.ID == "" {
		task.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(task).Error
}
