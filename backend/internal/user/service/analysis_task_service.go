package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"food_link/backend/internal/taskqueue"
	"food_link/backend/internal/user/domain"
	"food_link/backend/internal/user/repo"
	"food_link/backend/pkg/storage"
)

type AnalysisTaskService struct {
	tasks     *repo.AnalysisTaskRepo
	storage   *storage.Client
	taskQueue taskqueue.Publisher
}

func NewAnalysisTaskService(tasks *repo.AnalysisTaskRepo, storageClient ...*storage.Client) *AnalysisTaskService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &AnalysisTaskService{tasks: tasks, storage: client}
}

func (s *AnalysisTaskService) ConfigureTaskPublisher(queue taskqueue.Publisher) {
	s.taskQueue = queue
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
	if err := s.enqueueTask(ctx, task.ID, task.TaskType); err != nil {
		return "", err
	}
	return task.ID, nil
}

func (s *AnalysisTaskService) enqueueTask(ctx context.Context, taskID, taskType string) error {
	if s.taskQueue == nil || strings.TrimSpace(taskID) == "" || strings.TrimSpace(taskType) == "" {
		return nil
	}
	publishCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := s.taskQueue.PublishTask(publishCtx, taskqueue.TaskMessage{TaskID: taskID, TaskType: taskType}); err != nil {
		return fmt.Errorf("enqueue health report task: %w", err)
	}
	return nil
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
