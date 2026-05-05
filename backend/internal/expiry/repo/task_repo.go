package repo

import (
	"context"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type TaskRepo struct {
	db *gorm.DB
}

func NewTaskRepo(db *gorm.DB) *TaskRepo {
	return &TaskRepo{db: db}
}

func (r *TaskRepo) CreateExpiryRecognizeTask(ctx context.Context, userID string, imageURLs []string) (*analyzedomain.AnalysisTask, error) {
	now := time.Now()
	var imageURL *string
	if len(imageURLs) > 0 {
		imageURL = &imageURLs[0]
	}
	task := &analyzedomain.AnalysisTask{
		ID:         uuid.New().String(),
		UserID:     userID,
		TaskType:   "expiry_recognize",
		Status:     "pending",
		ImageURL:   imageURL,
		ImagePaths: imageURLs,
		Payload: map[string]any{
			"expiry_recognition": true,
			"recognize_mode":     "food_expiry",
		},
		CreatedAt: &now,
		UpdatedAt: &now,
	}
	if err := r.db.WithContext(ctx).Create(task).Error; err != nil {
		return nil, err
	}
	return task, nil
}
