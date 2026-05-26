package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"food_link/backend/internal/common/dateutil"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	membershipdomain "food_link/backend/internal/membership/domain"
	"food_link/backend/internal/taskqueue"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/metrics"
	"food_link/backend/pkg/storage"

	"github.com/google/uuid"
)

const creditCostExerciseLog = 1

type ExerciseRepo interface {
	CreateExerciseLog(ctx context.Context, log *domain.ExerciseLog) error
	ListExerciseLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.ExerciseLog, error)
	GetExerciseLogByID(ctx context.Context, userID, logID string) (*domain.ExerciseLog, error)
	DeleteExerciseLog(ctx context.Context, userID, logID string) (int64, error)
	GetDailyCaloriesBurned(ctx context.Context, userID string, recordedOn string) (int64, error)
	GetUserProfile(ctx context.Context, userID string) (*domain.ExerciseUserProfile, error)
	GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error)
	CreateAnalysisTask(ctx context.Context, task *domain.AnalysisTask) error
	FailAnalysisTask(ctx context.Context, taskID, errorMsg string) error
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
			"recorded_on":     nil,
			"recorded_at":     nil,
			"created_at":      nil,
			"ai_reasoning":    nil,
		}
		if log.AIReasoning != nil {
			item["ai_reasoning"] = *log.AIReasoning
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
	desc := strings.TrimSpace(exerciseDesc)
	imageURL = s.resolveFoodImageURL(imageURL)
	if desc == "" && imageURL == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述和图片不能同时为空", HTTPStatus: 400}
	}
	if len(desc) > 200 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "运动描述过长", HTTPStatus: 400}
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
	estimate, err := s.estimateExerciseCalories(ctx, desc, imageURL, profileSnapshot)
	if err != nil {
		status = "estimate_error"
		return nil, err
	}
	now := time.Now().UTC()
	recordedDate, err := parseChinaDate(recordedOn)
	if err != nil {
		recordedDate = time.Now().In(chinaTZ)
	}
	calories := float64(estimate.CaloriesKcal)
	reasoning := estimate.Reasoning
	logDesc := resolveExerciseLogDesc(desc, estimate)
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
		RecordedOn:     &recordedDate,
		RecordedAt:     &now,
		AIReasoning:    &reasoning,
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
	}, nil
}

func (s *ExerciseService) activateInviteReward(ctx context.Context, userID, action string) {
	if s.rewards == nil || strings.TrimSpace(userID) == "" {
		return
	}
	if _, err := s.rewards.ActivatePendingInviteReferralOnFirstValidUse(ctx, userID, action); err != nil {
		fmt.Printf("[exercise_log] invite reward activation failed user=%s action=%s error=%v\n", userID, action, err)
	}
}

type ExerciseEstimate struct {
	CaloriesKcal int
	Raw          string
	Reasoning    string
	Source       string
	ExerciseType string
}

var (
	exerciseSegmentSplitRe = regexp.MustCompile(`[\r\n;；。]+`)
	exerciseJSONFenceRe    = regexp.MustCompile("(?s)```json?\\s*\\n?|```")
	exerciseJSONObjRe      = regexp.MustCompile(`(?s)\{.*\}`)
)

func resolveExerciseLogDesc(inputDesc string, estimate ExerciseEstimate) string {
	desc := strings.TrimSpace(inputDesc)
	exerciseType := strings.TrimSpace(estimate.ExerciseType)
	if isWeakExerciseTitle(desc) && exerciseType != "" {
		return trimRunes(exerciseType, 20)
	}
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
	if imageURL != "" {
		return s.estimateSingleExerciseCalories(ctx, desc, imageURL, profileSnapshot)
	}
	segments := splitExerciseSegments(desc)
	if shouldEstimateBySegments(desc, segments) {
		total := 0
		rows := make([]map[string]any, 0, len(segments))
		for _, segment := range segments {
			estimate, err := s.estimateSingleExerciseCalories(ctx, segment, "", profileSnapshot)
			if err != nil {
				return ExerciseEstimate{}, err
			}
			total += estimate.CaloriesKcal
			rows = append(rows, map[string]any{
				"segment":       segment,
				"calories_kcal": estimate.CaloriesKcal,
				"reasoning":     estimate.Reasoning,
				"source":        estimate.Source,
			})
		}
		reasoningParts := []string{}
		for _, row := range rows {
			reasoningParts = append(reasoningParts, fmt.Sprintf("%s≈%dkcal", trimRunes(fmt.Sprintf("%v", row["segment"]), 16), row["calories_kcal"]))
		}
		reasoning := "分项估算：" + strings.Join(reasoningParts, "；")
		if len([]rune(reasoning)) > 200 {
			reasoning = trimRunes(reasoning, 200) + "..."
		}
		rawBytes, _ := json.Marshal(map[string]any{"segments": rows, "calories_kcal": total, "reasoning": reasoning})
		return ExerciseEstimate{CaloriesKcal: total, Raw: string(rawBytes), Reasoning: reasoning, Source: "segmented"}, nil
	}
	return s.estimateSingleExerciseCalories(ctx, desc, "", profileSnapshot)
}

func (s *ExerciseService) estimateSingleExerciseCalories(ctx context.Context, desc, imageURL string, profileSnapshot map[string]any) (ExerciseEstimate, error) {
	estimate, err := s.estimateExerciseCaloriesWithLLM(ctx, desc, imageURL, profileSnapshot)
	if err == nil {
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
	model := "doubao-seed-2-0-lite-260428"
	if s.cfg != nil {
		apiKey = strings.TrimSpace(s.cfg.External.DoubaoAPIKey)
		if configuredBaseURL := strings.TrimSpace(s.cfg.External.DoubaoBaseURL); configuredBaseURL != "" {
			baseURL = strings.TrimRight(configuredBaseURL, "/")
		}
	}
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
	userPrompt := "用户运动描述：" + compactExerciseDesc(desc)
	if desc == "" {
		userPrompt = "用户上传了一张运动图片，请识别主要运动类型、估算持续时长和消耗热量。"
	}
	if profileText := formatExerciseProfileSnapshot(profileSnapshot); profileText != "" {
		userPrompt += "\n\n" + profileText + "\n\n请结合这些真实信息估算；只有缺失字段才允许合理假设。"
	}
	userContent := any(userPrompt)
	systemPrompt := "你是运动热量估算助手。只输出 JSON 对象，不要 markdown。格式为 {\"exercise_type\":\"运动类型\",\"reasoning\":\"一句简短中文\",\"calories_kcal\":123}。exercise_type 为识别出的运动类型名称（如跑步、游泳等），不超过 20 字；reasoning 不超过 80 个汉字。"
	if imageURL != "" {
		systemPrompt = "你是运动热量估算助手。可根据图片识别运动类型、强度和可能时长，并结合文字描述估算热量。若图片是训练打卡截图或健身记录卡，必须先 OCR 读取每个动作、重量、次数、组数、总耗时、截图中的消耗热量，再综合估算；多项动作不要只按一个普通运动粗估。只输出 JSON 对象，不要 markdown。格式为 {\"exercise_type\":\"运动类型标题\",\"reasoning\":\"一句简短中文\",\"calories_kcal\":123}。exercise_type 应概括图片里的主要训练内容，例如 卧推力量训练、背部力量训练、跑步机慢跑，不要输出 一般运动；不超过 20 字。reasoning 不超过 80 个汉字。"
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
		metrics.ObserveLLMCall("exercise", "doubao", model, status, time.Since(start))
		return ExerciseEstimate{}, fmt.Errorf("运动分析服务请求失败: %w", err)
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		status = fmt.Sprintf("http_%d", resp.StatusCode)
		metrics.ObserveLLMCall("exercise", "doubao", model, status, time.Since(start))
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
		return ExerciseEstimate{}, fmt.Errorf("运动分析结果格式解析失败: %w", err)
	}
	estimate.Raw = raw
	estimate.Source = "llm"
	metrics.ObserveLLMCall("exercise", "doubao", model, "success", time.Since(start))
	return estimate, nil
}

func (s *ExerciseService) resolveFoodImageURL(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
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
	return ExerciseEstimate{CaloriesKcal: clampInt(calories, 1, 5000), Reasoning: reasoning, ExerciseType: exerciseType}, nil
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
