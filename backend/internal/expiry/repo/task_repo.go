package repo

import (
	"context"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type TaskRepo struct {
	db *gorm.DB
}

func NewTaskRepo(db *gorm.DB) *TaskRepo {
	return &TaskRepo{db: db}
}

func (r *TaskRepo) CreateExpiryRecognizeTask(ctx context.Context, userID string, imageURLs []string, additionalContexts ...string) (*analyzedomain.AnalysisTask, error) {
	additionalContext := ""
	if len(additionalContexts) > 0 {
		additionalContext = additionalContexts[0]
	}
	return r.CreateExpiryRecognizeTaskWithPayload(ctx, userID, imageURLs, additionalContext, nil)
}

func (r *TaskRepo) CreateExpiryRecognizeTaskWithPayload(ctx context.Context, userID string, imageURLs []string, additionalContext string, extraPayload map[string]any) (*analyzedomain.AnalysisTask, error) {
	now := time.Now()
	var imageURL *string
	if len(imageURLs) > 0 {
		imageURL = &imageURLs[0]
	}
	payload := map[string]any{
		"expiry_recognition": true,
		"recognize_mode":     "food_expiry",
		"additional_context": additionalContext,
	}
	for key, value := range extraPayload {
		payload[key] = value
	}
	task := &analyzedomain.AnalysisTask{
		ID:         uuid.New().String(),
		UserID:     userID,
		TaskType:   "expiry_recognize",
		Status:     "pending",
		ImageURL:   imageURL,
		ImagePaths: imageURLs,
		Payload:    payload,
		CreatedAt:  &now,
		UpdatedAt:  &now,
	}
	if err := r.db.WithContext(ctx).Create(task).Error; err != nil {
		return nil, err
	}
	return task, nil
}

func (r *TaskRepo) UpdateTaskStatus(ctx context.Context, taskID string, status string, errorMsg *string) error {
	updates := map[string]any{"status": status, "updated_at": time.Now()}
	if errorMsg != nil {
		updates["error_message"] = *errorMsg
	}
	return r.db.WithContext(ctx).Model(&analyzedomain.AnalysisTask{}).Where("id = ?", taskID).Updates(updates).Error
}

func (r *TaskRepo) CompleteTask(ctx context.Context, taskID string, result map[string]any) (bool, error) {
	updates := map[string]any{
		"status":        "done",
		"result":        datatypes.JSONMap(result),
		"error_message": nil,
		"lease_until":   nil,
		"updated_at":    time.Now(),
	}
	res := r.db.WithContext(ctx).Model(&analyzedomain.AnalysisTask{}).
		Where("id = ? AND status <> ?", taskID, "cancelled").
		Updates(updates)
	return res.RowsAffected > 0, res.Error
}

func (r *TaskRepo) FailTask(ctx context.Context, taskID string, errorMsg string) (bool, error) {
	updates := map[string]any{
		"status":        "failed",
		"error_message": errorMsg,
		"lease_until":   nil,
		"updated_at":    time.Now(),
	}
	res := r.db.WithContext(ctx).Model(&analyzedomain.AnalysisTask{}).
		Where("id = ? AND status <> ?", taskID, "cancelled").
		Updates(updates)
	return res.RowsAffected > 0, res.Error
}
