package service

import (
	"context"
	"strings"

	"food_link/backend/internal/user/domain"
	"food_link/backend/internal/user/repo"
	"food_link/backend/pkg/storage"
)

type AnalysisTaskService struct {
	tasks   *repo.AnalysisTaskRepo
	storage *storage.Client
}

func NewAnalysisTaskService(tasks *repo.AnalysisTaskRepo, storageClient ...*storage.Client) *AnalysisTaskService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &AnalysisTaskService{tasks: tasks, storage: client}
}

type CreateHealthReportTaskInput struct {
	ImageURL string `json:"imageUrl"`
}

func (s *AnalysisTaskService) CreateHealthReportTask(ctx context.Context, userID string, input CreateHealthReportTaskInput) (string, error) {
	input.ImageURL = s.resolveHealthReportURL(input.ImageURL)
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

func (s *AnalysisTaskService) resolveHealthReportURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("health-reports", value)
	if resolved == "" {
		return value
	}
	return resolved
}
