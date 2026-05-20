package repo

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"food_link/backend/internal/analyze/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
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
	now := time.Now()
	if session.ExecutionMode == "" {
		session.ExecutionMode = "experimental"
	}
	if session.Status == "" {
		session.Status = "collecting"
	}
	if session.RoundIndex <= 0 {
		session.RoundIndex = 1
	}
	if session.LatestInputs == nil {
		session.LatestInputs = map[string]any{}
	}
	if session.PendingRequirements == nil {
		session.PendingRequirements = []any{}
	}
	if session.ReferenceObjects == nil {
		session.ReferenceObjects = []any{}
	}
	if session.CreatedAt == nil {
		session.CreatedAt = &now
	}
	if session.UpdatedAt == nil {
		session.UpdatedAt = &now
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
	updates = normalizePrecisionJSONUpdates(updates, map[string]any{
		"latest_inputs":         map[string]any{},
		"pending_requirements":  []any{},
		"reference_objects":     []any{},
		"split_plan":            nil,
		"latest_planner_result": nil,
		"final_result":          nil,
	})
	return r.db.WithContext(ctx).Model(&domain.PrecisionSession{}).Where("id = ?", sessionID).Updates(updates).Error
}

func (r *PrecisionRepo) CreateRound(ctx context.Context, round *domain.PrecisionSessionRound) error {
	if round.ID == "" {
		round.ID = uuid.New().String()
	}
	if round.InputPayload == nil {
		round.InputPayload = map[string]any{}
	}
	if round.CreatedAt == nil {
		now := time.Now()
		round.CreatedAt = &now
	}
	return r.db.WithContext(ctx).Create(round).Error
}

func (r *PrecisionRepo) ListRounds(ctx context.Context, sessionID string) ([]domain.PrecisionSessionRound, error) {
	var rows []domain.PrecisionSessionRound
	err := r.db.WithContext(ctx).
		Where("session_id = ?", sessionID).
		Order("round_index ASC, created_at ASC").
		Find(&rows).Error
	return rows, err
}

func (r *PrecisionRepo) CreateItemEstimate(ctx context.Context, estimate *domain.PrecisionItemEstimate) error {
	if estimate.ID == "" {
		estimate.ID = uuid.New().String()
	}
	if estimate.Status == "" {
		estimate.Status = "pending"
	}
	if estimate.Payload == nil {
		estimate.Payload = map[string]any{}
	}
	now := time.Now()
	if estimate.CreatedAt == nil {
		estimate.CreatedAt = &now
	}
	if estimate.UpdatedAt == nil {
		estimate.UpdatedAt = &now
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
	updates = normalizePrecisionJSONUpdates(updates, map[string]any{
		"payload": map[string]any{},
		"result":  nil,
	})
	return r.db.WithContext(ctx).Model(&domain.PrecisionItemEstimate{}).Where("id = ?", estimateID).Updates(updates).Error
}

func normalizePrecisionJSONUpdates(updates map[string]any, defaults map[string]any) map[string]any {
	if updates == nil {
		updates = map[string]any{}
	}
	out := make(map[string]any, len(updates))
	for key, value := range updates {
		defaultValue, isJSONField := defaults[key]
		if !isJSONField {
			out[key] = value
			continue
		}
		if value == nil {
			value = defaultValue
		}
		if value == nil {
			out[key] = nil
			continue
		}
		if encoded, err := json.Marshal(value); err == nil {
			out[key] = datatypes.JSON(encoded)
			continue
		}
		out[key] = value
	}
	return out
}
