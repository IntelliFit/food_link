package repo

import (
	"context"
	"strings"

	analyzedomain "food_link/backend/internal/analyze/domain"

	"gorm.io/gorm"
)

type AnalysisTaskRepo struct {
	db *gorm.DB
}

func NewAnalysisTaskRepo(db *gorm.DB) *AnalysisTaskRepo {
	return &AnalysisTaskRepo{db: db}
}

func (r *AnalysisTaskRepo) GetImagePathsByID(ctx context.Context, taskID string) ([]string, error) {
	var task analyzedomain.AnalysisTask
	if err := r.db.WithContext(ctx).Select("id", "image_paths", "image_url").Where("id = ?", taskID).First(&task).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	if len(task.ImagePaths) > 0 {
		return task.ImagePaths, nil
	}
	if task.ImageURL != nil && *task.ImageURL != "" {
		return []string{*task.ImageURL}, nil
	}
	return nil, nil
}

func (r *AnalysisTaskRepo) GetImagePathsByIDs(ctx context.Context, taskIDs []string) (map[string][]string, error) {
	if len(taskIDs) == 0 {
		return nil, nil
	}
	var tasks []analyzedomain.AnalysisTask
	if err := r.db.WithContext(ctx).Select("id", "image_paths", "image_url").Where("id IN ?", taskIDs).Find(&tasks).Error; err != nil {
		return nil, err
	}
	out := make(map[string][]string, len(tasks))
	for _, task := range tasks {
		if len(task.ImagePaths) > 0 {
			out[task.ID] = task.ImagePaths
		} else if task.ImageURL != nil && *task.ImageURL != "" {
			out[task.ID] = []string{*task.ImageURL}
		}
	}
	return out, nil
}

// GetUserTaskImagePaths keeps legacy food-record links inside their owner's
// task namespace. A record's foreign key alone is not an ownership check.
func (r *AnalysisTaskRepo) GetUserTaskImagePaths(ctx context.Context, userID string, taskIDs []string) (map[string][]string, error) {
	if strings.TrimSpace(userID) == "" || len(taskIDs) == 0 {
		return nil, nil
	}
	var tasks []analyzedomain.AnalysisTask
	if err := r.db.WithContext(ctx).Select("id", "image_paths", "image_url").
		Where("user_id = ? AND id IN ?", userID, taskIDs).Find(&tasks).Error; err != nil {
		return nil, err
	}
	out := make(map[string][]string, len(tasks))
	for _, task := range tasks {
		if len(task.ImagePaths) > 0 {
			out[task.ID] = task.ImagePaths
		} else if task.ImageURL != nil && *task.ImageURL != "" {
			out[task.ID] = []string{*task.ImageURL}
		}
	}
	return out, nil
}

func (r *AnalysisTaskRepo) GetByID(ctx context.Context, taskID string) (*analyzedomain.AnalysisTask, error) {
	var task analyzedomain.AnalysisTask
	if err := r.db.WithContext(ctx).Where("id = ?", taskID).First(&task).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &task, nil
}
