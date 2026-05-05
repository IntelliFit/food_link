package service

import (
	"context"

	"food_link/backend/internal/user/domain"
	"food_link/backend/internal/user/repo"
)

type AnalysisTaskService struct {
	tasks *repo.AnalysisTaskRepo
}

func NewAnalysisTaskService(tasks *repo.AnalysisTaskRepo) *AnalysisTaskService {
	return &AnalysisTaskService{tasks: tasks}
}

type CreateHealthReportTaskInput struct {
	ImageURL string `json:"imageUrl"`
}

func (s *AnalysisTaskService) CreateHealthReportTask(ctx context.Context, userID string, input CreateHealthReportTaskInput) (string, error) {
	task := &domain.AnalysisTask{
		UserID:   userID,
		TaskType: "health_report",
		Status:   "pending",
		ImageURL: &input.ImageURL,
		Payload:  map[string]any{},
	}
	if err := s.tasks.Create(ctx, task); err != nil {
		return "", err
	}
	return task.ID, nil
}
