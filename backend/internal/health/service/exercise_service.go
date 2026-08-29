package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"food_link/backend/internal/common/dateutil"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	membershipdomain "food_link/backend/internal/membership/domain"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/metrics"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
	"log/slog"
)

const creditCostExerciseLog = 1
const (
	exerciseLongTextThresholdRunes = 80
	exerciseMaxDescriptionRunes    = 2000
	defaultExerciseWeightKg        = 70.0
)

type ExerciseRepo interface {
	CreateExerciseLog(ctx context.Context, log *domain.ExerciseLog) error
	ListExerciseLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.ExerciseLog, error)
	GetExerciseLogByID(ctx context.Context, userID, logID string) (*domain.ExerciseLog, error)
	DeleteExerciseLog(ctx context.Context, userID, logID string) (int64, error)
	UpdateExerciseLog(ctx context.Context, userID, logID, exerciseDesc, imageURL string, recordedOn *string, caloriesBurned *float64) (int64, error)
	GetDailyCaloriesBurned(ctx context.Context, userID string, recordedOn string) (int64, error)
	GetUserProfile(ctx context.Context, userID string) (*domain.ExerciseUserProfile, error)
	GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error)
	CreateAnalysisTask(ctx context.Context, task *domain.AnalysisTask) error
	FailAnalysisTask(ctx context.Context, taskID, errorMsg string) error
	ResolveExerciseEnergyActivity(ctx context.Context, name string) (*domain.ExerciseEnergyResolveResult, error)
	CreatePendingExerciseEnergyActivity(ctx context.Context, input domain.ExerciseEnergyActivityInput) (*domain.ExerciseEnergyActivity, error)
}

type ExerciseService struct {
	repo        ExerciseRepo
	creditGuard CreditGuard
	rewards     InviteRewardActivator
	cfg         *config.Config
	client      *http.Client
	storage     *storage.Client
	taskQueue   taskqueue.Publisher
}

type ExercisePrecisionDetails struct {
	Enabled          bool
	TotalDurationMin int
	Intensity        string
	AverageHeartRate int
	DistanceKm       float64
	Breakdown        string
}

type exerciseJSONLLMConfig struct {
	Provider string
	APIKey   string
	BaseURL  string
	Model    string
}

const (
	defaultDoubaoExerciseModel = "doubao-seed-2-0-lite-260428"
	wanjieExerciseModel        = "qwen3.6-flash"
)

func exerciseModelForBaseURL(baseURL string) string {
	if strings.Contains(strings.ToLower(baseURL), "maas-openapi.wanjiedata.com") {
		return wanjieExerciseModel
	}
	return defaultDoubaoExerciseModel
}

func exerciseModelProvider(model string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "qwen") {
		return "qwen"
	}
	return "doubao"
}

func NewExerciseService(repo ExerciseRepo, cfg ...*config.Config) *ExerciseService {
	var c *config.Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	return &ExerciseService{repo: repo, cfg: c, client: &http.Client{Timeout: 45 * time.Second}}
}

type CreditGuard interface {
	ValidateExerciseCredits(ctx context.Context, userID, recordedOn string) (map[string]any, error)
	ValidateDietRecommendationCredits(ctx context.Context, userID string) (map[string]any, error)
	ValidateStatsInsightCredits(ctx context.Context, userID string) (map[string]any, error)
	ValidateUsageCredits(ctx context.Context, userID string, cost int, label string) (map[string]any, error)
	ConsumeEarnedCreditsOnTaskCreated(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error
	ConsumeEarnedCreditsAfterSuccess(ctx context.Context, userID string, creditsInfo map[string]any, cost int, reason, sourceKey string, meta map[string]any) error
	RefundEarnedCreditsAfterTaskFailure(ctx context.Context, userID string, creditsInfo map[string]any, cost int, spendReason, spendSourceKey, refundReason, refundSourceKey string, meta map[string]any) error
}

func (s *ExerciseService) ConfigureCreditGuard(guard CreditGuard) {
	s.creditGuard = guard
}

type InviteRewardActivator interface {
	ActivatePendingInviteReferralOnFirstValidUse(ctx context.Context, inviteeUserID, effectiveAction string) (*membershipdomain.UserInviteReferral, error)
}

func (s *ExerciseService) ConfigureInviteRewardActivator(rewards InviteRewardActivator) {
	s.rewards = rewards
}

func (s *ExerciseService) ConfigureStorage(storageClient *storage.Client) {
	s.storage = storageClient
}

func (s *ExerciseService) ConfigureTaskPublisher(queue taskqueue.Publisher) {
	s.taskQueue = queue
}

func (s *ExerciseService) GetDailyCalories(ctx context.Context, userID string, date string) (map[string]any, error) {
	normalizedDate, err := dateutil.NormalizeChinaDate(date, "date")
	if err != nil {
		return nil, err
	}
	total, err := s.repo.GetDailyCaloriesBurned(ctx, userID, normalizedDate)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"date":                  normalizedDate,
		"total_calories_burned": int(total),
	}, nil
}

func (s *ExerciseService) ListLogs(ctx context.Context, userID string, date string) (map[string]any, error) {
	return s.ListLogsByRange(ctx, userID, date, "", "")
}

func (s *ExerciseService) ListLogsByRange(ctx context.Context, userID string, date string, startDate string, endDate string) (map[string]any, error) {
	if date != "" {
		normalized, err := dateutil.NormalizeChinaDate(date, "date")
		if err != nil {
			return nil, err
		}
		startDate = normalized
		endDate = normalized
	} else if startDate != "" || endDate != "" {
		var err error
		if startDate != "" {
			startDate, err = dateutil.NormalizeChinaDate(startDate, "start_date")
			if err != nil {
				return nil, err
			}
		}
		if endDate != "" {
			endDate, err = dateutil.NormalizeChinaDate(endDate, "end_date")
			if err != nil {
				return nil, err
			}
		}
		if startDate == "" {
			startDate = endDate
		}
		if endDate == "" {
			endDate = startDate
		}
	} else {
		startDate = dateutil.TodayChina()
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
			"exercise_type":   nil,
			"image_url":       nil,
			"calories_burned": calories,
			"duration_min":    nil,
			"exercise_items":  log.ExerciseItems,
			"recorded_on":     nil,
			"recorded_at":     nil,
			"created_at":      nil,
			"ai_reasoning":    nil,
		}
		if log.AIReasoning != nil {
			item["ai_reasoning"] = *log.AIReasoning
		}
		if log.DurationMin != nil {
			item["duration_min"] = *log.DurationMin
		}
		if log.ExerciseType != nil {
			item["exercise_type"] = *log.ExerciseType
		}
		if log.ImageURL != nil {
			resolved := s.resolveFoodImageURL(*log.ImageURL)
			if resolved != "" {
				item["image_url"] = resolved
			}
		}
		if log.RecordedOn != nil {
			item["recorded_on"] = log.RecordedOn.Format("2006-01-02")
		}
		if log.CreatedAt != nil {
			item["created_at"] = log.CreatedAt.Format(time.RFC3339)
		}
		item["recorded_at"] = exerciseLogRecordedAt(log)
		logItems = append(logItems, item)
	}

	return map[string]any{
		"logs":           logItems,
		"total_calories": totalCalories,
		"count":          len(logs),
	}, nil
}

func (s *ExerciseService) CreateLog(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error) {
	return s.CreateLogWithDate(ctx, userID, exerciseDesc, "", "")
}

func (s *ExerciseService) CreateLogWithDate(ctx context.Context, userID string, exerciseDesc string, date string, imageURL string) (map[string]any, error) {
	return s.CreateLogWithDateAndDetails(ctx, userID, exerciseDesc, date, imageURL, ExercisePrecisionDetails{})
}

func (s *ExerciseService) CreateLogWithDateAndDetails(ctx context.Context, userID string, exerciseDesc string, date string, imageURL string, precision ExercisePrecisionDetails) (map[string]any, error) {
	desc := strings.TrimSpace(exerciseDesc)
	imageURL = s.resolveFoodImageURL(imageURL)
	if desc == "" && imageURL == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述和图片不能同时为空", HTTPStatus: 400}
	}
	if len([]rune(desc)) > exerciseMaxDescriptionRunes {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述过长", HTTPStatus: 400}
	}
	precision, err := normalizeExercisePrecisionDetails(precision)
	if err != nil {
		return nil, err
	}

	recordedOn, err := dateutil.ResolveRecordedOnDate(date, "date")
	if err != nil {
		return nil, err
	}
	var creditsInfo map[string]any
	if s.creditGuard != nil && userID != "" {
		creditsInfo, err = s.creditGuard.ValidateExerciseCredits(ctx, userID, recordedOn)
		if err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC()
	profileSnapshot, err := s.BuildExerciseProfileSnapshot(ctx, userID)
	if err != nil {
		return nil, err
	}

	task := &domain.AnalysisTask{
		UserID:   userID,
		TaskType: "exercise",
		Status:   "pending",
		Payload: map[string]any{
			"recorded_on":       recordedOn,
			"profile_snapshot":  profileSnapshot,
			"estimation_source": "go_exercise_worker",
		},
		CreatedAt: &now,
	}
	if precision.Enabled {
		task.Payload["estimation_mode"] = "precision"
		task.Payload["precision_details"] = map[string]any{
			"total_duration_min": precision.TotalDurationMin,
			"intensity":          precision.Intensity,
			"average_heart_rate": precision.AverageHeartRate,
			"distance_km":        precision.DistanceKm,
			"breakdown":          precision.Breakdown,
		}
	} else {
		task.Payload["estimation_mode"] = "standard"
	}
	creditGroupID := uuid.New().String()
	task.Payload["credit_group_id"] = creditGroupID
	if desc != "" {
		task.TextInput = &desc
	}
	if imageURL != "" {
		task.ImageURL = &imageURL
		task.Payload["image_url"] = imageURL
	}
	if creditsInfo != nil {
		if spendPlan, ok := creditsInfo["credit_spend_plan"]; ok {
			if usage, ok := spendPlan.(map[string]any); ok {
				usage["credit_group_id"] = creditGroupID
				task.Payload["credit_usage"] = usage
			} else {
				task.Payload["credit_usage"] = spendPlan
			}
		}
	}
	if err := s.repo.CreateAnalysisTask(ctx, task); err != nil {
		return nil, err
	}
	if s.creditGuard != nil && creditsInfo != nil {
		if err := s.creditGuard.ConsumeEarnedCreditsOnTaskCreated(ctx, userID, creditsInfo, creditCostExerciseLog, "exercise_reward_spend", "exercise:"+creditGroupID, map[string]any{
			"credit_group_id": creditGroupID,
			"task_id":         task.ID,
			"task_type":       task.TaskType,
		}); err != nil {
			_ = s.repo.FailAnalysisTask(ctx, task.ID, "credit reservation failed")
			return nil, err
		}
	}
	if err := s.enqueueTask(ctx, task.ID, task.TaskType); err != nil {
		_ = s.repo.FailAnalysisTask(ctx, task.ID, "exercise task enqueue failed")
		s.refundExerciseCredits(ctx, userID, creditsInfo, creditGroupID, task.ID)
		return nil, err
	}

	return map[string]any{
		"task_id": task.ID,
		"message": "运动分析任务已提交，请轮询任务状态直至完成",
	}, nil
}

func (s *ExerciseService) refundExerciseCredits(ctx context.Context, userID string, creditsInfo map[string]any, creditGroupID, taskID string) {
	if s.creditGuard == nil || creditsInfo == nil || userID == "" || creditGroupID == "" {
		return
	}
	_ = s.creditGuard.RefundEarnedCreditsAfterTaskFailure(ctx, userID, creditsInfo, creditCostExerciseLog,
		"exercise_reward_spend", "exercise:"+creditGroupID,
		"exercise_reward_refund", "exercise_refund:"+creditGroupID,
		map[string]any{
			"credit_group_id": creditGroupID,
			"task_id":         taskID,
			"task_type":       "exercise",
		},
	)
}

func normalizeExercisePrecisionDetails(details ExercisePrecisionDetails) (ExercisePrecisionDetails, error) {
	if !details.Enabled {
		return ExercisePrecisionDetails{}, nil
	}
	if details.TotalDurationMin < 1 || details.TotalDurationMin > 480 {
		return ExercisePrecisionDetails{}, &commonerrors.AppError{Code: 10002, Message: "精准估算请填写 1 到 480 分钟的总时长", HTTPStatus: 400}
	}
	details.Intensity = normalizeExerciseIntensityText(details.Intensity)
	if details.AverageHeartRate != 0 && (details.AverageHeartRate < 30 || details.AverageHeartRate > 250) {
		return ExercisePrecisionDetails{}, &commonerrors.AppError{Code: 10002, Message: "平均心率应在 30 到 250 次/分钟之间", HTTPStatus: 400}
	}
	if details.DistanceKm < 0 || details.DistanceKm > 1000 {
		return ExercisePrecisionDetails{}, &commonerrors.AppError{Code: 10002, Message: "运动距离应在 0 到 1000 公里之间", HTTPStatus: 400}
	}
	details.Breakdown = strings.TrimSpace(details.Breakdown)
	if len([]rune(details.Breakdown)) > 1000 {
		return ExercisePrecisionDetails{}, &commonerrors.AppError{Code: 10002, Message: "动作分配说明过长", HTTPStatus: 400}
	}
	return details, nil
}

func buildExerciseEstimationDescription(original string, payload map[string]any) string {
	if strings.TrimSpace(fmt.Sprintf("%v", payload["estimation_mode"])) != "precision" {
		return original
	}
	details := mapFromAny(payload["precision_details"])
	if len(details) == 0 {
		return original
	}
	parts := []string{strings.TrimSpace(original), "用户已确认的精准信息（优先于模型推测）："}
	if duration := intFromAny(details["total_duration_min"]); duration > 0 {
		parts = append(parts, fmt.Sprintf("整次训练总时长：%d分钟（只能使用一次，不是每个动作的时长）", duration))
	}
	if intensity := normalizeExerciseIntensityText(fmt.Sprintf("%v", details["intensity"])); intensity != "" {
		labels := map[string]string{"low": "轻松", "moderate": "中等", "high": "吃力"}
		parts = append(parts, "主观强度："+labels[intensity])
	}
	if heartRate := intFromAny(details["average_heart_rate"]); heartRate > 0 {
		parts = append(parts, fmt.Sprintf("平均心率：%d次/分钟", heartRate))
	}
	if distance, ok := floatFromAny(details["distance_km"]); ok && distance > 0 {
		parts = append(parts, fmt.Sprintf("运动距离：%.2f公里", distance))
	}
	if breakdown := strings.TrimSpace(fmt.Sprintf("%v", details["breakdown"])); breakdown != "" && breakdown != "<nil>" {
		parts = append(parts, "动作时间或组次分配："+breakdown)
	}
	return strings.Join(parts, "\n")
}

func (s *ExerciseService) enqueueTask(ctx context.Context, taskID, taskType string) error {
	if s.taskQueue == nil || strings.TrimSpace(taskID) == "" || strings.TrimSpace(taskType) == "" {
		return nil
	}
	publishCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := s.taskQueue.PublishTask(publishCtx, taskqueue.TaskMessage{TaskID: taskID, TaskType: taskType}); err != nil {
		return fmt.Errorf("enqueue exercise task: %w", err)
	}
	return nil
}

func (s *ExerciseService) EstimateCalories(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error) {
	desc := strings.TrimSpace(exerciseDesc)
	if desc == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述不能为空", HTTPStatus: 400}
	}
	if len([]rune(desc)) > exerciseMaxDescriptionRunes {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述过长", HTTPStatus: 400}
	}

	profileSnapshot, err := s.BuildExerciseProfileSnapshot(ctx, userID)
	if err != nil {
		return nil, err
	}
	estimate, err := s.estimateExerciseCalories(ctx, desc, "", profileSnapshot)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"estimated_calories": estimate.CaloriesKcal,
		"exercise_desc":      desc,
		"ai_response":        estimate.Raw,
		"reasoning":          estimate.Reasoning,
		"profile_snapshot":   profileSnapshot,
		"exercise_items":     exerciseItemsFromEstimate(desc, estimate),
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

func (s *ExerciseService) UpdateLog(ctx context.Context, userID, logID, exerciseDesc, imageURL, date string, caloriesBurned *float64) error {
	log, err := s.repo.GetExerciseLogByID(ctx, userID, logID)
	if err != nil {
		return err
	}
	if log == nil {
		return commonerrors.ErrNotFound
	}
	desc := strings.TrimSpace(exerciseDesc)
	imageURL = s.resolveFoodImageURL(imageURL)
	if desc == "" && imageURL == "" {
		return &commonerrors.AppError{Code: 10002, Message: "运动描述和图片不能同时为空", HTTPStatus: 400}
	}
	var recordedOn *string
	if date != "" {
		normalized, err := dateutil.NormalizeChinaDate(date, "date")
		if err != nil {
			return err
		}
		recordedOn = &normalized
	}
	rowsAffected, err := s.repo.UpdateExerciseLog(ctx, userID, logID, desc, imageURL, recordedOn, caloriesBurned)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return commonerrors.ErrNotFound
	}
	return nil
}

func (s *ExerciseService) BuildExerciseProfileSnapshot(ctx context.Context, userID string) (map[string]any, error) {
	snapshot := map[string]any{}
	user, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	latestWeight, err := s.repo.GetLatestWeightRecord(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user != nil {
		if user.Height != nil {
			snapshot["height_cm"] = round1(*user.Height)
		}
		if user.Gender != nil {
			gender := strings.ToLower(strings.TrimSpace(*user.Gender))
			if gender == "male" || gender == "female" {
				snapshot["gender"] = gender
			}
		}
		if user.Birthday != nil && strings.TrimSpace(*user.Birthday) != "" {
			birthday := strings.TrimSpace(*user.Birthday)
			snapshot["birthday"] = birthday
			if age := ageFromBirthday(birthday, time.Now().In(chinaTZ)); age > 0 {
				snapshot["age_years"] = age
			}
		}
		if user.ActivityLevel != nil && strings.TrimSpace(*user.ActivityLevel) != "" {
			snapshot["activity_level"] = strings.TrimSpace(*user.ActivityLevel)
		}
		if user.BMR != nil {
			snapshot["bmr"] = round1(*user.BMR)
		}
		if user.TDEE != nil {
			snapshot["tdee"] = round1(*user.TDEE)
		}
	}
	if latestWeight != nil {
		snapshot["weight_kg"] = round1(latestWeight.WeightKg)
		snapshot["weight_source"] = "latest_weight_record"
		if latestWeight.RecordedOn != nil {
			snapshot["weight_recorded_on"] = latestWeight.RecordedOn.In(chinaTZ).Format("2006-01-02")
		}
	} else if user != nil && user.Weight != nil {
		snapshot["weight_kg"] = round1(*user.Weight)
		snapshot["weight_source"] = "user_profile"
	}
	return snapshot, nil
}

func (s *ExerciseService) ProcessExerciseTask(ctx context.Context, userID, exerciseDesc, imageURL, recordedOn string, payload map[string]any) (map[string]any, error) {
	start := time.Now()
	status := "success"
	desc := strings.TrimSpace(exerciseDesc)
	imageURL = s.resolveFoodImageURL(imageURL)
	source := "text"
	if desc == "" && imageURL != "" {
		source = "image"
	} else if desc != "" && imageURL != "" {
		source = "text_image"
	}
	defer func() {
		metrics.ObserveExerciseAnalysis("task", source, status, time.Since(start))
	}()
	if desc == "" && imageURL == "" {
		status = "validation_error"
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述和图片不能同时为空", HTTPStatus: 400}
	}
	if recordedOn == "" {
		recordedOn = time.Now().In(chinaTZ).Format("2006-01-02")
	}
	profileSnapshot := mapFromAny(payload["profile_snapshot"])
	if len(profileSnapshot) == 0 {
		var err error
		profileSnapshot, err = s.BuildExerciseProfileSnapshot(ctx, userID)
		if err != nil {
			status = "profile_error"
			return nil, err
		}
	}
	estimationDesc := buildExerciseEstimationDescription(desc, payload)
	estimate, err := s.estimateExerciseCalories(ctx, estimationDesc, imageURL, profileSnapshot)
	if err != nil {
		status = "estimate_error"
		return nil, err
	}
	now := time.Now().UTC()
	recordedDate, err := parseChinaDate(recordedOn)
	if err != nil {
		recordedOn = time.Now().In(chinaTZ).Format("2006-01-02")
		recordedDate, _ = parseChinaDate(recordedOn)
	}
	calories := float64(estimate.CaloriesKcal)
	var durationMin *int
	if estimate.DurationMin > 0 {
		value := estimate.DurationMin
		durationMin = &value
	}
	reasoning := estimate.Reasoning
	logDesc := resolveExerciseLogDesc(desc, estimate)
	exerciseItems := exerciseItemsFromEstimate(desc, estimate)
	var storedImageURL *string
	if imageURL != "" {
		storedImageURL = &imageURL
	}
	var exerciseType *string
	if strings.TrimSpace(estimate.ExerciseType) != "" {
		value := strings.TrimSpace(estimate.ExerciseType)
		exerciseType = &value
	}
	log := &domain.ExerciseLog{
		UserID:         userID,
		ExerciseDesc:   logDesc,
		ExerciseType:   exerciseType,
		ImageURL:       storedImageURL,
		CaloriesBurned: &calories,
		DurationMin:    durationMin,
		RecordedOn:     &recordedDate,
		RecordedAt:     &now,
		AIReasoning:    &reasoning,
		ExerciseItems:  exerciseItems,
		CreatedAt:      &now,
	}
	if err := s.repo.CreateExerciseLog(ctx, log); err != nil {
		status = "persist_error"
		return nil, err
	}
	s.activateInviteReward(ctx, userID, "exercise_log")
	total, err := s.repo.GetDailyCaloriesBurned(ctx, userID, recordedOn)
	if err != nil {
		status = "daily_total_error"
		return nil, err
	}
	exerciseLog := map[string]any{
		"id":              log.ID,
		"exercise_desc":   log.ExerciseDesc,
		"exercise_type":   estimate.ExerciseType,
		"image_url":       imageURL,
		"calories_burned": int(calories),
		"duration_min":    estimate.DurationMin,
		"exercise_items":  exerciseItems,
		"recorded_on":     recordedOn,
		"recorded_at":     now.Format(time.RFC3339),
		"ai_reasoning":    reasoning,
	}
	return map[string]any{
		"exercise_log":       exerciseLog,
		"estimated_calories": estimate.CaloriesKcal,
		"ai_response":        estimate.Raw,
		"reasoning":          reasoning,
		"profile_snapshot":   profileSnapshot,
		"today_total":        total,
		"exercise_type":      estimate.ExerciseType,
		"estimation_mode":    strings.TrimSpace(fmt.Sprintf("%v", payload["estimation_mode"])),
	}, nil
}

func (s *ExerciseService) activateInviteReward(ctx context.Context, userID, action string) {
	if s.rewards == nil || strings.TrimSpace(userID) == "" {
		return
	}
	if _, err := s.rewards.ActivatePendingInviteReferralOnFirstValidUse(ctx, userID, action); err != nil {
		logger.Warn(ctx, "运动记录邀请奖励激活失败",
			slog.String("user_id", userID),
			slog.String("reward.action", action),
			logger.Err(err),
		)
	}
}

type ExerciseEstimate struct {
	CaloriesKcal int
	DurationMin  int
	Raw          string
	Reasoning    string
	Source       string
	ExerciseType string
}

func exerciseItemsFromEstimate(inputDesc string, estimate ExerciseEstimate) []map[string]any {
	if strings.TrimSpace(estimate.Raw) == "" {
		return nil
	}
	var rawObj map[string]any
	if err := json.Unmarshal([]byte(estimate.Raw), &rawObj); err != nil {
		return nil
	}

	// 长文本 library MET 链路：已经生成结构化 items
	if mode, _ := rawObj["mode"].(string); mode == "long_text_library_met" {
		itemsRaw, _ := rawObj["items"].([]any)
		items := make([]map[string]any, 0, len(itemsRaw))
		for _, rowRaw := range itemsRaw {
			row, ok := rowRaw.(map[string]any)
			if !ok {
				continue
			}
			name, _ := row["name"].(string)
			if strings.TrimSpace(name) == "" {
				continue
			}
			items = append(items, cloneMap(row))
		}
		if len(items) > 0 {
			return items
		}
	}

	// 分段估算链路：把每个 segment 转换成独立 item
	if segmentsRaw, ok := rawObj["segments"].([]any); ok && len(segmentsRaw) > 0 {
		items := make([]map[string]any, 0, len(segmentsRaw))
		for _, segRaw := range segmentsRaw {
			seg, ok := segRaw.(map[string]any)
			if !ok {
				continue
			}
			segment, _ := seg["segment"].(string)
			name := strings.TrimSpace(segment)
			if name == "" {
				continue
			}
			durationMin, sets, reps := extractExerciseMetrics(name)
			item := map[string]any{
				"name":          cleanExerciseSegmentName(name),
				"duration_min":  durationMin,
				"sets":          sets,
				"reps":          reps,
				"calories_kcal": toExerciseInt(seg["calories_kcal"]),
				"reasoning":     seg["reasoning"],
				"source":        seg["source"],
			}
			items = append(items, item)
		}
		if len(items) > 0 {
			return items
		}
	}

	// 单条 LLM 估算（短文本或图片）：用 exercise_type 作为唯一 item
	exerciseType := strings.TrimSpace(estimate.ExerciseType)
	if exerciseType == "" {
		return nil
	}
	durationMin, sets, reps := extractExerciseMetrics(inputDesc)
	if estimate.DurationMin > 0 {
		durationMin = estimate.DurationMin
	}
	return []map[string]any{{
		"name":          exerciseType,
		"duration_min":  durationMin,
		"sets":          sets,
		"reps":          reps,
		"calories_kcal": estimate.CaloriesKcal,
		"reasoning":     estimate.Reasoning,
		"source":        estimate.Source,
	}}
}

func cloneMap(m map[string]any) map[string]any {
	cloned := make(map[string]any, len(m))
	for key, value := range m {
		cloned[key] = value
	}
	return cloned
}

func extractExerciseMetrics(text string) (durationMin, sets, reps int) {
	text = strings.TrimSpace(text)
	durationMin = extractDurationMinutes(text)
	sets, reps = extractSetsAndReps(text)
	if sets > 0 && reps == 0 {
		if seconds := extractSetSeconds(text); seconds > 0 {
			durationMin = sets * seconds / 60
		}
	}
	return
}

func extractDurationMinutes(text string) int {
	matches := exerciseMinuteRe.FindStringSubmatch(text)
	if len(matches) >= 2 {
		if v, err := strconv.ParseFloat(matches[1], 64); err == nil {
			return int(v + 0.5)
		}
	}
	matches = exerciseHourRe.FindStringSubmatch(text)
	if len(matches) >= 2 {
		if v, err := strconv.ParseFloat(matches[1], 64); err == nil {
			return int(v*60 + 0.5)
		}
	}
	return 0
}

func extractSetsAndReps(text string) (sets, reps int) {
	matches := exerciseSetRepRe.FindStringSubmatch(text)
	if len(matches) >= 3 {
		sets, _ = strconv.Atoi(matches[1])
		reps, _ = strconv.Atoi(matches[2])
	}
	return
}

func extractSetSeconds(text string) int {
	matches := exerciseSetSecondRe.FindStringSubmatch(text)
	if len(matches) >= 3 {
		if seconds, err := strconv.Atoi(matches[2]); err == nil {
			return seconds
		}
	}
	return 0
}

func cleanExerciseSegmentName(segment string) string {
	name := segment
	name = exerciseMinuteRe.ReplaceAllString(name, "")
	name = exerciseSetRepRe.ReplaceAllString(name, "")
	name = exerciseSetSecondRe.ReplaceAllString(name, "")
	name = exerciseEachSecondRe.ReplaceAllString(name, "")
	name = strings.TrimSpace(name)
	name = strings.Trim(name, "；;。，,\n\r")
	if name == "" {
		return strings.TrimSpace(segment)
	}
	return name
}

func toExerciseInt(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	case string:
		if i, err := strconv.Atoi(n); err == nil {
			return i
		}
	}
	return 0
}

func shouldPreferLibraryMETForStructuredText(desc string) bool {
	desc = strings.TrimSpace(desc)
	if desc == "" {
		return false
	}
	return extractDurationMinutes(desc) > 0
}

type extractedExerciseItem struct {
	Name        string
	DurationMin float64
	Sets        int
	Reps        int
	Intensity   string
	Evidence    string
}

type exerciseMETEstimate struct {
	ActivityName string
	Category     string
	Intensity    string
	METValue     float64
	Reasoning    string
	Raw          string
}

var (
	exerciseSegmentSplitRe = regexp.MustCompile(`[\r\n;；。]+`)
	exerciseJSONFenceRe    = regexp.MustCompile("(?s)```json?\\s*\\n?|```")
	exerciseJSONObjRe      = regexp.MustCompile(`(?s)\{.*\}`)
	exerciseKnownNameRe    = regexp.MustCompile(`跑步机跑步|龙门架高位下拉|高位下拉|坐姿划船|哑铃推举|绳索下压|平板支撑|背部伸展|垫上卷腹|全身肌群拉伸|杠铃深蹲|深蹲|卧推|臂弯举|弯举|跑步机|慢跑|跑步|卷腹|拉伸|跳绳|壶铃摆动|壶铃训练`)
	exerciseSetRepRe       = regexp.MustCompile(`(\d+)\s*组\s*(\d+)\s*次`)
	exerciseSetSecondRe    = regexp.MustCompile(`(\d+)\s*组\s*(\d+)\s*秒`)
	exerciseMinuteRe       = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(?:分钟|min|mins|minute|minutes)`)
	exerciseHourRe         = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(?:小时|个小时|h|hr|hrs|hour|hours)`)
	exerciseTotalMinuteRe  = regexp.MustCompile(`(?i)(?:一共|总共|共计|总计|合计|累计|总时长|全程|整个(?:训练|锻炼|运动)?)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:分钟|min|mins|minute|minutes)`)
	exerciseTotalHourRe    = regexp.MustCompile(`(?i)(?:一共|总共|共计|总计|合计|累计|总时长|全程|整个(?:训练|锻炼|运动)?)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:小时|个小时|h|hr|hrs|hour|hours)`)
	exerciseEachSecondRe   = regexp.MustCompile(`各\s*(\d+)\s*秒`)
)

func resolveExerciseLogDesc(inputDesc string, estimate ExerciseEstimate) string {
	desc := strings.TrimSpace(inputDesc)
	if desc != "" {
		return desc
	}
	return "图片识别运动"
}

func isWeakExerciseTitle(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return true
	}
	normalized = strings.ReplaceAll(normalized, " ", "")
	weakTitles := map[string]struct{}{
		"运动":       {},
		"锻炼":       {},
		"健身":       {},
		"打卡":       {},
		"运动打卡":     {},
		"今日运动":     {},
		"今天运动":     {},
		"图片":       {},
		"照片":       {},
		"图片识别运动":   {},
		"exercise": {},
		"workout":  {},
	}
	_, ok := weakTitles[normalized]
	return ok
}

func (s *ExerciseService) estimateExerciseCalories(ctx context.Context, desc, imageURL string, profileSnapshot map[string]any) (ExerciseEstimate, error) {
	imageURL = strings.TrimSpace(imageURL)
	return s.estimateSingleExerciseCalories(ctx, desc, imageURL, profileSnapshot)
}

func (s *ExerciseService) estimateLongExerciseCalories(ctx context.Context, desc string, profileSnapshot map[string]any) (ExerciseEstimate, error) {
	items, rawExtraction := extractExerciseItemsHeuristically(desc)
	if len(items) < 3 {
		llmItems, llmRaw, err := s.extractExerciseItemsWithLLM(ctx, desc)
		if err != nil {
			return ExerciseEstimate{}, err
		}
		items = llmItems
		rawExtraction = llmRaw
	}
	if len(items) == 0 {
		return ExerciseEstimate{}, fmt.Errorf("运动分析结果未识别到有效运动项目")
	}
	weightKg := exerciseWeightFromProfile(profileSnapshot)
	total := 0.0
	rows := make([]map[string]any, 0, len(items))
	reasoningParts := []string{}
	primaryType := ""
	for _, item := range items {
		if primaryType == "" {
			primaryType = item.Name
		}
		met, metSource, libraryID, matchStatus, metReasoning, rawMET, err := s.resolveExerciseMET(ctx, item)
		if err != nil {
			return ExerciseEstimate{}, err
		}
		durationMin := normalizeExerciseDuration(item.DurationMin, item.Sets, item.Reps)
		calories := met * weightKg * durationMin / 60.0
		total += calories
		row := map[string]any{
			"name":          item.Name,
			"duration_min":  roundExerciseFloat(durationMin),
			"sets":          item.Sets,
			"reps":          item.Reps,
			"intensity":     item.Intensity,
			"met":           roundExerciseFloat(met),
			"calories_kcal": int(calories + 0.5),
			"source":        metSource,
			"match_status":  matchStatus,
			"library_id":    libraryID,
			"reasoning":     metReasoning,
		}
		if rawMET != "" {
			row["raw_met_response"] = rawMET
		}
		rows = append(rows, row)
		reasoningParts = append(reasoningParts, fmt.Sprintf("%s%d分钟≈%dkcal", trimRunes(item.Name, 12), int(durationMin+0.5), int(calories+0.5)))
	}
	reasoning := "分项识别：" + strings.Join(reasoningParts, "；")
	if len([]rune(reasoning)) > 200 {
		reasoning = trimRunes(reasoning, 200) + "..."
	}
	rawBytes, _ := json.Marshal(map[string]any{
		"mode":              "long_text_library_met",
		"items":             rows,
		"extraction_raw":    rawExtraction,
		"weight_kg":         weightKg,
		"calories_kcal":     int(total + 0.5),
		"reasoning":         reasoning,
		"long_text_cutover": exerciseLongTextThresholdRunes,
	})
	return ExerciseEstimate{
		CaloriesKcal: clampInt(int(total+0.5), 1, 5000),
		Raw:          string(rawBytes),
		Reasoning:    reasoning,
		Source:       "long_text_library_met",
		ExerciseType: trimRunes(primaryType, 20),
	}, nil
}

func (s *ExerciseService) resolveExerciseMET(ctx context.Context, item extractedExerciseItem) (float64, string, string, string, string, string, error) {
	resolved, err := s.repo.ResolveExerciseEnergyActivity(ctx, item.Name)
	if err != nil {
		return 0, "", "", "", "", "", err
	}
	if resolved != nil && resolved.Activity != nil && resolved.Activity.METValue > 0 {
		return resolved.Activity.METValue, "exercise_energy_library", resolved.Activity.ID, resolved.Status, "命中运动标准库 MET", "", nil
	}
	estimate, err := s.estimateExerciseMETWithLLM(ctx, item)
	if err != nil {
		return 0, "", "", "", "", "", err
	}
	activity, err := s.repo.CreatePendingExerciseEnergyActivity(ctx, domain.ExerciseEnergyActivityInput{
		CanonicalName: estimate.ActivityName,
		Category:      estimate.Category,
		Intensity:     estimate.Intensity,
		METValue:      estimate.METValue,
		Source:        "llm_pending",
		Evidence:      estimate.Reasoning,
		ReviewStatus:  "pending",
		IsActive:      true,
		Aliases:       []string{item.Name},
	})
	if err != nil {
		return 0, "", "", "", "", "", err
	}
	libraryID := ""
	if activity != nil {
		libraryID = activity.ID
	}
	return estimate.METValue, "llm_pending_met", libraryID, "created_pending", estimate.Reasoning, estimate.Raw, nil
}

func (s *ExerciseService) estimateSingleExerciseCalories(ctx context.Context, desc, imageURL string, profileSnapshot map[string]any) (ExerciseEstimate, error) {
	estimate, err := s.estimateExerciseCaloriesWithLLM(ctx, desc, imageURL, profileSnapshot)
	if err == nil {
		if totalDuration, ok := extractExplicitTotalDurationMinutes(desc); ok {
			estimate.DurationMin = int(totalDuration + 0.5)
		} else if estimate.DurationMin <= 0 {
			estimate.DurationMin = extractDurationMinutes(desc)
		}
		return estimate, nil
	}
	return ExerciseEstimate{}, err
}

func (s *ExerciseService) estimateExerciseCaloriesWithLLM(ctx context.Context, desc, imageURL string, profileSnapshot map[string]any) (ExerciseEstimate, error) {
	start := time.Now()
	status := "success"
	source := "unknown"
	defer func() {
		metrics.ObserveExerciseAnalysis("llm", source, status, time.Since(start))
	}()
	apiKey := ""
	baseURL := "https://ark.cn-beijing.volces.com/api/v3"
	if s.cfg != nil {
		apiKey = strings.TrimSpace(s.cfg.External.DoubaoAPIKey)
		if configuredBaseURL := strings.TrimSpace(s.cfg.External.DoubaoBaseURL); configuredBaseURL != "" {
			baseURL = strings.TrimRight(configuredBaseURL, "/")
		}
	}
	model := exerciseModelForBaseURL(baseURL)
	provider := exerciseModelProvider(model)
	if apiKey == "" {
		status = "config_error"
		return ExerciseEstimate{}, &commonerrors.AppError{Code: 10000, Message: "运动分析服务未配置，请联系管理员处理", HTTPStatus: 500}
	}
	desc = strings.TrimSpace(desc)
	imageURL = strings.TrimSpace(imageURL)
	source = "text"
	if desc == "" && imageURL != "" {
		source = "image"
	} else if desc != "" && imageURL != "" {
		source = "text_image"
	}
	logger.Info(ctx, "运动热量大模型估算开始",
		logger.Stage("llm_call"),
		logger.ProviderModel(provider, model),
		slog.String("source", source),
		logger.Truncated("exercise_desc", desc, 120),
		slog.Bool("has_image", imageURL != ""),
	)
	userPrompt := "用户运动描述：" + compactExerciseDesc(desc)
	if desc == "" {
		userPrompt = "用户上传了一张运动图片，请识别主要运动类型、估算持续时长和消耗热量。"
	}
	if profileText := formatExerciseProfileSnapshot(profileSnapshot); profileText != "" {
		userPrompt += "\n\n" + profileText + "\n\n请结合这些真实信息估算；只有缺失字段才允许合理假设。"
	}
	userContent := any(userPrompt)
	systemPrompt := "你是运动热量估算助手。把用户描述视为一次完整训练，只给整次训练的总消耗，不要把多个动作分别计算后展示，也不要输出 items、MET 或分项热量。严格区分总时长与单项时长：用户说‘一共/总共/总时长40分钟’时，整次训练只能按40分钟估算，绝不能把40分钟重复套到每个动作。只输出 JSON 对象，不要 markdown。格式为 {\"exercise_type\":\"运动类型概括\",\"duration_min\":40,\"reasoning\":\"一句简短中文\",\"calories_kcal\":123}。exercise_type 不超过20字，reasoning 不超过80个汉字。calories_kcal 只表示整次运动相比静息状态的额外能量，不包含基础代谢；信息不足时保守估算并在 reasoning 中说明缺少的关键信息。"
	if imageURL != "" {
		systemPrompt = "你是运动热量估算助手。结合用户原文和图片，把内容视为一次完整训练，只给整次训练的总消耗，不要输出 items、MET 或分项热量。若图片是训练打卡截图，先读取动作、重量、次数、组数、整次总耗时、心率或设备总消耗；严格区分总时长和单项时长，同一个总时长只能使用一次。只输出 JSON 对象，不要 markdown。格式为 {\"exercise_type\":\"运动类型概括\",\"duration_min\":40,\"reasoning\":\"一句简短中文\",\"calories_kcal\":123}。calories_kcal 只表示整次运动相比静息状态的额外能量，不包含基础代谢；信息不足时保守估算并说明缺少的关键信息。"
		userContent = []map[string]any{
			{"type": "text", "text": userPrompt},
			{"type": "image_url", "image_url": map[string]string{"url": imageURL}},
		}
	}
	body := map[string]any{
		"model": model,
		"messages": []map[string]any{
			{
				"role":    "system",
				"content": systemPrompt,
			},
			{"role": "user", "content": userContent},
		},
		"temperature":      0.25,
		"max_tokens":       320,
		"reasoning_effort": "medium",
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		status = "request_build_error"
		return ExerciseEstimate{}, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		status = "request_error"
		metrics.ObserveLLMCall("exercise", provider, model, status, time.Since(start))
		logger.Warn(ctx, "运动热量大模型请求失败",
			logger.Stage("llm_call"),
			logger.ProviderModel(provider, model),
			slog.String("source", source),
			logger.Err(err),
		)
		return ExerciseEstimate{}, fmt.Errorf("运动分析服务请求失败: %w", err)
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		status = fmt.Sprintf("http_%d", resp.StatusCode)
		metrics.ObserveLLMCall("exercise", provider, model, status, time.Since(start))
		return ExerciseEstimate{}, fmt.Errorf("运动分析服务返回异常 %d", resp.StatusCode)
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil || len(parsed.Choices) == 0 {
		status = "response_parse_error"
		metrics.ObserveLLMCall("exercise", "doubao", model, status, time.Since(start))
		return ExerciseEstimate{}, fmt.Errorf("运动分析服务响应解析失败")
	}
	raw := strings.TrimSpace(parsed.Choices[0].Message.Content)
	estimate, err := parseExerciseEstimateJSON(raw)
	if err != nil {
		status = "result_parse_error"
		metrics.ObserveLLMCall("exercise", "doubao", model, status, time.Since(start))
		logger.Warn(ctx, "运动热量大模型结果解析失败",
			logger.Stage("llm_parse"),
			logger.ProviderModel(provider, model),
			logger.LLMResponseSummary(raw),
			logger.Err(err),
		)
		return ExerciseEstimate{}, fmt.Errorf("运动分析结果格式解析失败: %w", err)
	}
	estimate.Raw = raw
	estimate.Source = "llm"
	metrics.ObserveLLMCall("exercise", provider, model, "success", time.Since(start))
	logger.Info(ctx, "运动热量大模型估算完成",
		logger.Stage("llm_call"),
		logger.ProviderModel(provider, model),
		slog.String("source", source),
		slog.String("exercise_type", estimate.ExerciseType),
		slog.Int("calories_kcal", estimate.CaloriesKcal),
		logger.Truncated("reasoning", estimate.Reasoning, 120),
		slog.Duration("duration", time.Since(start)),
	)
	return estimate, nil
}

func (s *ExerciseService) extractExerciseItemsWithLLM(ctx context.Context, desc string) ([]extractedExerciseItem, string, error) {
	raw, err := s.callExerciseJSONLLM(ctx,
		"你是运动记录结构化助手。只输出 JSON 对象，不要 markdown。格式为 {\"total_duration_min\":40,\"items\":[{\"name\":\"运动名称\",\"duration_min\":15,\"sets\":0,\"reps\":0,\"intensity\":\"low|moderate|high\",\"evidence\":\"原文片段\"}]}。必须列出用户文字中所有明确提到的运动或训练动作。严格区分总时长和单项时长：用户说“一共/总共/总时长40分钟”时，40只属于 total_duration_min，绝对不能复制给每个动作；若原文没有各动作时长，应合理分配且所有动作 duration_min 之和不得超过总时长。能从“半小时/一小时/20min/3组12次”等表达推断时长或组数。完全无有效运动则 items 为空数组。",
		"用户运动描述："+strings.TrimSpace(desc),
		900,
	)
	if err != nil {
		return nil, "", err
	}
	items, err := parseExtractedExerciseItems(raw)
	if err != nil {
		return nil, raw, fmt.Errorf("运动项目抽取结果格式解析失败: %w", err)
	}
	return items, raw, nil
}

func (s *ExerciseService) estimateExerciseMETWithLLM(ctx context.Context, item extractedExerciseItem) (exerciseMETEstimate, error) {
	prompt := fmt.Sprintf("运动项目：%s\n时长：%.1f分钟\n组数：%d\n次数：%d\n强度：%s\n原文证据：%s", item.Name, item.DurationMin, item.Sets, item.Reps, item.Intensity, item.Evidence)
	raw, err := s.callExerciseJSONLLM(ctx,
		"你是运动 MET 标准化助手。只输出 JSON 对象，不要 markdown。格式为 {\"activity_name\":\"粗粒度运动名称\",\"category\":\"cardio|strength|ball|flexibility|daily|other\",\"intensity\":\"low|moderate|high\",\"met\":6.0,\"reasoning\":\"一句中文依据\"}。运动类型要粗，不要过细；MET 必须是 1 到 30 的合理数值。",
		prompt,
		360,
	)
	if err != nil {
		return exerciseMETEstimate{}, err
	}
	estimate, err := parseExerciseMETEstimate(raw, item.Name)
	if err != nil {
		return exerciseMETEstimate{}, fmt.Errorf("运动 MET 估算结果格式解析失败: %w", err)
	}
	estimate.Raw = raw
	return estimate, nil
}

func (s *ExerciseService) callExerciseJSONLLM(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	configs := s.resolveExerciseJSONLLMConfigs()
	if len(configs) == 0 {
		return "", &commonerrors.AppError{Code: 10000, Message: "运动分析服务未配置，请联系管理员处理", HTTPStatus: 500}
	}
	var lastErr error
	for idx, llmConfig := range configs {
		raw, err := s.callExerciseJSONLLMOnce(ctx, llmConfig, systemPrompt, userPrompt, maxTokens)
		if err == nil {
			return raw, nil
		}
		if ctx.Err() != nil {
			return "", err
		}
		lastErr = err
		if idx < len(configs)-1 {
			logger.Warn(ctx, "运动长文本大模型调用失败，尝试备用模型",
				logger.ProviderModel(llmConfig.Provider, llmConfig.Model),
				logger.Err(err),
			)
		}
	}
	return "", lastErr
}

func (s *ExerciseService) callExerciseJSONLLMOnce(ctx context.Context, llmConfig exerciseJSONLLMConfig, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	start := time.Now()
	status := "unknown"
	if llmConfig.APIKey == "" {
		status = "missing_api_key"
		metrics.ObserveLLMCall("exercise_long_text", llmConfig.Provider, llmConfig.Model, status, time.Since(start))
		return "", fmt.Errorf("运动分析服务 %s 未配置密钥", llmConfig.Provider)
	}
	body := map[string]any{
		"model": llmConfig.Model,
		"messages": []map[string]any{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"temperature":      0.2,
		"max_tokens":       maxTokens,
		"reasoning_effort": "medium",
	}
	if llmConfig.Provider == "gemini" {
		body["response_format"] = map[string]string{"type": "json_object"}
		delete(body, "reasoning_effort")
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, llmConfig.BaseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		status = "request_build_error"
		metrics.ObserveLLMCall("exercise_long_text", llmConfig.Provider, llmConfig.Model, status, time.Since(start))
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+llmConfig.APIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		status = "request_error"
		metrics.ObserveLLMCall("exercise_long_text", llmConfig.Provider, llmConfig.Model, status, time.Since(start))
		return "", fmt.Errorf("运动分析服务请求失败: %w", err)
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		status = fmt.Sprintf("http_%d", resp.StatusCode)
		metrics.ObserveLLMCall("exercise_long_text", llmConfig.Provider, llmConfig.Model, status, time.Since(start))
		return "", fmt.Errorf("运动分析服务返回异常 %d", resp.StatusCode)
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBytes, &parsed); err != nil || len(parsed.Choices) == 0 {
		status = "response_parse_error"
		metrics.ObserveLLMCall("exercise_long_text", llmConfig.Provider, llmConfig.Model, status, time.Since(start))
		return "", fmt.Errorf("运动分析服务响应解析失败")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if content == "" {
		status = "empty_content"
		metrics.ObserveLLMCall("exercise_long_text", llmConfig.Provider, llmConfig.Model, status, time.Since(start))
		return "", fmt.Errorf("运动分析服务返回空内容")
	}
	if err := validateExerciseJSONContent(content); err != nil {
		status = "content_json_parse_error"
		metrics.ObserveLLMCall("exercise_long_text", llmConfig.Provider, llmConfig.Model, status, time.Since(start))
		return "", fmt.Errorf("运动分析服务返回的 JSON 不完整: %w", err)
	}
	metrics.ObserveLLMCall("exercise_long_text", llmConfig.Provider, llmConfig.Model, "success", time.Since(start))
	return content, nil
}

func (s *ExerciseService) resolveExerciseJSONLLMConfigs() []exerciseJSONLLMConfig {
	if s.cfg == nil {
		return nil
	}
	configs := make([]exerciseJSONLLMConfig, 0, 2)
	if strings.TrimSpace(s.cfg.External.Gemini35APIKey) != "" {
		baseURL := strings.TrimRight(strings.TrimSpace(s.cfg.External.Gemini35BaseURL), "/")
		if baseURL == "" {
			baseURL = "https://api.ofox.ai/v1"
		}
		model := strings.TrimSpace(s.cfg.External.Gemini35Model)
		if model == "" {
			model = "gemini-3.5-flash"
		}
		configs = append(configs, exerciseJSONLLMConfig{
			Provider: "gemini",
			APIKey:   strings.TrimSpace(s.cfg.External.Gemini35APIKey),
			BaseURL:  baseURL,
			Model:    model,
		})
	}
	if strings.TrimSpace(s.cfg.External.DoubaoAPIKey) != "" {
		baseURL := "https://ark.cn-beijing.volces.com/api/v3"
		if configuredBaseURL := strings.TrimSpace(s.cfg.External.DoubaoBaseURL); configuredBaseURL != "" {
			baseURL = strings.TrimRight(configuredBaseURL, "/")
		}
		configs = append(configs, exerciseJSONLLMConfig{
			Provider: exerciseModelProvider(exerciseModelForBaseURL(baseURL)),
			APIKey:   strings.TrimSpace(s.cfg.External.DoubaoAPIKey),
			BaseURL:  baseURL,
			Model:    exerciseModelForBaseURL(baseURL),
		})
	}
	return configs
}

func (s *ExerciseService) resolveFoodImageURL(value string) string {
	value = strings.TrimSpace(value)
	switch strings.ToLower(value) {
	case "", "undefined", "null", "<nil>":
		return ""
	}
	if s.storage == nil {
		return value
	}
	resolved := s.storage.ResolveReferenceURL("food-images", value)
	if resolved == "" {
		return value
	}
	return resolved
}

func parseExerciseEstimateJSON(raw string) (ExerciseEstimate, error) {
	cleaned := strings.TrimSpace(exerciseJSONFenceRe.ReplaceAllString(raw, ""))
	if match := exerciseJSONObjRe.FindString(cleaned); match != "" {
		cleaned = match
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(cleaned), &payload); err != nil {
		return ExerciseEstimate{}, err
	}
	calories := intFromAny(payload["calories_kcal"])
	if calories <= 0 {
		calories = intFromAny(payload["calories"])
	}
	if calories <= 0 {
		calories = intFromAny(payload["kcal"])
	}
	if calories <= 0 {
		return ExerciseEstimate{}, fmt.Errorf("missing calories_kcal")
	}
	reasoning := strings.TrimSpace(fmt.Sprintf("%v", payload["reasoning"]))
	if reasoning == "" || reasoning == "<nil>" {
		reasoning = "基于运动类型、时长和用户画像估算"
	}
	exerciseType := strings.TrimSpace(fmt.Sprintf("%v", payload["exercise_type"]))
	if exerciseType == "" || exerciseType == "<nil>" {
		exerciseType = ""
	}
	durationMin := intFromAny(firstNonNil(payload["duration_min"], payload["duration_minutes"], payload["minutes"]))
	return ExerciseEstimate{CaloriesKcal: clampInt(calories, 1, 5000), DurationMin: clampInt(durationMin, 0, 480), Reasoning: reasoning, ExerciseType: exerciseType}, nil
}

func validateExerciseJSONContent(raw string) error {
	cleaned := strings.TrimSpace(exerciseJSONFenceRe.ReplaceAllString(raw, ""))
	if match := exerciseJSONObjRe.FindString(cleaned); match != "" {
		cleaned = match
	}
	if cleaned == "" {
		return fmt.Errorf("empty json")
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(cleaned), &payload); err != nil {
		return err
	}
	return nil
}

func extractExerciseItemsHeuristically(desc string) ([]extractedExerciseItem, string) {
	desc = strings.TrimSpace(desc)
	if desc == "" {
		return nil, ""
	}
	matches := exerciseKnownNameRe.FindAllStringIndex(desc, -1)
	if len(matches) == 0 {
		return nil, ""
	}
	type heuristicMatch struct {
		start int
		end   int
		name  string
	}
	activityMatches := make([]heuristicMatch, 0, len(matches))
	for _, match := range matches {
		name := canonicalHeuristicExerciseName(desc[match[0]:match[1]])
		if name == "" {
			continue
		}
		activityMatches = append(activityMatches, heuristicMatch{start: match[0], end: match[1], name: name})
	}
	if len(activityMatches) == 0 {
		return nil, ""
	}
	items := make([]extractedExerciseItem, 0, len(activityMatches))
	seen := map[string]struct{}{}
	for i, match := range activityMatches {
		name := match.name
		if _, ok := seen[name]; ok {
			continue
		}
		end := len(desc)
		for j := i + 1; j < len(activityMatches); j++ {
			if activityMatches[j].name != name {
				end = activityMatches[j].start
				break
			}
		}
		evidence := strings.Trim(desc[match.start:end], " \t\r\n。；;，,")
		if evidence == "" {
			evidence = name
		}
		sets, reps := parseExerciseSetReps(evidence)
		durationMin := parseExerciseDurationMinutes(evidence, name, sets)
		items = append(items, extractedExerciseItem{
			Name:        name,
			DurationMin: normalizeExerciseDuration(durationMin, sets, reps),
			Sets:        sets,
			Reps:        reps,
			Intensity:   heuristicExerciseIntensity(name),
			Evidence:    trimRunes(evidence, 120),
		})
		seen[name] = struct{}{}
	}
	if len(items) == 0 {
		return nil, ""
	}
	if len(items) > 20 {
		items = items[:20]
	}
	rawBytes, _ := json.Marshal(map[string]any{
		"mode":   "heuristic",
		"source": "local_exercise_text_parser",
		"items":  items,
	})
	return items, string(rawBytes)
}

func canonicalHeuristicExerciseName(name string) string {
	switch strings.TrimSpace(name) {
	case "杠铃深蹲", "深蹲":
		return "深蹲"
	case "卧推":
		return "卧推"
	case "龙门架高位下拉", "高位下拉":
		return "高位下拉"
	case "坐姿划船":
		return "坐姿划船"
	case "哑铃推举":
		return "哑铃推举"
	case "臂弯举", "弯举":
		return "弯举"
	case "绳索下压":
		return "绳索下压"
	case "跑步机跑步", "跑步机":
		return "跑步机"
	case "慢跑", "跑步":
		return "慢跑"
	case "垫上卷腹", "卷腹":
		return "卷腹"
	case "平板支撑":
		return "平板支撑"
	case "背部伸展":
		return "背部伸展"
	case "全身肌群拉伸", "拉伸":
		return "拉伸"
	case "跳绳":
		return "跳绳"
	case "壶铃摆动", "壶铃训练":
		return "壶铃训练"
	default:
		return strings.TrimSpace(name)
	}
}

func parseExerciseSetReps(evidence string) (int, int) {
	if match := exerciseSetRepRe.FindStringSubmatch(evidence); len(match) == 3 {
		sets, _ := strconv.Atoi(match[1])
		reps, _ := strconv.Atoi(match[2])
		return sets, reps
	}
	if match := exerciseSetSecondRe.FindStringSubmatch(evidence); len(match) == 3 {
		sets, _ := strconv.Atoi(match[1])
		return sets, 0
	}
	return 0, 0
}

func parseExerciseDurationMinutes(evidence, name string, sets int) float64 {
	if match := exerciseMinuteRe.FindStringSubmatch(evidence); len(match) == 2 {
		minutes, _ := strconv.ParseFloat(match[1], 64)
		return minutes
	}
	if match := exerciseHourRe.FindStringSubmatch(evidence); len(match) == 2 {
		hours, _ := strconv.ParseFloat(match[1], 64)
		return hours * 60
	}
	if match := exerciseSetSecondRe.FindStringSubmatch(evidence); len(match) == 3 {
		setCount, _ := strconv.Atoi(match[1])
		seconds, _ := strconv.Atoi(match[2])
		return float64(setCount*seconds) / 60.0
	}
	if match := exerciseEachSecondRe.FindStringSubmatch(evidence); len(match) == 2 {
		seconds, _ := strconv.Atoi(match[1])
		multiplier := 1
		if strings.Contains(name, "拉伸") {
			multiplier = strings.Count(evidence, "、") + 1
			if multiplier < 1 {
				multiplier = 1
			}
			if multiplier > 8 {
				multiplier = 8
			}
		}
		return float64(seconds*multiplier) / 60.0
	}
	if sets > 0 {
		return 0
	}
	return 0
}

func heuristicExerciseIntensity(name string) string {
	switch name {
	case "深蹲", "卧推", "哑铃推举", "跑步机", "跳绳", "壶铃训练":
		return "high"
	case "拉伸":
		return "low"
	default:
		return "moderate"
	}
}

func parseExtractedExerciseItems(raw string) ([]extractedExerciseItem, error) {
	cleaned := strings.TrimSpace(exerciseJSONFenceRe.ReplaceAllString(raw, ""))
	if match := exerciseJSONObjRe.FindString(cleaned); match != "" {
		cleaned = match
	}
	if cleaned == "" {
		return nil, fmt.Errorf("运动项目抽取结果为空")
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(cleaned), &payload); err != nil {
		return nil, err
	}
	rawItems, ok := payload["items"].([]any)
	if !ok {
		return nil, fmt.Errorf("missing items")
	}
	items := make([]extractedExerciseItem, 0, len(rawItems))
	for _, rawItem := range rawItems {
		row, ok := rawItem.(map[string]any)
		if !ok {
			continue
		}
		name := strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(row["name"], row["exercise_name"], row["activity_name"])))
		if name == "" || name == "<nil>" {
			continue
		}
		duration, _ := floatFromAny(firstNonNil(row["duration_min"], row["duration_minutes"], row["minutes"]))
		sets := intFromAny(row["sets"])
		reps := intFromAny(row["reps"])
		item := extractedExerciseItem{
			Name:        trimRunes(name, 40),
			DurationMin: duration,
			Sets:        sets,
			Reps:        reps,
			Intensity:   normalizeExerciseIntensityText(fmt.Sprintf("%v", row["intensity"])),
			Evidence:    trimRunes(strings.TrimSpace(fmt.Sprintf("%v", row["evidence"])), 120),
		}
		item.DurationMin = normalizeExerciseDuration(item.DurationMin, item.Sets, item.Reps)
		items = append(items, item)
	}
	if len(items) > 20 {
		return items[:20], nil
	}
	return items, nil
}

func parseExerciseMETEstimate(raw string, fallbackName string) (exerciseMETEstimate, error) {
	cleaned := strings.TrimSpace(exerciseJSONFenceRe.ReplaceAllString(raw, ""))
	if match := exerciseJSONObjRe.FindString(cleaned); match != "" {
		cleaned = match
	}
	if cleaned == "" {
		return exerciseMETEstimate{}, fmt.Errorf("运动 MET 估算结果为空")
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(cleaned), &payload); err != nil {
		return exerciseMETEstimate{}, err
	}
	met, _ := floatFromAny(firstNonNil(payload["met"], payload["met_value"], payload["MET"]))
	if met <= 0 {
		return exerciseMETEstimate{}, fmt.Errorf("missing met")
	}
	name := strings.TrimSpace(fmt.Sprintf("%v", firstNonNil(payload["activity_name"], payload["exercise_type"], payload["name"])))
	if name == "" || name == "<nil>" {
		name = fallbackName
	}
	reasoning := strings.TrimSpace(fmt.Sprintf("%v", payload["reasoning"]))
	if reasoning == "" || reasoning == "<nil>" {
		reasoning = "由大模型按常见运动 MET 粗估"
	}
	return exerciseMETEstimate{
		ActivityName: trimRunes(name, 40),
		Category:     normalizeExerciseCategoryText(fmt.Sprintf("%v", payload["category"])),
		Intensity:    normalizeExerciseIntensityText(fmt.Sprintf("%v", payload["intensity"])),
		METValue:     clampExerciseMET(met),
		Reasoning:    trimRunes(reasoning, 160),
	}, nil
}

func exerciseLogRecordedAt(log domain.ExerciseLog) any {
	if log.RecordedAt != nil {
		return log.RecordedAt.Format(time.RFC3339)
	}
	if log.CreatedAt != nil {
		return log.CreatedAt.Format(time.RFC3339)
	}
	if log.RecordedOn != nil {
		return log.RecordedOn.In(chinaTZ).Format("2006-01-02T12:00:00+08:00")
	}
	return nil
}

func splitExerciseSegments(desc string) []string {
	parts := exerciseSegmentSplitRe.Split(strings.TrimSpace(desc), -1)
	segments := []string{}
	for _, part := range parts {
		cleaned := strings.Trim(part, " \t,，.。;；")
		if len([]rune(cleaned)) >= 4 {
			segments = append(segments, cleaned)
		}
	}
	if len(segments) > 8 {
		return segments[:8]
	}
	return segments
}

func shouldEstimateBySegments(desc string, segments []string) bool {
	if len(segments) < 2 {
		return false
	}
	if strings.ContainsAny(desc, "\r\n;；。") {
		return true
	}
	if len([]rune(desc)) >= 80 {
		return true
	}
	return strings.Count(desc, "：")+strings.Count(desc, ":") >= 2
}

func compactExerciseDesc(desc string) string {
	segments := splitExerciseSegments(desc)
	if len(segments) == 0 {
		return strings.TrimSpace(desc)
	}
	out := make([]string, 0, len(segments))
	for _, segment := range segments {
		out = append(out, trimRunes(strings.ReplaceAll(segment, " ", ""), 60))
	}
	return strings.Join(out, "；")
}

func normalizeExerciseDuration(durationMin float64, sets int, reps int) float64 {
	if durationMin > 0 {
		if durationMin > 480 {
			return 480
		}
		return durationMin
	}
	if sets > 0 {
		estimated := float64(sets) * 3
		if reps >= 15 {
			estimated += float64(sets)
		}
		if estimated < 5 {
			return 5
		}
		if estimated > 120 {
			return 120
		}
		return estimated
	}
	return 10
}

func extractExplicitTotalDurationMinutes(text string) (float64, bool) {
	if match := exerciseTotalMinuteRe.FindStringSubmatch(strings.TrimSpace(text)); len(match) == 2 {
		minutes, err := strconv.ParseFloat(match[1], 64)
		if err == nil && minutes > 0 {
			return math.Min(minutes, 480), true
		}
	}
	if match := exerciseTotalHourRe.FindStringSubmatch(strings.TrimSpace(text)); len(match) == 2 {
		hours, err := strconv.ParseFloat(match[1], 64)
		if err == nil && hours > 0 {
			return math.Min(hours*60, 480), true
		}
	}
	return 0, false
}

func exerciseWeightFromProfile(snapshot map[string]any) float64 {
	if weight, ok := floatFromAny(snapshot["weight_kg"]); ok && weight > 20 && weight < 300 {
		return weight
	}
	return defaultExerciseWeightKg
}

func normalizeExerciseCategoryText(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "cardio", "有氧":
		return "cardio"
	case "strength", "力量", "力量训练":
		return "strength"
	case "ball", "球类":
		return "ball"
	case "flexibility", "拉伸", "灵活拉伸":
		return "flexibility"
	case "daily", "日常", "日常活动":
		return "daily"
	default:
		return "other"
	}
}

func normalizeExerciseIntensityText(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "low", "低", "轻松":
		return "low"
	case "high", "高", "剧烈":
		return "high"
	default:
		return "moderate"
	}
}

func clampExerciseMET(value float64) float64 {
	if value <= 0 {
		return 3.5
	}
	if value > 30 {
		return 30
	}
	return value
}

func roundExerciseFloat(value float64) float64 {
	if value >= 0 {
		return float64(int(value*10+0.5)) / 10
	}
	return float64(int(value*10-0.5)) / 10
}

func formatExerciseProfileSnapshot(snapshot map[string]any) string {
	if len(snapshot) == 0 {
		return ""
	}
	lines := []string{}
	if weight, ok := floatFromAny(snapshot["weight_kg"]); ok {
		lines = append(lines, fmt.Sprintf("- 体重：%.1f kg", weight))
	}
	if height, ok := floatFromAny(snapshot["height_cm"]); ok {
		lines = append(lines, fmt.Sprintf("- 身高：%.1f cm", height))
	}
	if gender := strings.TrimSpace(fmt.Sprintf("%v", snapshot["gender"])); gender == "male" || gender == "female" {
		label := "男"
		if gender == "female" {
			label = "女"
		}
		lines = append(lines, "- 性别："+label)
	}
	if age := intFromAny(snapshot["age_years"]); age > 0 {
		lines = append(lines, fmt.Sprintf("- 年龄：%d 岁", age))
	}
	if activity := strings.TrimSpace(fmt.Sprintf("%v", snapshot["activity_level"])); activity != "" && activity != "<nil>" {
		lines = append(lines, "- 日常活动水平："+activity)
	}
	if bmr, ok := floatFromAny(snapshot["bmr"]); ok {
		lines = append(lines, fmt.Sprintf("- BMR：%.1f kcal/天", bmr))
	}
	if tdee, ok := floatFromAny(snapshot["tdee"]); ok {
		lines = append(lines, fmt.Sprintf("- TDEE：%.1f kcal/天", tdee))
	}
	if len(lines) == 0 {
		return ""
	}
	return "已知用户真实档案：\n" + strings.Join(lines, "\n")
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func mapFromAny(value any) map[string]any {
	switch v := value.(type) {
	case map[string]any:
		return v
	default:
		return map[string]any{}
	}
}

func floatFromAny(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case int32:
		return float64(v), true
	case json.Number:
		n, err := v.Float64()
		return n, err == nil
	default:
		return 0, false
	}
}

func intFromAny(value any) int {
	if f, ok := floatFromAny(value); ok {
		return int(f)
	}
	return 0
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func trimRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func ageFromBirthday(birthday string, now time.Time) int {
	date, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(birthday), chinaTZ)
	if err != nil {
		return 0
	}
	age := now.Year() - date.Year()
	if now.YearDay() < date.YearDay() {
		age--
	}
	return age
}
