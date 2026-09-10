package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	analyzedomain "food_link/backend/internal/analyze/domain"
	analyzeservice "food_link/backend/internal/analyze/service"
	authrepo "food_link/backend/internal/auth/repo"
	commonerrors "food_link/backend/internal/common/errors"
	foodrecorddomain "food_link/backend/internal/foodrecord/domain"
	healthservice "food_link/backend/internal/health/service"
	"food_link/backend/internal/openplatform/domain"
	openrepo "food_link/backend/internal/openplatform/repo"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
	"food_link/backend/pkg/wechatpay"

	"github.com/google/uuid"
	"log/slog"
)

const (
	ScopeFoodAnalyze = "food:analyze"
	ScopeFoodSearch  = "food:search"
	ScopeRecordsRead = "records:read"
	ScopeHealthRead  = "health:read"

	OperationFoodAnalysis = "food.analysis"

	TextAnalysisUnits    int64 = 2
	StandardImageUnits   int64 = 5
	PrecisionImageUnits  int64 = 15
	MaxOpenAPIImageBytes       = 8 * 1024 * 1024
)

type AnalyzeTaskService interface {
	SubmitOpenAnalyzeTask(ctx context.Context, userID string, input analyzeservice.SubmitTaskInput) (string, error)
	SubmitOpenTextTask(ctx context.Context, userID string, input analyzeservice.SubmitTaskInput) (string, error)
	GetTask(ctx context.Context, taskID, userID string) (*analyzedomain.AnalysisTask, error)
	ListTaskSummariesPage(ctx context.Context, userID, status, search string, limit, offset int) (analyzeservice.TaskSummaryListPage, error)
}

type NutritionService interface {
	Search(ctx context.Context, query string, limit int) ([]map[string]any, error)
}

type FoodRecordReader interface {
	ListPage(ctx context.Context, userID, date string, limit, offset int) ([]foodrecorddomain.FoodRecord, bool, int, error)
}

type StatsSummaryReader interface {
	GetSummary(ctx context.Context, userID string, statsRange string, tdee int, streakDays int) (*healthservice.StatsSummary, error)
}

type Service struct {
	repo      *openrepo.Repository
	tasks     AnalyzeTaskService
	nutrition NutritionService
	storage   *storage.Client
	records   FoodRecordReader
	stats     StatsSummaryReader
	payment   NativePaymentGateway
	payConfig PaymentConfig
}

type NativePaymentGateway interface {
	CreateNativeOrder(orderNo, description string, amountCents int) (string, error)
	QueryOrder(ctx context.Context, orderNo string) (map[string]any, error)
}

type PaymentConfig struct {
	PublicKey string
	APIV3Key  string
}

type ReconciliationSummary struct {
	Scanned  int `json:"scanned"`
	Refunded int `json:"refunded"`
	Skipped  int `json:"skipped"`
}

func New(repo *openrepo.Repository, tasks AnalyzeTaskService, nutrition NutritionService, storageClient *storage.Client) *Service {
	return &Service{repo: repo, tasks: tasks, nutrition: nutrition, storage: storageClient}
}

func (s *Service) ConfigurePayment(gateway NativePaymentGateway, cfg PaymentConfig) {
	s.payment = gateway
	s.payConfig = cfg
}

func (s *Service) ConfigureUserData(records FoodRecordReader, stats StatsSummaryReader) {
	s.records = records
	s.stats = stats
}

func (s *Service) ReconcileUsage(ctx context.Context, limit int) (ReconciliationSummary, error) {
	summary := ReconciliationSummary{}
	candidates, err := s.repo.FindRefundCandidates(ctx, time.Now().Add(-10*time.Minute), limit)
	if err != nil {
		return summary, err
	}
	summary.Scanned = len(candidates)
	for _, request := range candidates {
		reason := "分析任务失败，后台自动退还 API 点数"
		if request.Status == domain.RequestStatusReserved {
			reason = "分析提交超时，后台自动退还 API 点数"
		}
		_, refunded, refundErr := s.repo.Refund(ctx, request.ID, reason)
		if refundErr != nil {
			return summary, refundErr
		}
		if refunded {
			summary.Refunded++
		} else {
			summary.Skipped++
		}
	}
	return summary, nil
}

func (s *Service) TryReconciliationLeadership(ctx context.Context, fn func(context.Context) error) (bool, error) {
	return s.repo.TryReconciliationLeadership(ctx, fn)
}

func HashAPIKey(raw string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(sum[:])
}

func (s *Service) Authenticate(ctx context.Context, rawKey string) (*domain.Principal, error) {
	rawKey = strings.TrimSpace(rawKey)
	if rawKey == "" || !strings.HasPrefix(rawKey, "flk_beta_") {
		return nil, commonerrors.ErrUnauthorized
	}
	principal, err := s.repo.Authenticate(ctx, HashAPIKey(rawKey))
	if err == nil {
		return principal, nil
	}
	if errors.Is(err, openrepo.ErrInvalidCredential) || errors.Is(err, openrepo.ErrAppInactive) {
		return nil, commonerrors.ErrUnauthorized
	}
	return nil, err
}

func RequireScope(principal *domain.Principal, scope string) error {
	if principal == nil {
		return commonerrors.ErrUnauthorized
	}
	if !principal.HasScope(scope) {
		return &commonerrors.AppError{Code: 50003, Message: "API 凭证缺少所需权限", HTTPStatus: http.StatusForbidden}
	}
	return nil
}

type AnalysisInput struct {
	Text              string   `json:"text"`
	ImageURLs         []string `json:"image_urls"`
	Mode              string   `json:"mode"`
	MealType          string   `json:"meal_type"`
	AdditionalContext string   `json:"additional_context"`
	Date              string   `json:"date"`
}

type AnalysisSubmission struct {
	TaskID         string `json:"task_id"`
	Status         string `json:"status"`
	CostUnits      int64  `json:"cost_units"`
	BalanceUnits   int64  `json:"balance_units"`
	Idempotent     bool   `json:"idempotent"`
	StatusEndpoint string `json:"status_endpoint"`
}

func (s *Service) SubmitAnalysis(ctx context.Context, principal *domain.Principal, idempotencyKey string, input AnalysisInput) (*AnalysisSubmission, error) {
	if err := RequireScope(principal, ScopeFoodAnalyze); err != nil {
		return nil, err
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" || len(idempotencyKey) > 128 {
		return nil, &commonerrors.AppError{Code: 50002, Message: "Idempotency-Key 必填且不能超过 128 个字符", HTTPStatus: http.StatusBadRequest}
	}
	input.Text = strings.TrimSpace(input.Text)
	input.ImageURLs = normalizeStrings(input.ImageURLs)
	if input.Text == "" && len(input.ImageURLs) == 0 {
		return nil, &commonerrors.AppError{Code: 50002, Message: "text 或 image_urls 至少提供一项", HTTPStatus: http.StatusBadRequest}
	}
	if input.Text != "" && len(input.ImageURLs) > 0 {
		return nil, &commonerrors.AppError{Code: 50002, Message: "封闭测试版暂不支持同时提交 text 和 image_urls", HTTPStatus: http.StatusBadRequest}
	}
	if len(input.ImageURLs) > 5 {
		return nil, &commonerrors.AppError{Code: 50002, Message: "一次最多提交 5 张图片", HTTPStatus: http.StatusBadRequest}
	}
	mode, err := normalizeMode(input.Mode)
	if err != nil {
		return nil, err
	}
	for _, imageURL := range input.ImageURLs {
		if !s.ownsImage(principal.App.ID, imageURL) {
			return nil, &commonerrors.AppError{Code: 50002, Message: "image_urls 必须来自当前应用的上传接口", HTTPStatus: http.StatusBadRequest}
		}
	}

	costUnits := analysisCost(input, mode)
	reservation, err := s.repo.Reserve(ctx, principal.App.ID, idempotencyKey, OperationFoodAnalysis, costUnits, map[string]any{
		"mode":        mode,
		"image_count": len(input.ImageURLs),
		"has_text":    input.Text != "",
	})
	if err != nil {
		switch {
		case errors.Is(err, openrepo.ErrInsufficientBalance):
			return nil, &commonerrors.AppError{Code: 50004, Message: "API 点数余额不足", HTTPStatus: http.StatusPaymentRequired}
		case errors.Is(err, openrepo.ErrIdempotencyConflict):
			return nil, &commonerrors.AppError{Code: 50009, Message: "Idempotency-Key 已用于其他操作", HTTPStatus: http.StatusConflict}
		default:
			return nil, err
		}
	}
	if reservation.Duplicate {
		if reservation.Request.Status == domain.RequestStatusSubmitted && reservation.Request.TaskID != nil {
			return submission(*reservation.Request.TaskID, reservation.Request.CostUnits, reservation.Balance, true), nil
		}
		return nil, &commonerrors.AppError{Code: 50009, Message: "该幂等请求正在处理或已经退款，请稍后查询或使用新的 Idempotency-Key", HTTPStatus: http.StatusConflict}
	}

	executionMode := mode
	taskInput := analyzeservice.SubmitTaskInput{
		ImageURLs:             input.ImageURLs,
		TextInput:             input.Text,
		Date:                  strings.TrimSpace(input.Date),
		MealType:              strings.TrimSpace(input.MealType),
		AdditionalContext:     strings.TrimSpace(input.AdditionalContext),
		ExecutionMode:         &executionMode,
		PreciseMicronutrients: true,
		ExtraPayload: map[string]any{
			"open_api":            true,
			"open_api_app_id":     principal.App.ID,
			"open_api_request_id": reservation.Request.ID,
		},
	}

	var taskID string
	if input.Text != "" {
		taskID, err = s.tasks.SubmitOpenTextTask(ctx, principal.App.ServiceUserID, taskInput)
	} else {
		taskID, err = s.tasks.SubmitOpenAnalyzeTask(ctx, principal.App.ServiceUserID, taskInput)
	}
	if err != nil {
		_, _, refundErr := s.repo.Refund(context.Background(), reservation.Request.ID, "任务提交失败")
		if refundErr != nil {
			logger.Error(ctx, "开放平台任务提交失败且退款失败", refundErr,
				slog.String("open_api.app_id", principal.App.ID),
				slog.String("open_api.request_id", reservation.Request.ID),
			)
		}
		return nil, err
	}
	if err := s.repo.MarkSubmitted(ctx, reservation.Request.ID, taskID); err != nil {
		logger.Error(ctx, "开放平台任务关联写入失败", err,
			slog.String("open_api.app_id", principal.App.ID),
			slog.String("open_api.request_id", reservation.Request.ID),
			slog.String("task_id", taskID),
		)
		return nil, err
	}
	logger.Info(ctx, "开放平台食物分析任务已提交",
		slog.String("open_api.app_id", principal.App.ID),
		slog.String("open_api.request_id", reservation.Request.ID),
		slog.String("task_id", taskID),
		slog.Int64("billing.cost_units", costUnits),
		slog.Int64("billing.balance_units", reservation.Balance),
	)
	return submission(taskID, costUnits, reservation.Balance, false), nil
}

func submission(taskID string, cost, balance int64, idempotent bool) *AnalysisSubmission {
	return &AnalysisSubmission{
		TaskID:         taskID,
		Status:         "queued",
		CostUnits:      cost,
		BalanceUnits:   balance,
		Idempotent:     idempotent,
		StatusEndpoint: "/open/v1/food-analyses/" + taskID,
	}
}

type AnalysisResult struct {
	TaskID       string         `json:"task_id"`
	Status       string         `json:"status"`
	Result       map[string]any `json:"result,omitempty"`
	ErrorMessage string         `json:"error_message,omitempty"`
	CostUnits    int64          `json:"cost_units"`
	BalanceUnits *int64         `json:"balance_units,omitempty"`
	Refunded     bool           `json:"refunded,omitempty"`
	CreatedAt    *time.Time     `json:"created_at,omitempty"`
	UpdatedAt    *time.Time     `json:"updated_at,omitempty"`
}

func (s *Service) GetAnalysis(ctx context.Context, principal *domain.Principal, taskID string) (*AnalysisResult, error) {
	if err := RequireScope(principal, ScopeFoodAnalyze); err != nil {
		return nil, err
	}
	taskID = strings.TrimSpace(taskID)
	request, err := s.repo.FindRequestByTask(ctx, principal.App.ID, taskID)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, commonerrors.ErrNotFound
	}
	task, err := s.tasks.GetTask(ctx, taskID, principal.App.ServiceUserID)
	if err != nil {
		return nil, err
	}
	result := &AnalysisResult{
		TaskID:    task.ID,
		Status:    publicTaskStatus(task),
		Result:    sanitizeResult(task.Result),
		CostUnits: request.CostUnits,
		CreatedAt: task.CreatedAt,
		UpdatedAt: task.UpdatedAt,
	}
	if task.ErrorMessage != nil {
		result.ErrorMessage = "分析任务处理失败"
	}
	if isRefundableTaskStatus(task.Status) {
		balance, refunded, refundErr := s.repo.Refund(ctx, request.ID, "分析任务未成功完成")
		if refundErr != nil {
			return nil, refundErr
		}
		result.BalanceUnits = &balance
		result.Refunded = refunded || request.Status == domain.RequestStatusRefunded
	}
	return result, nil
}

type AnalysisHistoryItem struct {
	TaskID        string                            `json:"task_id"`
	Status        string                            `json:"status"`
	InputType     string                            `json:"input_type"`
	TextPreview   string                            `json:"text_preview,omitempty"`
	ImageURL      *string                           `json:"image_url,omitempty"`
	ImageURLs     []string                          `json:"image_urls,omitempty"`
	MealType      string                            `json:"meal_type,omitempty"`
	RecordedOn    string                            `json:"recorded_on,omitempty"`
	ResultSummary *analyzeservice.TaskResultSummary `json:"result_summary,omitempty"`
	CreatedAt     *time.Time                        `json:"created_at,omitempty"`
	UpdatedAt     *time.Time                        `json:"updated_at,omitempty"`
}

type AnalysisHistoryPage struct {
	Items      []AnalysisHistoryItem `json:"items"`
	HasMore    bool                  `json:"has_more"`
	NextOffset int                   `json:"next_offset"`
}

func (s *Service) ListAnalyses(ctx context.Context, principal *domain.Principal, limit, offset int) (*AnalysisHistoryPage, error) {
	if err := RequireScope(principal, ScopeFoodAnalyze); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		return nil, &commonerrors.AppError{Code: 50002, Message: "offset 必须是非负整数", HTTPStatus: http.StatusBadRequest}
	}
	page, err := s.tasks.ListTaskSummariesPage(ctx, principal.App.ServiceUserID, "", "", limit, offset)
	if err != nil {
		return nil, err
	}
	items := make([]AnalysisHistoryItem, 0, len(page.Tasks))
	for _, task := range page.Tasks {
		inputType := "image"
		if strings.HasPrefix(task.TaskType, "food_text") || task.SourceType == "text" {
			inputType = "text"
		}
		items = append(items, AnalysisHistoryItem{
			TaskID: task.ID, Status: publicTaskSummaryStatus(task), InputType: inputType,
			TextPreview: task.TextPreview, ImageURL: task.ImageURL, ImageURLs: task.ImagePaths,
			MealType: task.MealType, RecordedOn: task.RecordedOn, ResultSummary: task.ResultSummary,
			CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt,
		})
	}
	logger.Info(ctx, "开放平台查询分析历史完成",
		slog.String("open_api.app_id", principal.App.ID),
		slog.Int("returned_count", len(items)),
		slog.Int("next_offset", page.NextOffset),
		slog.Bool("has_more", page.HasMore),
	)
	return &AnalysisHistoryPage{Items: items, HasMore: page.HasMore, NextOffset: page.NextOffset}, nil
}

type PublicFoodItem struct {
	Name               string                             `json:"name"`
	Weight             float64                            `json:"weight"`
	Ratio              float64                            `json:"ratio"`
	Intake             float64                            `json:"intake"`
	GrossWeightGrams   float64                            `json:"gross_weight_grams,omitempty"`
	EdiblePortionRatio float64                            `json:"edible_portion_ratio,omitempty"`
	SuggestedRatio     *float64                           `json:"suggested_ratio,omitempty"`
	WaterML            float64                            `json:"water_ml,omitempty"`
	Nutrients          foodrecorddomain.FoodItemNutrients `json:"nutrients"`
}

type PublicFoodRecord struct {
	ID               string           `json:"id"`
	MealType         string           `json:"meal_type"`
	ImageURLs        []string         `json:"image_urls,omitempty"`
	Description      *string          `json:"description,omitempty"`
	Insight          *string          `json:"insight,omitempty"`
	Items            []PublicFoodItem `json:"items"`
	TotalCalories    float64          `json:"total_calories"`
	TotalProtein     float64          `json:"total_protein"`
	TotalCarbs       float64          `json:"total_carbs"`
	TotalFat         float64          `json:"total_fat"`
	TotalWeightGrams int              `json:"total_weight_grams"`
	DietGoal         *string          `json:"diet_goal,omitempty"`
	ActivityTiming   *string          `json:"activity_timing,omitempty"`
	EatingMood       *string          `json:"eating_mood,omitempty"`
	PFCRatioComment  *string          `json:"pfc_ratio_comment,omitempty"`
	AbsorptionNotes  *string          `json:"absorption_notes,omitempty"`
	ContextAdvice    *string          `json:"context_advice,omitempty"`
	RecordTime       *time.Time       `json:"record_time"`
	CreatedAt        *time.Time       `json:"created_at"`
}

type PublicFoodRecordPage struct {
	Records    []PublicFoodRecord `json:"records"`
	HasMore    bool               `json:"has_more"`
	NextOffset int                `json:"next_offset"`
}

func (s *Service) ListOwnerFoodRecords(ctx context.Context, principal *domain.Principal, occupancyDate string, limit, offset int) (*PublicFoodRecordPage, error) {
	if err := RequireScope(principal, ScopeRecordsRead); err != nil {
		return nil, err
	}
	ownerUserID, err := ownerUserID(principal)
	if err != nil {
		return nil, err
	}
	if s.records == nil {
		return nil, openAPIUnavailable("饮食记录服务暂不可用")
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		return nil, &commonerrors.AppError{Code: 50002, Message: "offset 必须是非负整数", HTTPStatus: http.StatusBadRequest}
	}
	records, hasMore, nextOffset, err := s.records.ListPage(ctx, ownerUserID, strings.TrimSpace(occupancyDate), limit, offset)
	if err != nil {
		return nil, err
	}
	result := make([]PublicFoodRecord, 0, len(records))
	for _, record := range records {
		imageURLs := append([]string(nil), record.ImagePaths...)
		if len(imageURLs) == 0 && record.ImagePath != nil && strings.TrimSpace(*record.ImagePath) != "" {
			imageURLs = []string{*record.ImagePath}
		}
		items := make([]PublicFoodItem, 0, len(record.Items))
		for _, item := range record.Items {
			items = append(items, PublicFoodItem{
				Name: item.Name, Weight: item.Weight, Ratio: item.Ratio, Intake: item.Intake,
				GrossWeightGrams: item.GrossWeightGrams, EdiblePortionRatio: item.EdiblePortionRatio,
				SuggestedRatio: item.SuggestedRatio, WaterML: item.WaterMl, Nutrients: item.Nutrients,
			})
		}
		result = append(result, PublicFoodRecord{
			ID: record.ID, MealType: record.MealType, ImageURLs: imageURLs,
			Description: record.Description, Insight: record.Insight, Items: items,
			TotalCalories: record.TotalCalories, TotalProtein: record.TotalProtein,
			TotalCarbs: record.TotalCarbs, TotalFat: record.TotalFat,
			TotalWeightGrams: record.TotalWeightGrams, DietGoal: record.DietGoal,
			ActivityTiming: record.ActivityTiming, EatingMood: record.EatingMood,
			PFCRatioComment: record.PFCRatioComment, AbsorptionNotes: record.AbsorptionNotes,
			ContextAdvice: record.ContextAdvice, RecordTime: record.RecordTime, CreatedAt: record.CreatedAt,
		})
	}
	logger.Info(ctx, "开放平台查询本人饮食记录完成",
		slog.String("open_api.app_id", principal.App.ID),
		slog.String("user_id", ownerUserID),
		slog.Int("returned_count", len(result)),
	)
	return &PublicFoodRecordPage{Records: result, HasMore: hasMore, NextOffset: nextOffset}, nil
}

func (s *Service) GetOwnerHealthSummary(ctx context.Context, principal *domain.Principal, statsRange string) (*healthservice.StatsSummary, error) {
	if err := RequireScope(principal, ScopeHealthRead); err != nil {
		return nil, err
	}
	ownerUserID, err := ownerUserID(principal)
	if err != nil {
		return nil, err
	}
	if s.stats == nil {
		return nil, openAPIUnavailable("健康统计服务暂不可用")
	}
	statsRange = normalizeStatsRange(statsRange)
	summary, err := s.stats.GetSummary(ctx, ownerUserID, statsRange, 2000, 0)
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "开放平台查询本人健康摘要完成",
		slog.String("open_api.app_id", principal.App.ID),
		slog.String("user_id", ownerUserID),
		slog.String("stats.range", statsRange),
	)
	return summary, nil
}

func (s *Service) SearchNutrition(ctx context.Context, principal *domain.Principal, query string, limit int) ([]map[string]any, error) {
	if err := RequireScope(principal, ScopeFoodSearch); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 5
	}
	if limit > 20 {
		limit = 20
	}
	return s.nutrition.Search(ctx, query, limit)
}

type UploadResult struct {
	ImageURL string `json:"image_url"`
	Bytes    int    `json:"bytes"`
	MimeType string `json:"mime_type"`
}

func (s *Service) UploadImage(ctx context.Context, principal *domain.Principal, fileBytes []byte, originalName string) (*UploadResult, error) {
	if err := RequireScope(principal, ScopeFoodAnalyze); err != nil {
		return nil, err
	}
	if len(fileBytes) == 0 || len(fileBytes) > MaxOpenAPIImageBytes {
		return nil, &commonerrors.AppError{Code: 50002, Message: "图片不能为空且不能超过 8MB", HTTPStatus: http.StatusBadRequest}
	}
	detected := http.DetectContentType(fileBytes)
	ext := extensionForImage(detected, originalName)
	if ext == "" {
		return nil, &commonerrors.AppError{Code: 50002, Message: "仅支持 JPEG、PNG 或 WebP 图片", HTTPStatus: http.StatusBadRequest}
	}
	key := "open-api/" + principal.App.ID + "/" + uuid.NewString() + ext
	imageURL, err := s.storage.UploadBytes("food-images", key, fileBytes, detected)
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "开放平台图片上传完成",
		slog.String("open_api.app_id", principal.App.ID),
		slog.Int("file.size", len(fileBytes)),
		slog.String("file.content_type", detected),
	)
	return &UploadResult{ImageURL: imageURL, Bytes: len(fileBytes), MimeType: detected}, nil
}

type KeyMaterial struct {
	App    domain.App    `json:"app"`
	APIKey domain.APIKey `json:"api_key"`
	Secret string        `json:"secret"`
}

func (s *Service) CreateBetaApp(ctx context.Context, name string, initialUnits int64, scopes []string) (*KeyMaterial, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("app name is required")
	}
	if initialUnits < 0 {
		return nil, fmt.Errorf("initial units cannot be negative")
	}
	if len(scopes) == 0 {
		scopes = []string{ScopeFoodAnalyze, ScopeFoodSearch}
	}
	secret, prefix, hash, err := generateAPIKey()
	if err != nil {
		return nil, err
	}
	app := domain.App{ID: uuid.NewString(), Name: name}
	key := domain.APIKey{Name: "default", KeyPrefix: prefix, SecretHash: hash, Scopes: normalizeStrings(scopes)}
	user := authrepo.User{
		ID:              uuid.NewString(),
		OpenID:          "open-api:" + app.ID,
		Nickname:        "API应用-" + name + "-" + app.ID[:8],
		HealthCondition: map[string]any{},
	}
	if err := s.repo.CreateAppAndKey(ctx, &app, &key, &user, initialUnits); err != nil {
		return nil, err
	}
	return &KeyMaterial{App: app, APIKey: key, Secret: secret}, nil
}

func (s *Service) TopUp(ctx context.Context, appID string, units int64, referenceKey, description string) (int64, bool, error) {
	if strings.TrimSpace(referenceKey) == "" {
		return 0, false, fmt.Errorf("reference key is required")
	}
	if strings.TrimSpace(description) == "" {
		description = "人工充值 API 点数"
	}
	return s.repo.TopUp(ctx, appID, units, strings.TrimSpace(referenceKey), description, map[string]any{"source": "openapi-admin"})
}

type DeveloperApp struct {
	domain.App
	Keys []domain.APIKey `json:"keys,omitempty"`
}

func (s *Service) ListDeveloperApps(ctx context.Context, ownerUserID string) ([]DeveloperApp, error) {
	apps, err := s.repo.ListAppsByOwner(ctx, strings.TrimSpace(ownerUserID))
	if err != nil {
		return nil, err
	}
	result := make([]DeveloperApp, 0, len(apps))
	for _, app := range apps {
		keys, err := s.repo.ListKeys(ctx, app.ID)
		if err != nil {
			return nil, err
		}
		for index := range keys {
			keys[index].SecretHash = ""
		}
		result = append(result, DeveloperApp{App: app, Keys: keys})
	}
	return result, nil
}

func (s *Service) CreateDeveloperApp(ctx context.Context, ownerUserID, name string) (*KeyMaterial, error) {
	ownerUserID = strings.TrimSpace(ownerUserID)
	name = strings.TrimSpace(name)
	if ownerUserID == "" {
		return nil, commonerrors.ErrUnauthorized
	}
	if len([]rune(name)) < 2 || len([]rune(name)) > 40 {
		return nil, &commonerrors.AppError{Code: 50002, Message: "应用名称需为 2 到 40 个字符", HTTPStatus: http.StatusBadRequest}
	}
	existing, err := s.repo.ListAppsByOwner(ctx, ownerUserID)
	if err != nil {
		return nil, err
	}
	if len(existing) >= 5 {
		return nil, &commonerrors.AppError{Code: 50008, Message: "每个开发者最多创建 5 个应用", HTTPStatus: http.StatusConflict}
	}
	secret, prefix, hash, err := generateAPIKey()
	if err != nil {
		return nil, err
	}
	appID := uuid.NewString()
	owner := ownerUserID
	app := domain.App{ID: appID, OwnerUserID: &owner, Name: name}
	key := domain.APIKey{Name: "默认密钥", KeyPrefix: prefix, SecretHash: hash, Scopes: []string{ScopeFoodAnalyze, ScopeFoodSearch}}
	user := authrepo.User{ID: uuid.NewString(), OpenID: "open-api:" + appID, Nickname: "API应用-" + name + "-" + appID[:8], HealthCondition: map[string]any{}}
	if err := s.repo.CreateAppAndKey(ctx, &app, &key, &user, 100); err != nil {
		return nil, err
	}
	logger.Info(ctx, "开发者创建开放平台应用", slog.String("user_id", ownerUserID), slog.String("open_api.app_id", app.ID))
	return &KeyMaterial{App: app, APIKey: key, Secret: secret}, nil
}

func (s *Service) CreateDeveloperKey(ctx context.Context, ownerUserID, appID, name string, scopes []string) (*KeyMaterial, error) {
	app, err := s.requireOwnedApp(ctx, ownerUserID, appID)
	if err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > 40 {
		return nil, &commonerrors.AppError{Code: 50002, Message: "密钥名称必填且不能超过 40 个字符", HTTPStatus: http.StatusBadRequest}
	}
	keys, err := s.repo.ListKeys(ctx, app.ID)
	if err != nil {
		return nil, err
	}
	activeCount := 0
	for _, key := range keys {
		if key.Status == domain.KeyStatusActive {
			activeCount++
		}
	}
	if activeCount >= 5 {
		return nil, &commonerrors.AppError{Code: 50008, Message: "每个应用最多保留 5 个有效密钥", HTTPStatus: http.StatusConflict}
	}
	scopes = allowedScopes(scopes)
	if len(scopes) == 0 {
		scopes = []string{ScopeFoodAnalyze, ScopeFoodSearch}
	}
	secret, prefix, hash, err := generateAPIKey()
	if err != nil {
		return nil, err
	}
	key := domain.APIKey{AppID: app.ID, Name: name, KeyPrefix: prefix, SecretHash: hash, Scopes: scopes}
	if err := s.repo.CreateKey(ctx, &key); err != nil {
		return nil, err
	}
	logger.Info(ctx, "开发者创建开放平台密钥", slog.String("user_id", ownerUserID), slog.String("open_api.app_id", app.ID), slog.String("open_api.key_id", key.ID))
	return &KeyMaterial{App: *app, APIKey: key, Secret: secret}, nil
}

func (s *Service) RevokeDeveloperKey(ctx context.Context, ownerUserID, appID, keyID string) error {
	if _, err := s.requireOwnedApp(ctx, ownerUserID, appID); err != nil {
		return err
	}
	revoked, err := s.repo.RevokeKey(ctx, appID, strings.TrimSpace(keyID))
	if err != nil {
		return err
	}
	if !revoked {
		return commonerrors.ErrNotFound
	}
	logger.Info(ctx, "开发者吊销开放平台密钥", slog.String("user_id", ownerUserID), slog.String("open_api.app_id", appID), slog.String("open_api.key_id", keyID))
	return nil
}

func (s *Service) ListDeveloperLedger(ctx context.Context, ownerUserID, appID string, limit int) ([]domain.UsageLedger, error) {
	app, err := s.requireOwnedApp(ctx, ownerUserID, appID)
	if err != nil {
		return nil, err
	}
	return s.repo.ListLedger(ctx, app.ID, limit)
}

func (s *Service) ListCreditPackages(ctx context.Context) ([]domain.CreditPackage, error) {
	return s.repo.ListActivePackages(ctx)
}

type PaymentOrderResult struct {
	domain.PaymentOrder
	QRCodeValue string `json:"qr_code_value,omitempty"`
}

func (s *Service) CreatePaymentOrder(ctx context.Context, ownerUserID, appID, packageCode string) (*PaymentOrderResult, error) {
	app, err := s.requireOwnedApp(ctx, ownerUserID, appID)
	if err != nil {
		return nil, err
	}
	creditPackage, err := s.repo.GetActivePackage(ctx, strings.TrimSpace(packageCode))
	if err != nil {
		return nil, err
	}
	if creditPackage == nil {
		return nil, commonerrors.ErrNotFound
	}
	if s.payment == nil {
		return nil, &commonerrors.AppError{Code: 50010, Message: "微信支付尚未配置，请联系食探开通测试点数", HTTPStatus: http.StatusServiceUnavailable}
	}
	now := time.Now()
	expiresAt := now.Add(15 * time.Minute)
	order := domain.PaymentOrder{
		ID: uuid.NewString(), OrderNo: newPaymentOrderNo(), OwnerUserID: strings.TrimSpace(ownerUserID), AppID: app.ID,
		PackageCode: creditPackage.Code, Units: creditPackage.Units, AmountFen: creditPackage.AmountFen,
		Status: domain.PaymentOrderPending, PayChannel: "wechat_native", ExpiresAt: &expiresAt,
	}
	if err := s.repo.CreatePaymentOrder(ctx, &order); err != nil {
		return nil, err
	}
	codeURL, err := s.payment.CreateNativeOrder(order.OrderNo, "食探 API 点数-"+creditPackage.Name, order.AmountFen)
	if err != nil {
		_ = s.repo.MarkPaymentFailed(ctx, order.OrderNo, err.Error())
		return nil, fmt.Errorf("创建微信支付二维码失败: %w", err)
	}
	if err := s.repo.UpdatePaymentCodeURL(ctx, order.OrderNo, codeURL); err != nil {
		return nil, err
	}
	order.CodeURL = &codeURL
	logger.Info(ctx, "开发者创建 API 点数支付订单", slog.String("user_id", ownerUserID), slog.String("open_api.app_id", app.ID), slog.String("payment.order_no", order.OrderNo), slog.Int("payment.amount_fen", order.AmountFen))
	return &PaymentOrderResult{PaymentOrder: order, QRCodeValue: codeURL}, nil
}

func (s *Service) GetPaymentOrder(ctx context.Context, ownerUserID, orderNo string) (*domain.PaymentOrder, error) {
	order, err := s.repo.GetOwnedPaymentOrder(ctx, strings.TrimSpace(ownerUserID), strings.TrimSpace(orderNo))
	if err != nil {
		return nil, err
	}
	if order == nil {
		return nil, commonerrors.ErrNotFound
	}
	return order, nil
}

func (s *Service) SyncPaymentOrder(ctx context.Context, ownerUserID, orderNo string) (*domain.PaymentOrder, error) {
	order, err := s.GetPaymentOrder(ctx, ownerUserID, orderNo)
	if err != nil || order.Status == domain.PaymentOrderPaid {
		return order, err
	}
	if order.Status != domain.PaymentOrderPending || s.payment == nil {
		return order, nil
	}
	state, err := s.payment.QueryOrder(ctx, order.OrderNo)
	if err != nil {
		return nil, fmt.Errorf("主动查询微信支付订单失败: %w", err)
	}
	tradeState := strings.ToUpper(strings.TrimSpace(fmt.Sprint(state["trade_state"])))
	if tradeState != "SUCCESS" {
		return order, nil
	}
	if paymentTotalFen(state) != order.AmountFen {
		return nil, &commonerrors.AppError{Code: 50002, Message: "微信支付金额与 API 点数订单不一致", HTTPStatus: http.StatusBadRequest}
	}
	transactionID := strings.TrimSpace(fmt.Sprint(state["transaction_id"]))
	if transactionID == "" {
		return nil, &commonerrors.AppError{Code: 50002, Message: "微信支付查单结果缺少 transaction_id", HTTPStatus: http.StatusBadRequest}
	}
	paidAt := time.Now()
	if parsed, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(fmt.Sprint(state["success_time"]))); parseErr == nil {
		paidAt = parsed
	}
	updated, credited, err := s.repo.MarkPaymentPaidAndTopUp(ctx, order.OrderNo, transactionID, paidAt, map[string]any{"source": "active_query", "state": state})
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "主动查询微信支付并同步 API 点数", slog.String("user_id", ownerUserID), slog.String("open_api.app_id", order.AppID), slog.String("payment.order_no", order.OrderNo), slog.Bool("billing.credited", credited))
	return updated, nil
}

func (s *Service) HandleWechatPaymentNotify(ctx context.Context, headers http.Header, body []byte) (map[string]any, error) {
	if strings.TrimSpace(s.payConfig.PublicKey) == "" || strings.TrimSpace(s.payConfig.APIV3Key) == "" {
		return nil, &commonerrors.AppError{Code: 50010, Message: "微信支付回调配置不完整", HTTPStatus: http.StatusInternalServerError}
	}
	signature := headers.Get("Wechatpay-Signature")
	timestamp := headers.Get("Wechatpay-Timestamp")
	nonce := headers.Get("Wechatpay-Nonce")
	if signature == "" || timestamp == "" || nonce == "" {
		return nil, &commonerrors.AppError{Code: 50002, Message: "微信支付回调缺少签名头", HTTPStatus: http.StatusBadRequest}
	}
	if err := wechatpay.VerifyRSA256(timestamp+"\n"+nonce+"\n"+string(body)+"\n", signature, s.payConfig.PublicKey); err != nil {
		return nil, &commonerrors.AppError{Code: 50003, Message: "微信支付回调验签失败", HTTPStatus: http.StatusUnauthorized}
	}
	var notify map[string]any
	if err := json.Unmarshal(body, &notify); err != nil {
		return nil, &commonerrors.AppError{Code: 50002, Message: "微信支付回调报文无效", HTTPStatus: http.StatusBadRequest}
	}
	resource, _ := notify["resource"].(map[string]any)
	decrypted, err := wechatpay.DecryptResource(resource, s.payConfig.APIV3Key)
	if err != nil {
		return nil, err
	}
	orderNo := strings.TrimSpace(fmt.Sprint(decrypted["out_trade_no"]))
	order, err := s.repo.GetPaymentOrderByOrderNo(ctx, orderNo)
	if err != nil {
		return nil, err
	}
	if order == nil {
		return nil, commonerrors.ErrNotFound
	}
	if order.Status == domain.PaymentOrderPaid {
		return map[string]any{"code": "SUCCESS", "message": "成功"}, nil
	}
	if strings.ToUpper(strings.TrimSpace(fmt.Sprint(decrypted["trade_state"]))) != "SUCCESS" {
		return map[string]any{"code": "SUCCESS", "message": "已接收"}, nil
	}
	if paymentTotalFen(decrypted) != order.AmountFen {
		return nil, &commonerrors.AppError{Code: 50002, Message: "微信支付金额与 API 点数订单不一致", HTTPStatus: http.StatusBadRequest}
	}
	transactionID := strings.TrimSpace(fmt.Sprint(decrypted["transaction_id"]))
	if transactionID == "" {
		return nil, &commonerrors.AppError{Code: 50002, Message: "微信支付回调缺少 transaction_id", HTTPStatus: http.StatusBadRequest}
	}
	paidAt := time.Now()
	if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(fmt.Sprint(decrypted["success_time"]))); err == nil {
		paidAt = parsed
	}
	_, credited, err := s.repo.MarkPaymentPaidAndTopUp(ctx, order.OrderNo, transactionID, paidAt, map[string]any{"notify": notify, "decrypted": decrypted})
	if err != nil {
		return nil, err
	}
	logger.Info(ctx, "微信支付 API 点数到账", slog.String("user_id", order.OwnerUserID), slog.String("open_api.app_id", order.AppID), slog.String("payment.order_no", order.OrderNo), slog.Bool("billing.credited", credited))
	return map[string]any{"code": "SUCCESS", "message": "成功"}, nil
}

func (s *Service) requireOwnedApp(ctx context.Context, ownerUserID, appID string) (*domain.App, error) {
	app, err := s.repo.GetOwnedApp(ctx, strings.TrimSpace(ownerUserID), strings.TrimSpace(appID))
	if err != nil {
		return nil, err
	}
	if app == nil {
		return nil, commonerrors.ErrNotFound
	}
	return app, nil
}

func allowedScopes(values []string) []string {
	allowed := map[string]bool{
		ScopeFoodAnalyze: true,
		ScopeFoodSearch:  true,
		ScopeRecordsRead: true,
		ScopeHealthRead:  true,
	}
	result := make([]string, 0, len(values))
	for _, value := range normalizeStrings(values) {
		if allowed[value] {
			result = append(result, value)
		}
	}
	return result
}

func newPaymentOrderNo() string {
	return "OA" + time.Now().Format("20060102150405") + strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
}

func paymentTotalFen(payload map[string]any) int {
	amount, _ := payload["amount"].(map[string]any)
	switch value := amount["total"].(type) {
	case float64:
		return int(value)
	case int:
		return value
	case json.Number:
		parsed, _ := value.Int64()
		return int(parsed)
	default:
		parsed, _ := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
		return parsed
	}
}

func generateAPIKey() (secret, prefix, hash string, err error) {
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return "", "", "", err
	}
	secret = "flk_beta_" + base64.RawURLEncoding.EncodeToString(raw)
	prefix = secret
	if len(prefix) > 20 {
		prefix = prefix[:20]
	}
	hash = HashAPIKey(secret)
	return secret, prefix, hash, nil
}

func normalizeMode(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "standard":
		return "standard", nil
	case "precision":
		return "strict", nil
	default:
		return "", &commonerrors.AppError{Code: 50002, Message: "mode 仅支持 standard 或 precision", HTTPStatus: http.StatusBadRequest}
	}
}

func analysisCost(input AnalysisInput, mode string) int64 {
	if input.Text != "" {
		return TextAnalysisUnits
	}
	count := int64(len(input.ImageURLs))
	if mode == "strict" {
		return PrecisionImageUnits * count
	}
	return StandardImageUnits * count
}

func normalizeStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func (s *Service) ownsImage(appID, imageURL string) bool {
	if s.storage == nil {
		return false
	}
	key := s.storage.ResolveObjectKey("food-images", imageURL)
	return strings.HasPrefix(strings.TrimLeft(key, "/"), "open-api/"+appID+"/")
}

func extensionForImage(contentType, originalName string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	}
	if strings.EqualFold(filepath.Ext(originalName), ".webp") && contentType == "application/octet-stream" {
		return ".webp"
	}
	return ""
}

func publicTaskStatus(task *analyzedomain.AnalysisTask) string {
	if task == nil {
		return "failed"
	}
	switch task.Status {
	case "pending":
		return "queued"
	case "processing":
		return "processing"
	case "done":
		if task.Result != nil {
			precisionStatus := stringValue(task.Result["precisionStatus"])
			if boolValue(task.Result["userActionRequired"]) || precisionStatus == "needs_user_input" || precisionStatus == "needs_retake" {
				return "requires_action"
			}
		}
		return "completed"
	default:
		return "failed"
	}
}

func publicTaskSummaryStatus(task analyzeservice.TaskSummary) string {
	switch task.Status {
	case "pending":
		return "queued"
	case "processing":
		return "processing"
	case "done":
		if task.UserActionRequired || task.PrecisionStatus == "needs_user_input" || task.PrecisionStatus == "needs_retake" {
			return "requires_action"
		}
		return "completed"
	default:
		return "failed"
	}
}

func ownerUserID(principal *domain.Principal) (string, error) {
	if principal == nil {
		return "", commonerrors.ErrUnauthorized
	}
	if principal.App.OwnerUserID == nil || strings.TrimSpace(*principal.App.OwnerUserID) == "" {
		return "", &commonerrors.AppError{
			Code: 50003, Message: "该应用未绑定开发者本人，不能读取个人健康数据", HTTPStatus: http.StatusForbidden,
		}
	}
	return strings.TrimSpace(*principal.App.OwnerUserID), nil
}

func normalizeStatsRange(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "7d", "30d", "90d", "week", "month":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "week"
	}
}

func openAPIUnavailable(message string) error {
	return &commonerrors.AppError{Code: 50010, Message: message, HTTPStatus: http.StatusServiceUnavailable}
}

func sanitizeResult(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	sanitized, _ := sanitizeResultValue(input).(map[string]any)
	return sanitized
}

func sanitizeResultValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			if shouldRedactResultKey(key) {
				continue
			}
			result[key] = sanitizeResultValue(item)
		}
		return result
	case []any:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, sanitizeResultValue(item))
		}
		return result
	case []map[string]any:
		result := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			sanitized, _ := sanitizeResultValue(item).(map[string]any)
			result = append(result, sanitized)
		}
		return result
	default:
		return value
	}
}

func shouldRedactResultKey(key string) bool {
	canonical := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			return r
		}
		if r >= 'A' && r <= 'Z' {
			return r + ('a' - 'A')
		}
		return -1
	}, strings.TrimSpace(key))
	if canonical == "debug" || canonical == "rawresponse" || canonical == "edibleportionsource" || canonical == "micronutrientsource" {
		return true
	}
	for _, fragment := range []string{"model", "provider", "prompt", "reasoning", "analysisengine", "llm"} {
		if strings.Contains(canonical, fragment) {
			return true
		}
	}
	return false
}

func isRefundableTaskStatus(status string) bool {
	switch status {
	case "failed", "cancelled", "timed_out", "violated":
		return true
	default:
		return false
	}
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true")
	default:
		return false
	}
}
