package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"food_link/backend/internal/taskqueue"
	"food_link/backend/internal/user/domain"
	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/user/repo"
	"food_link/backend/pkg/storage"
)

type AnalysisTaskService struct {
	tasks     *repo.AnalysisTaskRepo
	users     *authrepo.UserRepo
	storage   *storage.Client
	taskQueue taskqueue.Publisher
}

func NewAnalysisTaskService(tasks *repo.AnalysisTaskRepo, users *authrepo.UserRepo, storageClient ...*storage.Client) *AnalysisTaskService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &AnalysisTaskService{tasks: tasks, users: users, storage: client}
}

func (s *AnalysisTaskService) ConfigureTaskPublisher(queue taskqueue.Publisher) {
	s.taskQueue = queue
}

type CreateHealthReportTaskInput struct {
	ImageURL  string   `json:"imageUrl"`
	ImageURLs []string `json:"imageUrls"`
}

func (s *AnalysisTaskService) CreateHealthReportTask(ctx context.Context, userID string, input CreateHealthReportTaskInput) (string, error) {
	imageURLs := s.normalizeHealthReportURLs(input.ImageURL, input.ImageURLs)
	if len(imageURLs) == 0 {
		return "", fmt.Errorf("imageUrl 不能为空")
	}
	primaryURL := imageURLs[0]
	task := &domain.AnalysisTask{
		UserID:     userID,
		TaskType:   "health_report",
		Status:     "pending",
		ImageURL:   &primaryURL,
		ImagePaths: imageURLs,
		Payload: map[string]any{
			"image_url":  primaryURL,
			"image_urls": imageURLs,
		},
	}
	if err := s.tasks.Create(ctx, task); err != nil {
		return "", err
	}
	if err := s.markHealthReportProcessing(ctx, userID, imageURLs); err != nil {
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

func (s *AnalysisTaskService) normalizeHealthReportURLs(primary string, values []string) []string {
	normalized := make([]string, 0, len(values)+1)
	seen := make(map[string]struct{}, len(values)+1)
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		for _, part := range strings.Split(value, ",") {
			resolved := s.resolveHealthReportURL(part)
			resolved = strings.TrimSpace(resolved)
			if resolved == "" {
				continue
			}
			if _, ok := seen[resolved]; ok {
				continue
			}
			seen[resolved] = struct{}{}
			normalized = append(normalized, resolved)
		}
	}
	add(primary)
	for _, value := range values {
		add(value)
	}
	return normalized
}

func (s *AnalysisTaskService) markHealthReportProcessing(ctx context.Context, userID string, imageURLs []string) error {
	if s.users == nil || strings.TrimSpace(userID) == "" || len(imageURLs) == 0 {
		return nil
	}
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if user == nil {
		return nil
	}
	healthCondition := map[string]any{}
	for key, value := range user.HealthCondition {
		healthCondition[key] = value
	}
	healthCondition["report_extract"] = map[string]any{
		"indicators":    []any{},
		"conclusions":   []string{},
		"suggestions":   []string{},
		"medical_notes": "",
		"_image_urls":   imageURLs,
		"_status":       "processing",
		"_error":        "",
	}
	_, err = s.users.UpdateFields(ctx, userID, map[string]any{"health_condition": healthCondition})
	return err
}
