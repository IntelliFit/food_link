package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"reflect"
	"regexp"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"time"

	"food_link/backend/internal/billing"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	"food_link/backend/internal/nutritionagg"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"

	"log/slog"

	"gorm.io/gorm"
)

type StatsRepo interface {
	GetFoodRecordsForDateRange(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]domain.FoodRecord, error)
	GetUserProfile(ctx context.Context, userID string) (*domain.StatsUserProfile, error)
	GetRecentFoodRecordDates(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]string, error)
	UpsertInsightCache(ctx context.Context, userID, rangeType, generatedDate, dataFingerprint, insightText string) error
	GetCachedInsight(ctx context.Context, userID string, rangeType string, generatedDate string) (*domain.StatsInsight, error)
	GetLatestCachedInsight(ctx context.Context, userID string, rangeType string) (*domain.StatsInsight, error)
	CountInsightGenerationsToday(ctx context.Context, userID string) (int64, error)
	UpsertCustomFocusCard(ctx context.Context, card domain.CustomFocusCard) error
	GetCustomFocusCards(ctx context.Context, userID, rangeType string) ([]domain.CustomFocusCard, error)
	GetCustomFocusCard(ctx context.Context, userID, rangeType, focusID string) (*domain.CustomFocusCard, error)
	CountCustomFocusGenerationsToday(ctx context.Context, userID string) (int64, error)
	CountCustomFocusGenerationsTodayForFocus(ctx context.Context, userID, focusID string) (int64, error)
	GetDietRecommendationCandidates(ctx context.Context, userID string, scene string, limit int) ([]domain.DietRecommendationCandidate, error)
	CreatePetChatSession(ctx context.Context, session domain.PetChatSession) (*domain.PetChatSession, error)
	GetPetChatSession(ctx context.Context, userID, sessionID string) (*domain.PetChatSession, error)
	GetPetChatSessionMessages(ctx context.Context, userID, sessionID string, limit int) ([]domain.PetChatMessage, error)
	ListPetChatSessions(ctx context.Context, userID string, limit int) ([]domain.PetChatSession, error)
	GetLatestPetChatSessionWithMessages(ctx context.Context, userID string, limit int) (*domain.PetChatSession, []domain.PetChatMessage, error)
	AddPetChatMessage(ctx context.Context, message domain.PetChatMessage) (*domain.PetChatMessage, error)
	TouchPetChatSession(ctx context.Context, sessionID, userID, question, answer string, creditsCharged int) error
}

type BodyMetricsSummaryProvider interface {
	GetSummary(ctx context.Context, userID string, statsRange string) (*BodyMetricsSummary, error)
}

type StatsService struct {
	repo            StatsRepo
	bodyMetrics     BodyMetricsSummaryProvider
	creditGuard     CreditGuard
	cfg             *config.Config
	client          *http.Client
	deepSeekBaseURL string
}

const (
	statsInsightDeepSeekModel = "deepseek-v4-pro"
	statsInsightDailyLimit    = 3
	statsInsightCreditCost    = 1
	statsInsightMaxTokens     = 4096
	statsInsightMinRecordDays = 1
	statsInsightMaxAttempts   = 2
)

var statsInsightForbiddenIdentityTerms = []string{
	"专业营养师",
	"专业的营养师",
	"注册营养师",
	"持证营养师",
	"饮食行为研究员",
}

type statsMicronutrientReference struct {
	Key            string
	Label          string
	Unit           string
	Aliases        []string
	DailyReference float64
	ReferenceLabel string
}

var statsInsightMicronutrientReferences = []statsMicronutrientReference{
	{Key: "fiber", Label: "膳食纤维", Unit: "g", Aliases: []string{"fiber"}, DailyReference: 25, ReferenceLabel: "25g"},
	{Key: "sodiumMg", Label: "钠", Unit: "mg", Aliases: []string{"sodiumMg", "sodium_mg"}, DailyReference: 2000, ReferenceLabel: "2000mg 以内"},
	{Key: "potassiumMg", Label: "钾", Unit: "mg", Aliases: []string{"potassiumMg", "potassium_mg"}, DailyReference: 3500, ReferenceLabel: "3500mg"},
	{Key: "calciumMg", Label: "钙", Unit: "mg", Aliases: []string{"calciumMg", "calcium_mg"}, DailyReference: 800, ReferenceLabel: "800mg"},
	{Key: "ironMg", Label: "铁", Unit: "mg", Aliases: []string{"ironMg", "iron_mg"}, DailyReference: 12, ReferenceLabel: "12mg"},
	{Key: "vitaminARaeMcg", Label: "维生素A", Unit: "mcg RAE", Aliases: []string{"vitaminARaeMcg", "vitamin_a_rae_mcg"}, DailyReference: 700, ReferenceLabel: "700mcg RAE"},
	{Key: "vitaminCMg", Label: "维生素C", Unit: "mg", Aliases: []string{"vitaminCMg", "vitamin_c_mg"}, DailyReference: 100, ReferenceLabel: "100mg"},
	{Key: "vitaminDMcg", Label: "维生素D", Unit: "mcg", Aliases: []string{"vitaminDMcg", "vitamin_d_mcg"}, DailyReference: 10, ReferenceLabel: "10mcg"},
}

func NewStatsService(repo StatsRepo, bodyMetrics BodyMetricsSummaryProvider, cfg ...*config.Config) *StatsService {
	var c *config.Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	return &StatsService{
		repo:            repo,
		bodyMetrics:     bodyMetrics,
		cfg:             c,
		client:          &http.Client{Timeout: 60 * time.Second},
		deepSeekBaseURL: "https://api.deepseek.com",
	}
}

func (s *StatsService) ConfigureCreditGuard(guard CreditGuard) {
	s.creditGuard = guard
}

type DailyCalories struct {
	Date     string  `json:"date"`
	Calories float64 `json:"calories"`
}

type StatsSummary struct {
	Range                        string              `json:"range"`
	StartDate                    string              `json:"start_date"`
	EndDate                      string              `json:"end_date"`
	TDEE                         int                 `json:"tdee"`
	StreakDays                   int                 `json:"streak_days"`
	RecordedDays                 int                 `json:"recorded_days"`
	TotalCalories                float64             `json:"total_calories"`
	AvgCaloriesPerDay            float64             `json:"avg_calories_per_day"`
	CalSurplusDeficit            float64             `json:"cal_surplus_deficit"`
	TotalProtein                 float64             `json:"total_protein"`
	TotalCarbs                   float64             `json:"total_carbs"`
	TotalFat                     float64             `json:"total_fat"`
	ByMeal                       map[string]float64  `json:"by_meal"`
	DailyCalories                []DailyCalories     `json:"daily_calories"`
	MacroPercent                 map[string]float64  `json:"macro_percent"`
	AnalysisSummary              string              `json:"analysis_summary"`
	AnalysisSummaryGeneratedDate *string             `json:"analysis_summary_generated_date"`
	AnalysisSummaryNeedsRefresh  bool                `json:"analysis_summary_needs_refresh"`
	AnalysisSummaryDailyLimit    int                 `json:"analysis_summary_daily_limit"`
	AnalysisSummaryUsedToday     int                 `json:"analysis_summary_used_today"`
	BodyMetrics                  *BodyMetricsSummary `json:"body_metrics"`
	HealthIndex                  *HealthIndex        `json:"health_index"`
}

type statsComputation struct {
	StatsRange         string
	StartDate          string
	EndDate            string
	User               *domain.StatsUserProfile
	TDEE               int
	StreakDays         int
	TotalCalories      float64
	AvgCaloriesPerDay  float64
	CalSurplusDeficit  float64
	TotalProtein       float64
	TotalCarbs         float64
	TotalFat           float64
	ByMeal             map[string]float64
	DailyCalories      []DailyCalories
	RecordedDaily      []DailyCalories
	MacroPercent       map[string]float64
	MicronutrientDaily map[string]float64
	RecordedDays       int
	DataFingerprint    string
	BodyMetrics        *BodyMetricsSummary
}

type statsInsightGeneration struct {
	Content string
	Usage   billing.TokenUsage
	Pricing *billing.PricingResult
	Model   string
}

type PetChatInput struct {
	Question   string `json:"question"`
	Range      string `json:"range"`
	SessionID  string `json:"session_id"`
	NewSession bool   `json:"new_session"`
}

type PetChatEstimateResult struct {
	Question       string                `json:"question"`
	Range          string                `json:"range"`
	RangeLabel     string                `json:"range_label"`
	RecordedDays   int                   `json:"recorded_days"`
	EstimatedUsage billing.TokenUsage    `json:"estimated_usage"`
	Pricing        billing.PricingResult `json:"pricing"`
}

type PetChatResult struct {
	Question           string                 `json:"question"`
	SessionID          string                 `json:"session_id"`
	UserMessageID      string                 `json:"user_message_id,omitempty"`
	AssistantMessageID string                 `json:"assistant_message_id,omitempty"`
	Range              string                 `json:"range"`
	RangeLabel         string                 `json:"range_label"`
	Answer             string                 `json:"answer"`
	RecordedDays       int                    `json:"recorded_days"`
	CreditsCharged     int                    `json:"credits_charged"`
	BillingStatus      string                 `json:"billing_status"`
	AIUsagePricing     *billing.PricingResult `json:"ai_usage_pricing,omitempty"`
	EstimatedPricing   billing.PricingResult  `json:"estimated_pricing"`
}

type PetChatHistoryMessage struct {
	ID             string         `json:"id"`
	Role           string         `json:"role"`
	Content        string         `json:"content"`
	MessageType    string         `json:"message_type"`
	Range          string         `json:"range"`
	CreditsCharged int            `json:"credits_charged"`
	Meta           map[string]any `json:"meta,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

type PetChatHistoryResult struct {
	Session  *domain.PetChatSession  `json:"session,omitempty"`
	Messages []PetChatHistoryMessage `json:"messages"`
}

type PetChatSessionSummary struct {
	ID                  string         `json:"id"`
	Title               string         `json:"title"`
	RangeType           string         `json:"range_type"`
	RecordedDays        int            `json:"recorded_days"`
	LastQuestion        string         `json:"last_question"`
	LastAnswer          string         `json:"last_answer"`
	LastMessageAt       *time.Time     `json:"last_message_at,omitempty"`
	TotalCreditsCharged int            `json:"total_credits_charged"`
	Meta                map[string]any `json:"meta,omitempty"`
	CreatedAt           time.Time      `json:"created_at"`
	UpdatedAt           time.Time      `json:"updated_at"`
}

type PetChatSessionsResult struct {
	Sessions []PetChatSessionSummary `json:"sessions"`
}

type PetChatAppendMessage struct {
	Role        string         `json:"role"`
	Content     string         `json:"content"`
	MessageType string         `json:"message_type"`
	Meta        map[string]any `json:"meta"`
}

type PetChatAppendInput struct {
	SessionID string                 `json:"session_id"`
	Messages  []PetChatAppendMessage `json:"messages"`
}

func (s *StatsService) GetSummary(ctx context.Context, userID string, statsRange string, fallbackTDEE int, fallbackStreakDays int) (*StatsSummary, error) {
	comp, err := s.buildStatsComputation(ctx, userID, statsRange, fallbackTDEE, fallbackStreakDays)
	if err != nil {
		return nil, err
	}

	today := time.Now().In(chinaTZ).Format("2006-01-02")
	var cached *domain.StatsInsight
	if hasEnoughStatsInsightData(comp) {
		cached, _ = s.repo.GetCachedInsight(ctx, userID, comp.StatsRange, today)
		if cached == nil {
			cached, _ = s.repo.GetLatestCachedInsight(ctx, userID, comp.StatsRange)
		}
	}
	usedToday := 0
	if count, err := s.repo.CountInsightGenerationsToday(ctx, userID); err == nil && count > 0 {
		usedToday = int(count)
	}

	analysisSummary := ""
	var analysisSummaryGeneratedDate *string
	needsRefresh := false
	if cached != nil {
		analysisSummary = sanitizeStatsInsightText(cached.InsightText)
		generatedDate := cached.GeneratedDateString()
		if generatedDate != "" {
			analysisSummaryGeneratedDate = &generatedDate
		}
		needsRefresh = generatedDate != today || cached.DataFingerprint != comp.DataFingerprint
	}

	healthIndex := computeHealthIndex(comp, statsRange)
	if err := s.attachCustomRiskCards(ctx, comp, healthIndex); err != nil {
		return nil, err
	}

	return &StatsSummary{
		Range:                        comp.StatsRange,
		StartDate:                    comp.StartDate,
		EndDate:                      comp.EndDate,
		TDEE:                         comp.TDEE,
		StreakDays:                   comp.StreakDays,
		RecordedDays:                 comp.RecordedDays,
		TotalCalories:                round1(comp.TotalCalories),
		AvgCaloriesPerDay:            comp.AvgCaloriesPerDay,
		CalSurplusDeficit:            comp.CalSurplusDeficit,
		TotalProtein:                 round1(comp.TotalProtein),
		TotalCarbs:                   round1(comp.TotalCarbs),
		TotalFat:                     round1(comp.TotalFat),
		ByMeal:                       comp.ByMeal,
		DailyCalories:                comp.DailyCalories,
		MacroPercent:                 comp.MacroPercent,
		AnalysisSummary:              analysisSummary,
		AnalysisSummaryGeneratedDate: analysisSummaryGeneratedDate,
		AnalysisSummaryNeedsRefresh:  needsRefresh,
		AnalysisSummaryDailyLimit:    statsInsightDailyLimit,
		AnalysisSummaryUsedToday:     usedToday,
		BodyMetrics:                  comp.BodyMetrics,
		HealthIndex:                  healthIndex,
	}, nil
}

func (s *StatsService) GenerateInsight(ctx context.Context, userID string, dateRange string, fallbackTDEE int, fallbackStreakDays int) (result map[string]any, err error) {
	var comp *statsComputation
	defer func() {
		if recovered := recover(); recovered != nil {
			logger.Error(ctx, "统计洞察生成发生 panic", fmt.Errorf("%v", recovered),
				logger.UserID(userID),
				slog.String("range", normalizeStatsRange(dateRange)),
				slog.String("stack", string(debug.Stack())),
				slog.Any("panic", recovered),
			)
			if comp != nil {
				result = map[string]any{"analysis_summary": fallbackStatsInsight(comp)}
				err = nil
				return
			}
			err = &commonerrors.AppError{Code: 10000, Message: "AI 解读服务暂时不可用，请稍后重试", HTTPStatus: 503}
		}
	}()

	count, err := s.repo.CountInsightGenerationsToday(ctx, userID)
	if err != nil {
		return nil, err
	}
	if count >= statsInsightDailyLimit {
		return nil, &commonerrors.AppError{Code: 10005, Message: "今日 AI 解读次数已达上限，请明天再试", HTTPStatus: 429}
	}
	comp, err = s.buildStatsComputation(ctx, userID, dateRange, fallbackTDEE, fallbackStreakDays)
	if err != nil {
		return nil, err
	}
	if !hasEnoughStatsInsightData(comp) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当前统计周期还没有饮食记录，先记录一餐后再生成 AI 风险解读", HTTPStatus: 400}
	}
	var creditsInfo map[string]any
	if s.creditGuard != nil && strings.TrimSpace(userID) != "" {
		creditsInfo, err = s.creditGuard.ValidateStatsInsightCredits(ctx, userID)
		if err != nil {
			return nil, err
		}
	}
	generation, err := s.generateNutritionInsight(ctx, comp)
	if err != nil {
		logger.Warn(ctx, "统计洞察大模型生成失败",
			logger.UserID(userID),
			slog.String("range", comp.StatsRange),
			slog.Int("recorded_days", comp.RecordedDays),
			logger.Err(err),
		)
		return nil, &commonerrors.AppError{Code: 10000, Message: "AI 解读生成失败，请稍后重试", HTTPStatus: 503}
	}
	insight := sanitizeStatsInsightText(generation.Content)
	today := time.Now().In(chinaTZ).Format("2006-01-02")
	if err := s.repo.UpsertInsightCache(ctx, userID, comp.StatsRange, today, comp.DataFingerprint, insight); err != nil {
		return nil, err
	}
	usedToday := int(count) + 1
	if nextCount, err := s.repo.CountInsightGenerationsToday(ctx, userID); err == nil && nextCount > 0 {
		usedToday = int(nextCount)
	}
	if s.creditGuard != nil && creditsInfo != nil {
		sourceKey := fmt.Sprintf("stats_insight:%s:%s:%d:%d", comp.StatsRange, today, usedToday, time.Now().UnixNano())
		meta := map[string]any{
			"range":          comp.StatsRange,
			"generated_date": today,
		}
		if generation.Pricing != nil {
			meta["ai_usage_pricing"] = generation.Pricing
		}
		if err := s.creditGuard.ConsumeEarnedCreditsAfterSuccess(ctx, userID, creditsInfo, statsInsightCreditCost, "stats_insight_reward_spend", sourceKey, meta); err != nil {
			return nil, err
		}
	}
	response := map[string]any{
		"analysis_summary":                insight,
		"analysis_summary_generated_date": today,
		"analysis_summary_needs_refresh":  false,
		"analysis_summary_daily_limit":    statsInsightDailyLimit,
		"analysis_summary_used_today":     usedToday,
	}
	if generation.Pricing != nil {
		response["ai_usage_pricing"] = generation.Pricing
	}
	return response, nil
}

func hasEnoughStatsInsightData(comp *statsComputation) bool {
	return comp != nil && comp.RecordedDays >= statsInsightMinRecordDays
}

func (s *StatsService) EstimatePetChat(ctx context.Context, userID string, input PetChatInput) (*PetChatEstimateResult, error) {
	question := normalizePetChatQuestion(input.Question)
	if question == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "question 不能为空", HTTPStatus: 400}
	}
	comp, err := s.buildStatsComputation(ctx, userID, input.Range, 2000, 0)
	if err != nil {
		return nil, err
	}
	if !hasEnoughStatsInsightData(comp) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "当前统计周期还没有饮食记录，先记录一餐后再问小食探", HTTPStatus: 400}
	}
	prompt := buildPetChatPrompt(comp, question, nil)
	usage := estimatePetChatTokenUsage(prompt, comp.StatsRange)
	pricing := billing.PriceTokenUsage(billing.PricingInput{Model: s.petChatModel(), Usage: usage}, s.aiUsagePricingConfig())
	if s.creditGuard != nil && strings.TrimSpace(userID) != "" {
		if _, err := s.creditGuard.ValidateUsageCredits(ctx, userID, pricing.CreditsCharged, "小食探对话"); err != nil {
			return nil, err
		}
	}
	return &PetChatEstimateResult{
		Question:       question,
		Range:          comp.StatsRange,
		RangeLabel:     statsRangeLabel(comp.StatsRange),
		RecordedDays:   comp.RecordedDays,
		EstimatedUsage: usage,
		Pricing:        pricing,
	}, nil
}

func (s *StatsService) GeneratePetChat(ctx context.Context, userID string, input PetChatInput) (*PetChatResult, error) {
	estimate, err := s.EstimatePetChat(ctx, userID, input)
	if err != nil {
		return nil, err
	}
	var creditsInfo map[string]any
	if s.creditGuard != nil && strings.TrimSpace(userID) != "" {
		creditsInfo, err = s.creditGuard.ValidateUsageCredits(ctx, userID, estimate.Pricing.CreditsCharged, "小食探对话")
		if err != nil {
			return nil, err
		}
	}
	comp, err := s.buildStatsComputation(ctx, userID, estimate.Range, 2000, 0)
	if err != nil {
		return nil, err
	}
	session, err := s.resolvePetChatSession(ctx, userID, input, comp, estimate.Question)
	if err != nil {
		return nil, err
	}
	historyMessages, err := s.repo.GetPetChatSessionMessages(ctx, userID, session.ID, 12)
	if err != nil {
		logger.Warn(ctx, "读取宠物连续对话上下文失败",
			logger.UserID(userID),
			slog.String("session_id", session.ID),
			logger.Err(err),
		)
		historyMessages = nil
	}
	generation, err := s.generatePetChatAnswer(ctx, comp, estimate.Question, historyMessages)
	if err != nil {
		logger.Warn(ctx, "宠物对话大模型生成失败",
			logger.UserID(userID),
			slog.String("range", estimate.Range),
			slog.Int("recorded_days", estimate.RecordedDays),
			logger.Err(err),
		)
		return nil, &commonerrors.AppError{Code: 10000, Message: "小食探分析失败，请稍后重试", HTTPStatus: 503}
	}
	actualPricing := generation.Pricing
	if actualPricing != nil && s.creditGuard != nil && strings.TrimSpace(userID) != "" {
		creditsInfo, err = s.creditGuard.ValidateUsageCredits(ctx, userID, actualPricing.CreditsCharged, "小食探对话")
		if err != nil {
			return nil, err
		}
		sourceKey := fmt.Sprintf("pet_chat:%s:%s:%d", estimate.Range, session.ID, time.Now().UnixNano())
		if err := s.creditGuard.ConsumeEarnedCreditsAfterSuccess(ctx, userID, creditsInfo, actualPricing.CreditsCharged, "pet_chat_reward_spend", sourceKey, map[string]any{
			"range":             estimate.Range,
			"session_id":        session.ID,
			"question":          estimate.Question,
			"ai_usage_pricing":  actualPricing,
			"estimated_pricing": estimate.Pricing,
			"recorded_days":     estimate.RecordedDays,
			"billing_strategy":  "actual_usage",
			"credits_per_cny":   actualPricing.CreditsPerCNY,
			"cost_multiplier":   actualPricing.CostMultiplier,
		}); err != nil {
			return nil, err
		}
	}
	creditsCharged := 0
	billingStatus := "free_fallback"
	if actualPricing != nil {
		creditsCharged = actualPricing.CreditsCharged
		billingStatus = "actual_usage_charged"
		if s.creditGuard == nil || strings.TrimSpace(userID) == "" {
			billingStatus = "actual_usage_unmetered"
		}
	}
	userMessageID, assistantMessageID := s.persistPetChatExchange(ctx, userID, session.ID, estimate.Range, estimate.Question, generation.Content, creditsCharged, actualPricing, &estimate.Pricing, billingStatus)
	return &PetChatResult{
		Question:           estimate.Question,
		SessionID:          session.ID,
		UserMessageID:      userMessageID,
		AssistantMessageID: assistantMessageID,
		Range:              estimate.Range,
		RangeLabel:         estimate.RangeLabel,
		Answer:             generation.Content,
		RecordedDays:       estimate.RecordedDays,
		CreditsCharged:     creditsCharged,
		BillingStatus:      billingStatus,
		AIUsagePricing:     actualPricing,
		EstimatedPricing:   estimate.Pricing,
	}, nil
}

func (s *StatsService) GetLatestPetChatSession(ctx context.Context, userID string) (*PetChatHistoryResult, error) {
	session, messages, err := s.repo.GetLatestPetChatSessionWithMessages(ctx, userID, 60)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return &PetChatHistoryResult{Messages: []PetChatHistoryMessage{}}, nil
		}
		return nil, err
	}
	return &PetChatHistoryResult{Session: session, Messages: toPetChatHistoryMessages(messages)}, nil
}

func (s *StatsService) ListPetChatSessions(ctx context.Context, userID string) (*PetChatSessionsResult, error) {
	sessions, err := s.repo.ListPetChatSessions(ctx, userID, 40)
	if err != nil {
		return nil, err
	}
	out := make([]PetChatSessionSummary, 0, len(sessions))
	for _, session := range sessions {
		out = append(out, toPetChatSessionSummary(session))
	}
	return &PetChatSessionsResult{Sessions: out}, nil
}

func (s *StatsService) GetPetChatSessionHistory(ctx context.Context, userID, sessionID string) (*PetChatHistoryResult, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "session_id required", HTTPStatus: 400}
	}
	session, err := s.repo.GetPetChatSession(ctx, userID, sessionID)
	if err != nil {
		return nil, &commonerrors.AppError{Code: 10004, Message: "对话不存在", HTTPStatus: 404}
	}
	messages, err := s.repo.GetPetChatSessionMessages(ctx, userID, sessionID, 80)
	if err != nil {
		return nil, err
	}
	return &PetChatHistoryResult{Session: session, Messages: toPetChatHistoryMessages(messages)}, nil
}

func (s *StatsService) AppendPetChatMessages(ctx context.Context, userID string, input PetChatAppendInput) (*PetChatHistoryResult, error) {
	sessionID := strings.TrimSpace(input.SessionID)
	if sessionID == "" {
		return nil, &commonerrors.AppError{Code: 10002, Message: "session_id 不能为空", HTTPStatus: 400}
	}
	session, err := s.repo.GetPetChatSession(ctx, userID, sessionID)
	if err != nil {
		return nil, &commonerrors.AppError{Code: 10004, Message: "对话不存在", HTTPStatus: 404}
	}
	if len(input.Messages) == 0 {
		return s.GetLatestPetChatSession(ctx, userID)
	}
	var lastQuestion, lastAnswer string
	for _, item := range input.Messages {
		role := normalizePetChatRole(item.Role)
		content := strings.TrimSpace(item.Content)
		if role == "" || content == "" {
			continue
		}
		if role == "user" {
			lastQuestion = content
		}
		if role == "assistant" || role == "pet" {
			role = "assistant"
			lastAnswer = content
		}
		if _, err := s.repo.AddPetChatMessage(ctx, domain.PetChatMessage{
			SessionID:   sessionID,
			UserID:      userID,
			Role:        role,
			Content:     content,
			MessageType: strings.TrimSpace(item.MessageType),
			RangeType:   session.RangeType,
			Meta:        item.Meta,
		}); err != nil {
			return nil, err
		}
	}
	if lastQuestion != "" || lastAnswer != "" {
		_ = s.repo.TouchPetChatSession(ctx, sessionID, userID, lastQuestion, lastAnswer, 0)
	}
	session, messages, err := s.repo.GetLatestPetChatSessionWithMessages(ctx, userID, 60)
	if err != nil {
		return nil, err
	}
	return &PetChatHistoryResult{Session: session, Messages: toPetChatHistoryMessages(messages)}, nil
}

func (s *StatsService) resolvePetChatSession(ctx context.Context, userID string, input PetChatInput, comp *statsComputation, question string) (*domain.PetChatSession, error) {
	sessionID := strings.TrimSpace(input.SessionID)
	if sessionID != "" && !input.NewSession {
		session, err := s.repo.GetPetChatSession(ctx, userID, sessionID)
		if err != nil {
			return nil, &commonerrors.AppError{Code: 10004, Message: "对话不存在，请新建对话后再试", HTTPStatus: 404}
		}
		return session, nil
	}
	title := trimStatsRunes(question, 28)
	if title == "" {
		title = statsRangeLabel(comp.StatsRange) + "饮食分析"
	}
	return s.repo.CreatePetChatSession(ctx, domain.PetChatSession{
		UserID:             userID,
		Title:              title,
		RangeType:          comp.StatsRange,
		Status:             "active",
		ContextStartDate:   comp.StartDate,
		ContextEndDate:     comp.EndDate,
		ContextFingerprint: comp.DataFingerprint,
		RecordedDays:       comp.RecordedDays,
		LastQuestion:       question,
		Meta: map[string]any{
			"source":             "pet_chat",
			"context_range":      comp.StatsRange,
			"context_start_date": comp.StartDate,
			"context_end_date":   comp.EndDate,
		},
	})
}

func (s *StatsService) persistPetChatExchange(ctx context.Context, userID, sessionID, statsRange, question, answer string, creditsCharged int, actualPricing *billing.PricingResult, estimatedPricing *billing.PricingResult, billingStatus string) (string, string) {
	userMsg, err := s.repo.AddPetChatMessage(ctx, domain.PetChatMessage{
		SessionID:   sessionID,
		UserID:      userID,
		Role:        "user",
		Content:     question,
		MessageType: "question",
		RangeType:   statsRange,
		Meta: map[string]any{
			"billing_status": billingStatus,
		},
	})
	if err != nil {
		logger.Warn(ctx, "保存宠物对话用户消息失败",
			logger.UserID(userID),
			slog.String("session_id", sessionID),
			logger.Err(err),
		)
		return "", ""
	}
	assistantMsg, err := s.repo.AddPetChatMessage(ctx, domain.PetChatMessage{
		SessionID:        sessionID,
		UserID:           userID,
		Role:             "assistant",
		Content:          answer,
		MessageType:      "analysis",
		RangeType:        statsRange,
		CreditsCharged:   creditsCharged,
		AIUsagePricing:   pricingResultToMap(actualPricing),
		EstimatedPricing: pricingResultToMap(estimatedPricing),
		Meta: map[string]any{
			"billing_status": billingStatus,
		},
	})
	if err != nil {
		logger.Warn(ctx, "保存宠物对话回复消息失败",
			logger.UserID(userID),
			slog.String("session_id", sessionID),
			logger.Err(err),
		)
		return userMsg.ID, ""
	}
	if err := s.repo.TouchPetChatSession(ctx, sessionID, userID, question, answer, creditsCharged); err != nil {
		logger.Warn(ctx, "更新宠物对话会话状态失败",
			logger.UserID(userID),
			slog.String("session_id", sessionID),
			logger.Err(err),
		)
	}
	return userMsg.ID, assistantMsg.ID
}

func toPetChatHistoryMessages(messages []domain.PetChatMessage) []PetChatHistoryMessage {
	out := make([]PetChatHistoryMessage, 0, len(messages))
	for _, item := range messages {
		out = append(out, PetChatHistoryMessage{
			ID:             item.ID,
			Role:           item.Role,
			Content:        item.Content,
			MessageType:    item.MessageType,
			Range:          item.RangeType,
			CreditsCharged: item.CreditsCharged,
			Meta:           item.Meta,
			CreatedAt:      item.CreatedAt,
		})
	}
	return out
}

func toPetChatSessionSummary(session domain.PetChatSession) PetChatSessionSummary {
	return PetChatSessionSummary{
		ID:                  session.ID,
		Title:               session.Title,
		RangeType:           session.RangeType,
		RecordedDays:        session.RecordedDays,
		LastQuestion:        session.LastQuestion,
		LastAnswer:          trimStatsRunes(session.LastAnswer, 80),
		LastMessageAt:       session.LastMessageAt,
		TotalCreditsCharged: session.TotalCreditsCharged,
		Meta:                session.Meta,
		CreatedAt:           session.CreatedAt,
		UpdatedAt:           session.UpdatedAt,
	}
}

func normalizePetChatRole(role string) string {
	switch strings.TrimSpace(role) {
	case "user":
		return "user"
	case "assistant", "pet":
		return "assistant"
	default:
		return ""
	}
}

func pricingResultToMap(pricing *billing.PricingResult) map[string]any {
	if pricing == nil {
		return map[string]any{}
	}
	data, err := json.Marshal(pricing)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return map[string]any{}
	}
	return out
}

func (s *StatsService) SaveInsight(ctx context.Context, userID string, content string, dateRange string) error {
	content = strings.TrimSpace(content)
	if content == "" {
		return &commonerrors.AppError{Code: 10002, Message: "analysis_summary 不能为空", HTTPStatus: 400}
	}
	comp, err := s.buildStatsComputation(ctx, userID, dateRange, 2000, 0)
	if err != nil {
		return err
	}
	today := time.Now().In(chinaTZ).Format("2006-01-02")
	return s.repo.UpsertInsightCache(ctx, userID, comp.StatsRange, today, comp.DataFingerprint, sanitizeStatsInsightText(content))
}

func (s *StatsService) generatePetChatAnswer(ctx context.Context, comp *statsComputation, question string, historyMessages []domain.PetChatMessage) (statsInsightGeneration, error) {
	apiKey := ""
	baseURL := s.deepSeekBaseURL
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "https://api.deepseek.com"
	}
	model := s.petChatModel()
	if s.cfg != nil {
		apiKey = strings.TrimSpace(s.cfg.External.DeepSeekAPIKey)
	}
	if apiKey == "" {
		return statsInsightGeneration{Content: fallbackPetChatAnswer(comp, question), Model: model}, nil
	}
	prompt := buildPetChatPrompt(comp, question, historyMessages)
	var lastErr error
	var retryFeedback string
	for attempt := 0; attempt < statsInsightMaxAttempts; attempt++ {
		generation, err := s.requestNutritionInsight(ctx, baseURL, apiKey, model, prompt, retryFeedback)
		if err != nil {
			lastErr = err
			break
		}
		if term := findStatsInsightForbiddenIdentityTerm(generation.Content); term != "" {
			lastErr = fmt.Errorf("DeepSeek 输出包含禁用身份措辞: %s", term)
			retryFeedback = fmt.Sprintf("上一次输出包含禁用身份措辞“%s”。请重新生成全文：不要自称任何身份，不要出现“专业营养师”“注册营养师”“持证营养师”等说法，也不要使用相近表达。", term)
			continue
		}
		generation.Content = sanitizeStatsInsightText(generation.Content)
		if billing.HasTokenUsage(generation.Usage) {
			pricing := billing.PriceTokenUsage(billing.PricingInput{Model: model, Usage: generation.Usage}, s.aiUsagePricingConfig())
			generation.Pricing = &pricing
		}
		return generation, nil
	}
	if lastErr != nil {
		return statsInsightGeneration{}, lastErr
	}
	return statsInsightGeneration{}, fmt.Errorf("DeepSeek 返回了空响应")
}

func (s *StatsService) aiUsagePricingConfig() config.AIUsagePricingConfig {
	if s.cfg == nil {
		return config.AIUsagePricingConfig{}
	}
	return s.cfg.AIUsagePricing
}

func (s *StatsService) petChatModel() string {
	if s.cfg != nil && strings.TrimSpace(s.cfg.AIUsagePricing.DefaultTextModel) != "" {
		return strings.TrimSpace(s.cfg.AIUsagePricing.DefaultTextModel)
	}
	return statsInsightDeepSeekModel
}

func (s *StatsService) buildStatsComputation(ctx context.Context, userID string, statsRange string, fallbackTDEE int, fallbackStreakDays int) (*statsComputation, error) {
	statsRange = normalizeStatsRange(statsRange)
	startDate, endDate, startUTC, endUTC := resolveStatsRangeUTC(statsRange)

	records, err := s.repo.GetFoodRecordsForDateRange(ctx, userID, startUTC, endUTC)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.GetUserProfile(ctx, userID)
	if err != nil {
		return nil, err
	}

	tdee := fallbackTDEE
	if tdee <= 0 {
		tdee = 2000
	}
	if user != nil && user.TDEE != nil && *user.TDEE > 0 {
		tdee = int(math.Round(*user.TDEE))
	}

	streakDays := fallbackStreakDays
	if streakDays <= 0 {
		streakDays = s.getStreakDays(ctx, userID)
	}

	var bodyMetricsSummary *BodyMetricsSummary
	if s.bodyMetrics != nil {
		bodyMetricsSummary, _ = s.bodyMetrics.GetSummary(ctx, userID, statsRange)
	}

	// 解析用户作息，用于餐次重分类
	var routineSleepHour, routineWakeHour int
	routineOK := false
	if user != nil && len(user.HealthCondition) > 0 {
		routineSleepHour, routineWakeHour, routineOK = parseRoutineHoursFromHealthCondition(user.HealthCondition)
	}

	totalCal := 0.0
	totalProtein := 0.0
	totalCarbs := 0.0
	totalFat := 0.0
	totalMicronutrients := initStatsMicronutrientTotals()
	byMeal := initMealCalories()
	dailyCal := make(map[string]float64)

	for _, r := range records {
		totalCal += r.TotalCalories
		totalProtein += r.TotalProtein
		totalCarbs += r.TotalCarbs
		totalFat += r.TotalFat
		addStatsMicronutrientTotals(totalMicronutrients, nutritionagg.SumMetrics(r.Items, statsInsightMicronutrientMetrics()))
		mealType := strings.TrimSpace(r.MealType)
		if mealType == "" {
			mealType = "unknown"
		}

		// 若作息解析成功，基于记录时间重新分类餐次
		if routineOK && r.RecordTime != nil {
			mealType = reclassifyMealByRoutine(mealType, *r.RecordTime, routineSleepHour, routineWakeHour)
		}

		byMeal[mealType] = byMeal[mealType] + r.TotalCalories

		if r.RecordTime != nil {
			dateKey := r.RecordTime.In(chinaTZ).Format("2006-01-02")
			dailyCal[dateKey] = dailyCal[dateKey] + r.TotalCalories
		}
	}

	recordedDays := len(dailyCal)
	avgCalPerDay := 0.0
	if recordedDays > 0 {
		avgCalPerDay = round1(totalCal / float64(recordedDays))
	}
	calSurplusDeficit := round1(avgCalPerDay - float64(tdee))

	totalMacros := totalProtein*4 + totalCarbs*4 + totalFat*9
	pctP, pctC, pctF := 0.0, 0.0, 0.0
	if totalMacros > 0 {
		pctP = round1(totalProtein * 4 / totalMacros * 100)
		pctC = round1(totalCarbs * 4 / totalMacros * 100)
		pctF = round1(totalFat * 9 / totalMacros * 100)
	}
	macroPercent := map[string]float64{"protein": pctP, "carbs": pctC, "fat": pctF}
	micronutrientDaily := buildStatsMicronutrientDailyAverage(totalMicronutrients, recordedDays)
	dataFingerprint := fmt.Sprintf("%.0f_%.1f_%d_%.1f_%.1f_%.1f_%s_%s",
		totalCal,
		avgCalPerDay,
		recordedDays,
		pctP,
		pctC,
		pctF,
		statsMicronutrientFingerprint(micronutrientDaily),
		statsProfileFingerprint(user),
	)

	return &statsComputation{
		StatsRange:         statsRange,
		StartDate:          startDate,
		EndDate:            endDate,
		User:               user,
		TDEE:               tdee,
		StreakDays:         streakDays,
		TotalCalories:      totalCal,
		AvgCaloriesPerDay:  avgCalPerDay,
		CalSurplusDeficit:  calSurplusDeficit,
		TotalProtein:       totalProtein,
		TotalCarbs:         totalCarbs,
		TotalFat:           totalFat,
		ByMeal:             byMeal,
		DailyCalories:      buildDailyList(startUTC, endUTC, dailyCal),
		RecordedDaily:      buildRecordedDailyList(dailyCal),
		MacroPercent:       macroPercent,
		MicronutrientDaily: micronutrientDaily,
		RecordedDays:       recordedDays,
		DataFingerprint:    dataFingerprint,
		BodyMetrics:        bodyMetricsSummary,
	}, nil
}

func (s *StatsService) getStreakDays(ctx context.Context, userID string) int {
	now := time.Now().In(chinaTZ)
	startDate := now.AddDate(0, 0, -180).Format("2006-01-02")
	startUTC, err := parseChinaDate(startDate)
	if err != nil {
		return 0
	}
	todayUTC, err := parseChinaDate(now.Format("2006-01-02"))
	if err != nil {
		return 0
	}
	endUTC := todayUTC.AddDate(0, 0, 1)
	dates, err := s.repo.GetRecentFoodRecordDates(ctx, userID, startUTC.UTC(), endUTC.UTC())
	if err != nil {
		return 0
	}
	dateSet := make(map[string]bool, len(dates))
	for _, date := range dates {
		dateSet[date] = true
	}
	cursor := now
	if !dateSet[cursor.Format("2006-01-02")] {
		cursor = cursor.AddDate(0, 0, -1)
	}
	streak := 0
	for {
		key := cursor.Format("2006-01-02")
		if !dateSet[key] {
			break
		}
		streak++
		cursor = cursor.AddDate(0, 0, -1)
	}
	return streak
}

func (s *StatsService) generateNutritionInsight(ctx context.Context, comp *statsComputation) (statsInsightGeneration, error) {
	apiKey := ""
	baseURL := s.deepSeekBaseURL
	if strings.TrimSpace(baseURL) == "" {
		baseURL = "https://api.deepseek.com"
	}
	model := statsInsightDeepSeekModel
	if s.cfg != nil {
		apiKey = strings.TrimSpace(s.cfg.External.DeepSeekAPIKey)
	}
	if apiKey == "" {
		return statsInsightGeneration{Content: fallbackStatsInsight(comp), Model: model}, nil
	}

	prompt := buildNutritionInsightPrompt(comp)
	var lastErr error
	var retryFeedback string
	for attempt := 0; attempt < statsInsightMaxAttempts; attempt++ {
		generation, err := s.requestNutritionInsight(ctx, baseURL, apiKey, model, prompt, retryFeedback)
		if err != nil {
			lastErr = err
			break
		}
		if term := findStatsInsightForbiddenIdentityTerm(generation.Content); term != "" {
			lastErr = fmt.Errorf("DeepSeek 输出包含禁用身份措辞: %s", term)
			retryFeedback = fmt.Sprintf("上一次输出包含禁用身份措辞“%s”。请重新生成全文：不要自称任何身份，不要出现“专业营养师”“专业的营养师”“注册营养师”“持证营养师”“饮食行为研究员”等说法，也不要用相近表达暗示自己具备执业资质。", term)
			continue
		}
		generation.Content = sanitizeStatsInsightText(generation.Content)
		if billing.HasTokenUsage(generation.Usage) {
			pricingCfg := config.AIUsagePricingConfig{}
			if s.cfg != nil {
				pricingCfg = s.cfg.AIUsagePricing
			}
			pricing := billing.PriceTokenUsage(billing.PricingInput{Model: model, Usage: generation.Usage}, pricingCfg)
			generation.Pricing = &pricing
		}
		return generation, nil
	}
	if lastErr != nil {
		return statsInsightGeneration{}, lastErr
	}
	return statsInsightGeneration{}, fmt.Errorf("DeepSeek 返回了空响应")
}

func (s *StatsService) requestNutritionInsight(ctx context.Context, baseURL, apiKey, model, prompt, retryFeedback string) (statsInsightGeneration, error) {
	messages := []map[string]string{
		{"role": "user", "content": prompt},
	}
	if strings.TrimSpace(retryFeedback) != "" {
		messages = append(messages, map[string]string{"role": "user", "content": retryFeedback})
	}
	body := map[string]any{
		"model":       model,
		"messages":    messages,
		"temperature": 0.6,
		"max_tokens":  statsInsightMaxTokens,
		"stream":      false,
	}
	bodyBytes, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/chat/completions", bytes.NewReader(bodyBytes))
	if err != nil {
		return statsInsightGeneration{}, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return statsInsightGeneration{}, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return statsInsightGeneration{}, fmt.Errorf("DeepSeek API 错误: %d %s", resp.StatusCode, extractDeepSeekError(respBody))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			PromptTokens          int `json:"prompt_tokens"`
			CompletionTokens      int `json:"completion_tokens"`
			TotalTokens           int `json:"total_tokens"`
			PromptCacheHitTokens  int `json:"prompt_cache_hit_tokens"`
			PromptCacheMissTokens int `json:"prompt_cache_miss_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return statsInsightGeneration{}, err
	}
	if len(parsed.Choices) == 0 {
		return statsInsightGeneration{}, fmt.Errorf("DeepSeek 返回了空响应")
	}
	if strings.EqualFold(strings.TrimSpace(parsed.Choices[0].FinishReason), "length") {
		return statsInsightGeneration{}, fmt.Errorf("DeepSeek 输出因 max_tokens 截断")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if content == "" {
		return statsInsightGeneration{}, fmt.Errorf("DeepSeek 返回了空响应")
	}
	return statsInsightGeneration{
		Content: content,
		Model:   model,
		Usage: billing.TokenUsage{
			InputTokens:          parsed.Usage.PromptTokens,
			OutputTokens:         parsed.Usage.CompletionTokens,
			TotalTokens:          parsed.Usage.TotalTokens,
			CachedInputTokens:    parsed.Usage.PromptCacheHitTokens,
			CacheMissInputTokens: parsed.Usage.PromptCacheMissTokens,
		},
	}, nil
}

func sanitizeStatsInsightText(content string) string {
	text := strings.TrimSpace(content)
	if text == "" {
		return ""
	}

	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = regexp.MustCompile("```+").ReplaceAllString(text, "")
	text = regexp.MustCompile(`\n{3,}`).ReplaceAllString(text, "\n\n")
	text = filterStatsInsightForbiddenIdentityText(text)
	return strings.TrimSpace(text)
}

func findStatsInsightForbiddenIdentityTerm(content string) string {
	normalized := strings.ReplaceAll(strings.TrimSpace(content), " ", "")
	for _, term := range statsInsightForbiddenIdentityTerms {
		if strings.Contains(normalized, strings.ReplaceAll(term, " ", "")) {
			return term
		}
	}
	return ""
}

func filterStatsInsightForbiddenIdentityText(content string) string {
	text := strings.TrimSpace(content)
	if text == "" {
		return ""
	}
	sentences := regexp.MustCompile(`(?m)[^。！？!?]*?(作为一名|作为一位|我是|我作为)[^。！？!?]*(专业营养师|专业的营养师|注册营养师|持证营养师|饮食行为研究员)[^。！？!?]*[。！？!?]?`).ReplaceAllString(text, "")
	replacements := map[string]string{
		"专业的营养师":  "营养相关专业人士",
		"专业营养师":   "营养相关专业人士",
		"注册营养师":   "营养相关专业人士",
		"持证营养师":   "营养相关专业人士",
		"饮食行为研究员": "饮食分析人员",
	}
	for old, replacement := range replacements {
		sentences = strings.ReplaceAll(sentences, old, replacement)
	}
	sentences = regexp.MustCompile(`\n{3,}`).ReplaceAllString(sentences, "\n\n")
	return strings.TrimSpace(sentences)
}

func statsInsightMicronutrientMetrics() []nutritionagg.Metric {
	metrics := make([]nutritionagg.Metric, 0, len(statsInsightMicronutrientReferences))
	for _, item := range statsInsightMicronutrientReferences {
		metrics = append(metrics, nutritionagg.Metric{Key: item.Key, Aliases: item.Aliases})
	}
	return metrics
}

func initStatsMicronutrientTotals() map[string]float64 {
	totals := make(map[string]float64, len(statsInsightMicronutrientReferences))
	for _, item := range statsInsightMicronutrientReferences {
		totals[item.Key] = 0
	}
	return totals
}

func addStatsMicronutrientTotals(target map[string]float64, addition map[string]float64) {
	for key, value := range addition {
		target[key] += value
	}
}

func buildStatsMicronutrientDailyAverage(totals map[string]float64, recordedDays int) map[string]float64 {
	averages := make(map[string]float64, len(statsInsightMicronutrientReferences))
	if recordedDays <= 0 {
		return averages
	}
	for _, item := range statsInsightMicronutrientReferences {
		averages[item.Key] = round1(totals[item.Key] / float64(recordedDays))
	}
	return averages
}

func statsMicronutrientFingerprint(values map[string]float64) string {
	parts := make([]string, 0, len(statsInsightMicronutrientReferences))
	for _, item := range statsInsightMicronutrientReferences {
		parts = append(parts, fmt.Sprintf("%s=%.1f", item.Key, values[item.Key]))
	}
	return strings.Join(parts, "|")
}

func buildStatsMicronutrientPromptBlock(comp *statsComputation) string {
	if comp == nil || comp.RecordedDays <= 0 || len(comp.MicronutrientDaily) == 0 {
		return ""
	}
	lines := make([]string, 0, len(statsInsightMicronutrientReferences))
	for _, item := range statsInsightMicronutrientReferences {
		value := comp.MicronutrientDaily[item.Key]
		if value <= 0 {
			continue
		}
		ratioText := "证据不足"
		if item.DailyReference > 0 {
			ratioText = fmt.Sprintf("约 %.0f%%", math.Round(value/item.DailyReference*100))
		}
		lines = append(lines, fmt.Sprintf("- %s：%.1f %s/记录日，参考 %s，达到 %s", item.Label, value, item.Unit, item.ReferenceLabel, ratioText))
	}
	return strings.Join(lines, "\n")
}

func fallbackStatsMicronutrientHint(comp *statsComputation) string {
	if comp == nil || comp.RecordedDays <= 0 || len(comp.MicronutrientDaily) == 0 {
		return ""
	}
	insufficient := make([]string, 0, 2)
	excess := make([]string, 0, 1)
	for _, item := range statsInsightMicronutrientReferences {
		value := comp.MicronutrientDaily[item.Key]
		if value <= 0 || item.DailyReference <= 0 {
			continue
		}
		ratio := value / item.DailyReference
		if item.Key == "sodiumMg" {
			if ratio > 1.1 {
				excess = append(excess, item.Label)
			}
			continue
		}
		if ratio < 0.6 {
			insufficient = append(insufficient, item.Label)
		}
	}
	parts := make([]string, 0, 2)
	if len(insufficient) > 0 {
		parts = append(parts, "微量营养里 "+strings.Join(insufficient, "、")+" 偏少")
	}
	if len(excess) > 0 {
		parts = append(parts, strings.Join(excess, "、")+" 偏高")
	}
	if len(parts) == 0 {
		return ""
	}
	return "；" + strings.Join(parts, "；") + "。"
}

func buildNutritionInsightPrompt(comp *statsComputation) string {
	rangeLabel := "近一周"
	if comp.StatsRange == "month" {
		rangeLabel = "近一月"
	}
	dietGoal := "无"
	if comp.User != nil && comp.User.DietGoal != nil {
		dietGoal = dietGoalLabel(*comp.User.DietGoal)
	}

	statsText := fmt.Sprintf(`统计周期：%s（%s 至 %s）
日常消耗估算：%d kcal/天
饮食目标：%s

本期数据：
- 总热量：%.0f kcal
- 日均摄入：%.0f kcal
- 日均与日常消耗估算差值：%+.0f kcal（正为盈余，负为亏损）
- 连续记录天数：%d 天
- 餐次分布：早餐 %.0f kcal、早加餐 %.0f kcal、午餐 %.0f kcal、午加餐 %.0f kcal、晚餐 %.0f kcal、晚加餐 %.0f kcal
- 宏量营养素占比：蛋白质 %.1f%%、碳水 %.1f%%、脂肪 %.1f%%
- 总摄入：蛋白质 %.1fg、碳水 %.1fg、脂肪 %.1fg
`,
		rangeLabel,
		comp.StartDate,
		comp.EndDate,
		comp.TDEE,
		dietGoal,
		comp.TotalCalories,
		comp.AvgCaloriesPerDay,
		comp.CalSurplusDeficit,
		comp.StreakDays,
		comp.ByMeal["breakfast"],
		comp.ByMeal["morning_snack"],
		comp.ByMeal["lunch"],
		comp.ByMeal["afternoon_snack"],
		comp.ByMeal["dinner"],
		comp.ByMeal["evening_snack"],
		comp.MacroPercent["protein"],
		comp.MacroPercent["carbs"],
		comp.MacroPercent["fat"],
		comp.TotalProtein,
		comp.TotalCarbs,
		comp.TotalFat,
	)
	if len(comp.RecordedDaily) > 0 {
		recent := comp.RecordedDaily
		if len(recent) > 5 {
			recent = recent[len(recent)-5:]
		}
		parts := make([]string, 0, len(recent))
		for _, item := range recent {
			label := item.Date
			if len(label) >= 10 {
				label = label[5:]
			}
			parts = append(parts, fmt.Sprintf("%s(%.0f)", label, item.Calories))
		}
		statsText += "- 每日热量趋势（最近5天）：" + strings.Join(parts, "、") + "\n"
	}
	if weightBlock := formatStatsWeightBlock(comp); weightBlock != "" {
		statsText += "\n身体指标：\n" + weightBlock
	}
	if micronutrientBlock := buildStatsMicronutrientPromptBlock(comp); micronutrientBlock != "" {
		statsText += "\n微量营养线索（按记录日均，参考普通成年人常见建议量，仅用于趋势判断）：\n" + micronutrientBlock + "\n"
	}

	customFocusBlock := ""
	if focuses := parseCustomHealthFocusesFromProfile(comp.User); len(focuses) > 0 {
		labels := make([]string, 0, len(focuses))
		for _, focus := range focuses {
			labels = append(labels, focus.Label)
		}
		customFocusBlock = "\n用户当前自定义关注：" + strings.Join(labels, "、") + "。请在餐次结构与优先行动部分针对性展开。\n"
	}

	return fmt.Sprintf(`请根据以下用户健康档案、饮食统计和身体指标，生成一份“深度 AI 风险解读”。内容应基于数据、清晰克制、普通用户能读懂，避免任何身份扮演或资质暗示。

%s

%s
%s

要求：
1. 输出 700-1000 字，分成 6 个小节，每节使用清晰短标题。
2. 必须覆盖：总体结论、热量与日常消耗估算、蛋白/碳水/脂肪结构、微量营养与维生素/矿物质线索、餐次结构与可能风险、下一步 3 条优先行动。
3. 要像研究报告一样基于数据推理，明确写出“为什么这么判断”，不要只给空泛鼓励。
4. 结合用户体重、作息、体检/病史/过敏/饮食目标等可用信息；没有数据时明确说“本期证据不足”。
5. 风险表达要谨慎：这是饮食相关风险趋势，不构成医学诊断或治疗建议。
6. 输出 Markdown 正文，不要 JSON 或代码块；可以使用二级/三级标题、短段落和列表。
7. 如果微量营养线索里出现明显偏低或偏高，必须点名写出最值得关注的 1-3 项，并说明它们更可能对应哪类饮食结构问题；如果证据不足，也要直说。
8. 每节至少挑 1 个最重要的风险判断点使用 <u>...</u> 标记下划线，例如 <u>日均热量缺口过大</u>；不要滥用，全文 5-8 处即可。
9. 严禁自我介绍或身份声明；全文不得出现“专业营养师”“专业的营养师”“注册营养师”“持证营养师”“饮食行为研究员”等措辞，也不要使用相近表达暗示具备执业资质。
`, formatStatsHealthProfile(comp.User, latestWeightFromBodyMetrics(comp.BodyMetrics)), statsText, customFocusBlock)
}

func buildPetChatPrompt(comp *statsComputation, question string, historyMessages []domain.PetChatMessage) string {
	rangeLabel := statsRangeLabel(comp.StatsRange)
	dietGoal := "无"
	if comp.User != nil && comp.User.DietGoal != nil {
		dietGoal = dietGoalLabel(*comp.User.DietGoal)
	}
	dailyTrend := "证据不足"
	if len(comp.RecordedDaily) > 0 {
		recent := comp.RecordedDaily
		if len(recent) > 10 {
			recent = recent[len(recent)-10:]
		}
		parts := make([]string, 0, len(recent))
		for _, item := range recent {
			label := item.Date
			if len(label) >= 10 {
				label = label[5:]
			}
			parts = append(parts, fmt.Sprintf("%s %.0fkcal", label, item.Calories))
		}
		dailyTrend = strings.Join(parts, "；")
	}
	weightBlock := formatStatsWeightBlock(comp)
	if strings.TrimSpace(weightBlock) == "" {
		weightBlock = "本期没有足够体重趋势证据。\n"
	}
	micronutrientBlock := strings.TrimSpace(buildStatsMicronutrientPromptBlock(comp))
	if micronutrientBlock == "" {
		micronutrientBlock = "本期保存记录里没有可用的微量营养字段，不能判断钙、铁、锌、维生素、膳食纤维、钠钾等是否充足。"
	}
	historyBlock := buildPetChatHistoryPromptBlock(historyMessages)
	customFocusBlock := buildPetChatCustomFocusPromptBlock(comp.User)
	return fmt.Sprintf(`你是“食探”小程序里的宠物伙伴“小食探”，正在和用户进行自然对话式饮食分析。你只能基于已保存的饮食文本、营养汇总和身体趋势数据回答；不要声称看到了图片，不要做医学诊断，不要自称专业营养师。

用户当前追问：
%s

最近对话上下文（按时间顺序，可能为空）：
%s

分析范围：%s（%s 至 %s）
饮食目标：%s
日常消耗估算：%d kcal/天
记录天数：%d 天

饮食统计：
- 总热量：%.0f kcal；日均摄入：%.0f kcal；日均与消耗估算差值：%+.0f kcal
- 蛋白质：%.1fg；碳水：%.1fg；脂肪：%.1fg
- 宏量占比：蛋白质 %.1f%%、碳水 %.1f%%、脂肪 %.1f%%
- 餐次热量：早餐 %.0f、早加餐 %.0f、午餐 %.0f、午加餐 %.0f、晚餐 %.0f、晚加餐 %.0f kcal
- 每日热量趋势：%s

身体指标：
%s

微量营养线索（按记录日均，参考普通成年人常见建议量，仅用于趋势判断）：
%s

健康档案：
%s

用户当前关注：
%s

回答要求：
1. 用宠物伙伴语气，亲近但不装可爱过头；像在和用户聊天，而不是写正式报告。
2. 必须直接回答“用户当前追问”，并结合最近对话上下文；不要只说“我们继续刚才的话题”这种空话。
3. 必须结合健康档案、身体指标、饮食目标、活动水平、作息、病史/过敏/忌口、体检摘要和用户当前关注；没有对应信息时明确说证据不足。
4. 如果用户提到训练状态、饥饿感、减脂卡住、碳水、蛋白质，要围绕这些点解释可能原因。
5. 如果用户提到微量元素、维生素、矿物质、钙、铁、锌、钠钾、膳食纤维，必须优先引用“微量营养线索”；如果对应字段缺失，要明确说是记录字段不足，而不是说你没有接入或完全没看。
6. 如果当前追问很短，例如“为什么”“有什么关系”“只看微量元素”，要从最近对话里还原它指代的问题再回答。
7. 必须说明证据边界：如果没有训练日志、睡眠或体感数据，要明确说“这部分只能推测”。
8. 最后给 2-3 个明天能执行的小动作。
9. 输出 Markdown 正文，不要 JSON，不要代码块，控制在 450-750 字。
10. 严禁出现“专业营养师”“注册营养师”“持证营养师”等身份措辞。
`,
		question,
		historyBlock,
		rangeLabel,
		comp.StartDate,
		comp.EndDate,
		dietGoal,
		comp.TDEE,
		comp.RecordedDays,
		comp.TotalCalories,
		comp.AvgCaloriesPerDay,
		comp.CalSurplusDeficit,
		comp.TotalProtein,
		comp.TotalCarbs,
		comp.TotalFat,
		comp.MacroPercent["protein"],
		comp.MacroPercent["carbs"],
		comp.MacroPercent["fat"],
		comp.ByMeal["breakfast"],
		comp.ByMeal["morning_snack"],
		comp.ByMeal["lunch"],
		comp.ByMeal["afternoon_snack"],
		comp.ByMeal["dinner"],
		comp.ByMeal["evening_snack"],
		dailyTrend,
		weightBlock,
		micronutrientBlock,
		formatStatsHealthProfile(comp.User, latestWeightFromBodyMetrics(comp.BodyMetrics)),
		customFocusBlock,
	)
}

func buildPetChatCustomFocusPromptBlock(user *domain.StatsUserProfile) string {
	focuses := parseCustomHealthFocusesFromProfile(user)
	if len(focuses) == 0 {
		return "用户未设置额外自定义关注指标。"
	}
	labels := make([]string, 0, len(focuses))
	for _, focus := range focuses {
		if label := strings.TrimSpace(focus.Label); label != "" {
			labels = append(labels, label)
		}
	}
	if len(labels) == 0 {
		return "用户未设置额外自定义关注指标。"
	}
	return strings.Join(labels, "、")
}

func buildPetChatHistoryPromptBlock(messages []domain.PetChatMessage) string {
	if len(messages) == 0 {
		return "无历史对话。"
	}
	if len(messages) > 10 {
		messages = messages[len(messages)-10:]
	}
	lines := make([]string, 0, len(messages))
	for _, msg := range messages {
		content := strings.TrimSpace(msg.Content)
		if content == "" {
			continue
		}
		role := "用户"
		if normalizePetChatRole(msg.Role) == "assistant" {
			role = "宠物"
		}
		lines = append(lines, fmt.Sprintf("- %s：%s", role, trimStatsRunes(content, 220)))
	}
	if len(lines) == 0 {
		return "无历史对话。"
	}
	return strings.Join(lines, "\n")
}

func normalizePetChatQuestion(question string) string {
	question = strings.TrimSpace(question)
	if question == "" {
		return ""
	}
	runes := []rune(question)
	if len(runes) > 300 {
		return string(runes[:300])
	}
	return question
}

func estimatePetChatTokenUsage(prompt string, statsRange string) billing.TokenUsage {
	inputTokens := int(math.Ceil(float64(len([]rune(prompt))) / 1.4))
	if normalizeStatsRange(statsRange) == "month" {
		inputTokens += 800
	} else {
		inputTokens += 500
	}
	outputTokens := 1050
	if normalizeStatsRange(statsRange) == "month" {
		outputTokens = 1250
	}
	return billing.TokenUsage{
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		TotalTokens:  inputTokens + outputTokens,
	}
}

func statsRangeLabel(statsRange string) string {
	if normalizeStatsRange(statsRange) == "month" {
		return "最近 30 天"
	}
	return "最近 7 天"
}

func fallbackPetChatAnswer(comp *statsComputation, question string) string {
	microHint := fallbackStatsMicronutrientHint(comp)
	if microHint == "" && strings.ContainsAny(question, "微维钙铁锌钠钾纤") {
		microHint = "；这轮本地统计没有足够微量营养字段，暂时不能判断钙、铁、锌、维生素、钠钾和膳食纤维是否充足。"
	}
	return fmt.Sprintf("我先用本地统计给你一个轻量判断：你问的是“%s”。%s里共有 %d 天饮食记录，日均摄入约 %.0f kcal，和日常消耗估算相差 %+.0f kcal。蛋白质总量 %.1fg、碳水 %.1fg、脂肪 %.1fg%s。\n\n这次没有调用到深度模型，所以我只能先看大方向：如果你感觉训练状态下滑，优先检查训练日前后有没有稳定主食、总热量是不是连续偏低、蛋白质是不是分散到每餐。明天可以先做一个小实验：训练前补一份主食，训练后补蛋白和碳水，然后记录体感。", question, statsRangeLabel(comp.StatsRange), comp.RecordedDays, comp.AvgCaloriesPerDay, comp.CalSurplusDeficit, comp.TotalProtein, comp.TotalCarbs, comp.TotalFat, microHint)
}

func fallbackStatsInsight(comp *statsComputation) string {
	if comp.RecordedDays == 0 {
		return "本期还没有足够的饮食记录生成完整洞察。可以先保持每日记录，积累几天后再查看趋势。"
	}
	return fmt.Sprintf(
		"本期日均摄入 %.0f 千卡，与日常消耗估算差值 %+.0f 千卡。蛋白质占比 %.1f%%，碳水 %.1f%%，脂肪 %.1f%%。连续记录 %d 天，整体节奏已经建立起来了，接下来可以继续关注餐次稳定性和蛋白质摄入质量%s",
		comp.AvgCaloriesPerDay,
		comp.CalSurplusDeficit,
		comp.MacroPercent["protein"],
		comp.MacroPercent["carbs"],
		comp.MacroPercent["fat"],
		comp.StreakDays,
		fallbackStatsMicronutrientHint(comp),
	)
}

func formatStatsHealthProfile(user *domain.StatsUserProfile, latestWeight *WeightEntry) string {
	if user == nil {
		return ""
	}
	parts := []string{}
	if user.Gender != nil && *user.Gender != "" {
		label := "女"
		if *user.Gender == "male" {
			label = "男"
		}
		parts = append(parts, "性别："+label)
	}
	if user.Height != nil {
		parts = append(parts, fmt.Sprintf("身高 %.0f cm", *user.Height))
	}
	if latestWeight != nil {
		parts = append(parts, fmt.Sprintf("体重 %.1f kg", latestWeight.Value))
	} else if user.Weight != nil {
		parts = append(parts, fmt.Sprintf("体重 %.1f kg", *user.Weight))
	}
	if user.Birthday != nil && *user.Birthday != "" {
		if age := ageFromBirthday(*user.Birthday, time.Now().In(chinaTZ)); age > 0 {
			parts = append(parts, fmt.Sprintf("年龄 %d 岁", age))
		}
	}
	lines := []string{}
	if len(parts) > 0 {
		lines = append(lines, "· "+strings.Join(parts, "  "))
	}
	activity := "未填"
	if user.ActivityLevel != nil && *user.ActivityLevel != "" {
		activity = activityLevelLabel(*user.ActivityLevel)
	}
	lines = append(lines, "· 日常活动："+activity)

	hc := user.HealthCondition
	if len(hc) > 0 {
		if routine := statsRoutineText(hc["routine_type"]); routine != "" {
			lines = append(lines, "· 作息习惯："+routine)
		}
		if medical := joinStatsStringList(hc["medical_history"]); medical != "" {
			lines = append(lines, "· 既往病史："+medical)
		}
		if diet := joinStatsStringList(hc["diet_preference"]); diet != "" {
			lines = append(lines, "· 饮食偏好："+diet)
		}
		if allergies := joinStatsStringList(hc["allergies"]); allergies != "" {
			lines = append(lines, "· 过敏/忌口："+allergies)
		}
	}
	if user.BMR != nil || user.TDEE != nil {
		bmr := "未计算"
		tdee := "未计算"
		if user.BMR != nil {
			bmr = fmt.Sprintf("%.0f kcal/天", *user.BMR)
		}
		if user.TDEE != nil {
			tdee = fmt.Sprintf("%.0f kcal/天", *user.TDEE)
		}
		lines = append(lines, fmt.Sprintf("· 基础代谢(BMR)：%s；日常消耗估算：%s", bmr, tdee))
	}
	if report := formatStatsReportExtract(hc); report != "" {
		lines = append(lines, "· 体检/病历摘要："+report)
	}
	if len(lines) == 0 {
		return ""
	}
	return "用户健康档案（供营养建议参考）：\n" + strings.Join(lines, "\n")
}

func formatStatsWeightBlock(comp *statsComputation) string {
	if comp.BodyMetrics == nil || comp.BodyMetrics.LatestWeight == nil {
		return ""
	}
	parts := []string{fmt.Sprintf("- 本期最新体重：%.1f kg", comp.BodyMetrics.LatestWeight.Value)}
	if comp.BodyMetrics.WeightChange != nil {
		direction := "持平"
		if *comp.BodyMetrics.WeightChange > 0 {
			direction = "上升"
		} else if *comp.BodyMetrics.WeightChange < 0 {
			direction = "下降"
		}
		parts[0] += fmt.Sprintf("（较前一次%s %.1f kg）", direction, math.Abs(*comp.BodyMetrics.WeightChange))
	}
	if len(comp.BodyMetrics.WeightEntries) >= 3 {
		entries := comp.BodyMetrics.WeightEntries
		if len(entries) > 7 {
			entries = entries[len(entries)-7:]
		}
		trend := make([]string, 0, len(entries))
		for _, item := range entries {
			label := item.Date
			if len(label) >= 10 {
				label = label[5:]
			}
			trend = append(trend, fmt.Sprintf("%s(%.1fkg)", label, item.Value))
		}
		parts = append(parts, "- 近期体重变化趋势："+strings.Join(trend, " → "))
	}
	if comp.User != nil && comp.User.Weight != nil && math.Abs(*comp.User.Weight-comp.BodyMetrics.LatestWeight.Value) > 1.0 {
		parts = append(parts, fmt.Sprintf("- 健康档案体重（%.1f kg）与最新记录体重（%.1f kg）差异较大，请以最新记录为准", *comp.User.Weight, comp.BodyMetrics.LatestWeight.Value))
	}
	return strings.Join(parts, "\n") + "\n"
}

func buildDailyList(startUTC, endUTC time.Time, dailyCal map[string]float64) []DailyCalories {
	result := make([]DailyCalories, 0)
	start := startUTC.In(chinaTZ)
	end := endUTC.In(chinaTZ).Add(-time.Second)
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dateKey := d.Format("2006-01-02")
		result = append(result, DailyCalories{
			Date:     dateKey,
			Calories: round1(dailyCal[dateKey]),
		})
	}
	return result
}

func buildRecordedDailyList(dailyCal map[string]float64) []DailyCalories {
	dates := make([]string, 0, len(dailyCal))
	for date := range dailyCal {
		dates = append(dates, date)
	}
	sort.Strings(dates)
	result := make([]DailyCalories, 0, len(dates))
	for _, date := range dates {
		result = append(result, DailyCalories{Date: date, Calories: round1(dailyCal[date])})
	}
	return result
}

func initMealCalories() map[string]float64 {
	return map[string]float64{
		"breakfast":       0,
		"morning_snack":   0,
		"lunch":           0,
		"afternoon_snack": 0,
		"dinner":          0,
		"evening_snack":   0,
	}
}

func resolveStatsRangeUTC(statsRange string) (string, string, time.Time, time.Time) {
	now := time.Now().In(chinaTZ)
	endDate := now.Format("2006-01-02")
	var daysBack int
	switch normalizeStatsRange(statsRange) {
	case "month":
		daysBack = 29
	default:
		daysBack = 6
	}
	startDate := now.AddDate(0, 0, -daysBack).Format("2006-01-02")
	startUTC, _ := parseChinaDate(startDate)
	endUTC := startUTC.AddDate(0, 0, daysBack+1)
	return startDate, endDate, startUTC.UTC(), endUTC.UTC()
}

func normalizeStatsRange(statsRange string) string {
	switch statsRange {
	case "month", "30d":
		return "month"
	case "week", "7d":
		return "week"
	default:
		return "week"
	}
}

func dietGoalLabel(value string) string {
	switch strings.TrimSpace(value) {
	case "fat_loss":
		return "减脂"
	case "muscle_gain":
		return "增肌"
	case "maintain":
		return "维持体重"
	case "", "none":
		return "无"
	default:
		return value
	}
}

func activityLevelLabel(value string) string {
	switch strings.TrimSpace(value) {
	case "sedentary":
		return "久坐办公"
	case "light":
		return "日常走动较多"
	case "moderate":
		return "经常站立走动"
	case "active":
		return "体力劳动"
	case "very_active":
		return "体力劳动"
	default:
		return value
	}
}

// reclassifyMealByRoutine 根据用户作息和记录时间重新分类餐次。
// 规则基于相对时间而非固定钟点：
//   - 起床后 0-3 小时：breakfast（该用户的早餐）
//   - 起床后 3-8 小时：lunch
//   - 睡前 4 小时内：dinner
//   - 其他：snack
func reclassifyMealByRoutine(originalMealType string, recordTime time.Time, sleepHour, wakeHour int) string {
	hour := recordTime.Hour()

	// 计算从起床到记录时间的偏移小时数（跨天处理）
	hoursSinceWake := (hour - wakeHour + 24) % 24
	// 计算从记录时间到睡觉的偏移小时数（跨天处理）
	hoursUntilSleep := (sleepHour - hour + 24) % 24

	if hoursSinceWake <= 3 {
		return "breakfast"
	}
	if hoursUntilSleep <= 4 {
		return "dinner"
	}
	if hoursSinceWake <= 8 {
		return "lunch"
	}
	return "snack"
}

func statsRoutineText(value any) string {
	raw := strings.TrimSpace(fmt.Sprintf("%v", value))
	if raw == "" || raw == "<nil>" {
		return ""
	}
	switch raw {
	case "early_bird":
		return "早睡早起（通常 22:30 前睡，7:00 前起）"
	case "regular":
		return "标准作息（通常 23:00 左右睡，7:00-8:00 起）"
	case "night_owl":
		return "晚睡晚起（经常 0 点后睡，起床也偏晚）"
	case "irregular":
		return "不太固定/轮班"
	default:
		return raw
	}
}

// parseRoutineHoursFromHealthCondition 优先从 routine_sleep_hour / routine_wake_hour 读取数字作息，
// 缺失时回退到解析 routine_type 文本（兼容存量数据）。
func parseRoutineHoursFromHealthCondition(hc map[string]any) (sleepHour, wakeHour int, ok bool) {
	if len(hc) == 0 {
		return 0, 0, false
	}

	// 优先读取数字字段
	if v, exists := hc["routine_sleep_hour"]; exists {
		switch val := v.(type) {
		case int:
			sleepHour = val
		case int8, int16, int32, int64:
			sleepHour = int(reflect.ValueOf(val).Int())
		case float32, float64:
			sleepHour = int(reflect.ValueOf(val).Float())
		case json.Number:
			if h, err := val.Int64(); err == nil {
				sleepHour = int(h)
			}
		}
	}
	if v, exists := hc["routine_wake_hour"]; exists {
		switch val := v.(type) {
		case int:
			wakeHour = val
		case int8, int16, int32, int64:
			wakeHour = int(reflect.ValueOf(val).Int())
		case float32, float64:
			wakeHour = int(reflect.ValueOf(val).Float())
		case json.Number:
			if h, err := val.Int64(); err == nil {
				wakeHour = int(h)
			}
		}
	}
	if sleepHour >= 0 && sleepHour <= 23 && wakeHour >= 0 && wakeHour <= 23 {
		return sleepHour, wakeHour, true
	}

	// 回退：解析 routine_type 文本
	raw := strings.TrimSpace(fmt.Sprintf("%v", hc["routine_type"]))
	if raw == "" || raw == "<nil>" {
		return 0, 0, false
	}
	switch raw {
	case "early_bird":
		return 22, 6, true
	case "regular":
		return 23, 7, true
	case "night_owl":
		return 1, 9, true
	case "irregular":
		return 0, 0, false
	}

	// 正则匹配 HH:00 睡，HH:00 起
	re := regexp.MustCompile(`(\d{1,2})(?::\d{1,2})?`)
	matches := re.FindAllStringSubmatch(raw, -1)
	if len(matches) >= 2 {
		if h1, err := strconv.Atoi(matches[0][1]); err == nil && h1 >= 0 && h1 <= 23 {
			if h2, err := strconv.Atoi(matches[1][1]); err == nil && h2 >= 0 && h2 <= 23 {
				return h1, h2, true
			}
		}
	}

	return 0, 0, false
}

func statsProfileFingerprint(user *domain.StatsUserProfile) string {
	if user == nil || len(user.HealthCondition) == 0 {
		return "profile:none"
	}
	return "routine:" + statsRoutineText(user.HealthCondition["routine_type"])
}

func latestWeightFromBodyMetrics(summary *BodyMetricsSummary) *WeightEntry {
	if summary == nil {
		return nil
	}
	return summary.LatestWeight
}

func joinStatsStringList(value any) string {
	switch v := value.(type) {
	case []string:
		return strings.Join(v, "、")
	case []any:
		parts := []string{}
		for _, item := range v {
			text := strings.TrimSpace(fmt.Sprintf("%v", item))
			if text != "" && text != "<nil>" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "、")
	case string:
		return strings.TrimSpace(v)
	default:
		return ""
	}
}

func formatStatsReportExtract(hc map[string]any) string {
	if len(hc) == 0 {
		return ""
	}
	report := hc["report_extract"]
	if report == nil {
		report = hc["ocr_notes"]
	}
	if report == nil {
		return ""
	}
	switch v := report.(type) {
	case string:
		return trimStatsRunes(v, 500)
	default:
		data, _ := json.Marshal(v)
		return trimStatsRunes(string(data), 500)
	}
}

func trimStatsRunes(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "..."
}

func extractDeepSeekError(body []byte) string {
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return strings.TrimSpace(string(body))
	}
	if errObj, ok := parsed["error"].(map[string]any); ok {
		if msg := strings.TrimSpace(fmt.Sprintf("%v", errObj["message"])); msg != "" && msg != "<nil>" {
			return msg
		}
	}
	return strings.TrimSpace(string(body))
}
