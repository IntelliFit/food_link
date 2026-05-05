package repo

import (
	"context"
	"errors"

	"food_link/backend/internal/analyze/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type PrecisionRepo struct {
	db *gorm.DB
}

func NewPrecisionRepo(db *gorm.DB) *PrecisionRepo {
	return &PrecisionRepo{db: db}
}

func (r *PrecisionRepo) CreateSession(ctx context.Context, session *domain.PrecisionSession) error {
	if session.ID == "" {
		session.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(session).Error
}

func (r *PrecisionRepo) GetSessionByID(ctx context.Context, sessionID string) (*domain.PrecisionSession, error) {
	var session domain.PrecisionSession
	err := r.db.WithContext(ctx).Where("id = ?", sessionID).First(&session).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &session, err
}

func (r *PrecisionRepo) UpdateSession(ctx context.Context, sessionID string, updates map[string]any) error {
	return r.db.WithContext(ctx).Model(&domain.PrecisionSession{}).Where("id = ?", sessionID).Updates(updates).Error
}

func (r *PrecisionRepo) CreateRound(ctx context.Context, round *domain.PrecisionSessionRound) error {
	if round.ID == "" {
		round.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(round).Error
}
