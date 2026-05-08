package repo

import (
	"context"
	"errors"
	"time"

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

func (r *PrecisionRepo) CreateItemEstimate(ctx context.Context, estimate *domain.PrecisionItemEstimate) error {
	if estimate.ID == "" {
		estimate.ID = uuid.New().String()
	}
	if estimate.Status == "" {
		estimate.Status = "pending"
	}
	return r.db.WithContext(ctx).Create(estimate).Error
}

func (r *PrecisionRepo) GetItemEstimateBySourceTask(ctx context.Context, sourceTaskID string) (*domain.PrecisionItemEstimate, error) {
	var estimate domain.PrecisionItemEstimate
	err := r.db.WithContext(ctx).Where("source_task_id = ?", sourceTaskID).First(&estimate).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &estimate, err
}

func (r *PrecisionRepo) ListItemEstimates(ctx context.Context, sessionID string, roundIndex int) ([]domain.PrecisionItemEstimate, error) {
	var rows []domain.PrecisionItemEstimate
	q := r.db.WithContext(ctx).Where("session_id = ?", sessionID)
	if roundIndex > 0 {
		q = q.Where("round_index = ?", roundIndex)
	}
	err := q.Order("round_index ASC, item_index ASC").Find(&rows).Error
	return rows, err
}

func (r *PrecisionRepo) UpdateItemEstimate(ctx context.Context, estimateID string, updates map[string]any) error {
	if updates == nil {
		updates = map[string]any{}
	}
	updates["updated_at"] = time.Now()
	return r.db.WithContext(ctx).Model(&domain.PrecisionItemEstimate{}).Where("id = ?", estimateID).Updates(updates).Error
}
