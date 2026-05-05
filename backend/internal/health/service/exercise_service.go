package service

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
)

type ExerciseRepo interface {
	CreateExerciseLog(ctx context.Context, log *domain.ExerciseLog) error
	ListExerciseLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.ExerciseLog, error)
	GetExerciseLogByID(ctx context.Context, userID, logID string) (*domain.ExerciseLog, error)
	DeleteExerciseLog(ctx context.Context, userID, logID string) (int64, error)
	GetDailyCaloriesBurned(ctx context.Context, userID string, recordedOn string) (int64, error)
	CreateAnalysisTask(ctx context.Context, task *domain.AnalysisTask) error
}

type ExerciseService struct {
	repo ExerciseRepo
}

func NewExerciseService(repo ExerciseRepo) *ExerciseService {
	return &ExerciseService{repo: repo}
}

func (s *ExerciseService) GetDailyCalories(ctx context.Context, userID string, date string) (map[string]any, error) {
	if date == "" {
		date = time.Now().In(chinaTZ).Format("2006-01-02")
	}
	total, err := s.repo.GetDailyCaloriesBurned(ctx, userID, date)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"date":                  date,
		"total_calories_burned": int(total),
	}, nil
}

func (s *ExerciseService) ListLogs(ctx context.Context, userID string, date string) (map[string]any, error) {
	var startDate, endDate string
	if date != "" {
		startDate = date
		endDate = date
	} else {
		startDate = time.Now().In(chinaTZ).Format("2006-01-02")
		endDate = startDate
	}

	logs, err := s.repo.ListExerciseLogsByDate(ctx, userID, startDate, endDate)
	if err != nil {
		return nil, err
	}

	totalCalories := 0
	logItems := make([]map[string]any, 0, len(logs))
	for _, log := range logs {
		calories := 0.0
		if log.CaloriesBurned != nil {
			calories = *log.CaloriesBurned
		}
		totalCalories += int(calories)
		item := map[string]any{
			"id":              log.ID,
			"exercise_desc":   log.ExerciseDesc,
			"calories_burned": calories,
			"recorded_on":     nil,
			"created_at":      nil,
		}
		if log.RecordedOn != nil {
			item["recorded_on"] = log.RecordedOn.Format("2006-01-02")
		}
		if log.CreatedAt != nil {
			item["created_at"] = log.CreatedAt.Format(time.RFC3339)
		}
		logItems = append(logItems, item)
	}

	return map[string]any{
		"logs":           logItems,
		"total_calories": totalCalories,
		"count":          len(logs),
	}, nil
}

func (s *ExerciseService) CreateLog(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error) {
	desc := strings.TrimSpace(exerciseDesc)
	if desc == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述不能为空", HTTPStatus: 400}
	}
	if len(desc) > 200 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述过长", HTTPStatus: 400}
	}

	recordedOn := time.Now().In(chinaTZ).Format("2006-01-02")
	now := time.Now().UTC()

	// Stub LLM estimate based on description length
	estimatedCalories := s.stubEstimateCalories(desc)

	log := &domain.ExerciseLog{
		UserID:         userID,
		ExerciseDesc:   desc,
		CaloriesBurned: &estimatedCalories,
		RecordedOn:     func() *time.Time { t, _ := parseChinaDate(recordedOn); return &t }(),
		CreatedAt:      &now,
	}
	if err := s.repo.CreateExerciseLog(ctx, log); err != nil {
		return nil, err
	}

	// Create async analysis task
	task := &domain.AnalysisTask{
		UserID:    userID,
		TaskType:  "exercise",
		Status:    "pending",
		TextInput: &desc,
		Payload: map[string]any{
			"recorded_on": recordedOn,
		},
		CreatedAt: &now,
	}
	if err := s.repo.CreateAnalysisTask(ctx, task); err != nil {
		return nil, err
	}

	return map[string]any{
		"task_id": task.ID,
		"message": "运动分析任务已提交，请轮询任务状态直至完成",
	}, nil
}

func (s *ExerciseService) EstimateCalories(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error) {
	desc := strings.TrimSpace(exerciseDesc)
	if desc == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述不能为空", HTTPStatus: 400}
	}

	calories := s.stubEstimateCalories(desc)
	return map[string]any{
		"estimated_calories": calories,
		"exercise_desc":      desc,
		"ai_response":        fmt.Sprintf("基于描述估算消耗约 %.0f 千卡", calories),
		"reasoning":          "基于运动描述长度和关键词的简单估算公式",
		"profile_snapshot":   nil,
	}, nil
}

func (s *ExerciseService) DeleteLog(ctx context.Context, userID, logID string) error {
	rowsAffected, err := s.repo.DeleteExerciseLog(ctx, userID, logID)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return commonerrors.ErrNotFound
	}
	return nil
}

func (s *ExerciseService) stubEstimateCalories(desc string) float64 {
	// Simple stub: base 50 + 10 per 10 chars, capped at 800
	length := len([]rune(desc))
	calories := 50.0 + float64(length)*1.5
	// Boost for intensity keywords
	intenseKeywords := []string{"跑步", "游泳", "跳绳", "HIIT", "高强度", " sprint", "run", "swim", "cycle"}
	lowerDesc := strings.ToLower(desc)
	for _, kw := range intenseKeywords {
		if strings.Contains(lowerDesc, strings.ToLower(kw)) {
			calories += 100
			break
		}
	}
	return math.Min(calories, 800)
}
