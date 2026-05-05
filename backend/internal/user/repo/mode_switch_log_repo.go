package repo

import (
	"context"

	"food_link/backend/internal/user/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ModeSwitchLogRepo struct {
	db *gorm.DB
}

func NewModeSwitchLogRepo(db *gorm.DB) *ModeSwitchLogRepo {
	return &ModeSwitchLogRepo{db: db}
}

func (r *ModeSwitchLogRepo) Create(ctx context.Context, log *domain.UserModeSwitchLog) error {
	if log.ID == "" {
		log.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(log).Error
}
