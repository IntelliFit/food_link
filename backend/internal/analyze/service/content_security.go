package service

import (
	"context"
	"log/slog"
	"time"

	"food_link/backend/internal/analyze/domain"
	contentsecurity "food_link/backend/internal/contentsecurity/service"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/logger"
)

func (s *TaskService) ConfigureContentSecurity(checker *contentsecurity.Service) {
	s.contentSecurity = checker
}

// AnalysisSecurityDocument includes original inputs, including all capture views.
func AnalysisSecurityDocument(task *domain.AnalysisTask) map[string]any {
	images := append([]string(nil), task.ImagePaths...)
	if task.ImageURL != nil {
		images = append(images, *task.ImageURL)
	}
	doc := map[string]any{"image_urls": images}
	if task.TextInput != nil {
		doc["text_input"] = *task.TextInput
	}
	for _, key := range []string{"additionalContext", "diet_goal", "activity_timing", "capture_views", "correctionItems", "answers"} {
		if value, ok := task.Payload[key]; ok {
			doc[key] = value
		}
	}
	return doc
}

func (s *TaskService) startContentSecurity(ctx context.Context, userID string, input SubmitTaskInput, payload map[string]any) error {
	if s.contentSecurity == nil || boolFromAny(payload["internal_benchmark"]) || boolFromAny(payload["open_api"]) {
		return nil
	}
	text := input.TextInput
	task := &domain.AnalysisTask{UserID: userID, ImageURL: &input.ImageURL, ImagePaths: input.ImageURLs, TextInput: &text, Payload: payload}
	doc := AnalysisSecurityDocument(task)
	if err := s.contentSecurity.StartDocument(ctx, userID, 4, doc, s.storage); err != nil {
		return err
	}
	payload["content_security_required"] = true
	// Text tasks may also reference photos during a single-item correction.
	payload["content_security_input"] = doc
	logger.Info(ctx, "识别输入审核已提前启动", slog.String("user_id", userID))
	return nil
}

// ResumeContentSecurity only requeues persisted computed results, never runs AI
// from a callback. Existing attempt claims make duplicate callbacks harmless.
func (s *TaskService) ResumeContentSecurity(ctx context.Context, taskID string) error {
	task, err := s.tasks.GetTaskByID(ctx, taskID)
	if err != nil || task == nil {
		return err
	}
	if task.Status != "pending" || !boolFromAny(task.Result[contentsecurity.WaitingKey]) || s.taskQueue == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	err = s.taskQueue.PublishTask(ctx, taskqueue.TaskMessage{TaskID: task.ID, TaskType: task.TaskType})
	if err == nil {
		logger.Info(ctx, "审核回调已唤醒识别结果", slog.String("task_id", task.ID))
	}
	return err
}
