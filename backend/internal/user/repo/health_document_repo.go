package repo

import (
	"context"

	"food_link/backend/internal/user/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type HealthDocumentRepo struct {
	db *gorm.DB
}

func NewHealthDocumentRepo(db *gorm.DB) *HealthDocumentRepo {
	return &HealthDocumentRepo{db: db}
}

func (r *HealthDocumentRepo) Create(ctx context.Context, doc *domain.UserHealthDocument) error {
	if doc.ID == "" {
		doc.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(doc).Error
}
