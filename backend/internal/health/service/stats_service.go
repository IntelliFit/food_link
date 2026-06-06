package service

import (
	"bytes"
	"context"
	"encoding/json"
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

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/config"
	"food_link/backend/pkg/logger"

	"log/slog"
)

var statsInsightMarkdownHeadingPattern = regexp.MustCompile(`(?m)^\s{0,3}#{1,6}\s*`)
var statsInsightMarkdownBulletPattern = regexp.MustCompile(`(?m)^\s*[-*+]\s+`)

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
	statsInsightDeepSeekModel = "deepseek-v4-flash"
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
	StatsRange        string
	StartDate         string
	EndDate           string
	User              *domain.StatsUserProfile
	TDEE              int
	StreakDays        int
	TotalCalories     float64
	AvgCaloriesPerDay float64
	CalSurplusDeficit float64
	TotalProtein      float64
	TotalCarbs        float64
	TotalFat          float64
	ByMeal            map[string]float64
	DailyCalories     []DailyCalories
	RecordedDaily     []DailyCalories
	MacroPercent      map[string]float64
	RecordedDays      int
	DataFingerprint   string
	BodyMetrics       *BodyMetricsSummary
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
			logger.L().Error("统计洞察生成发生 panic",
				slog.Any("panic", recovered),
				slog.String("user_id", userID),
				slog.String("range", normalizeStatsRange(dateRange)),
				slog.String("stack", string(debug.Stack())),
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
	insight, err := s.generateNutritionInsight(ctx, comp)
	if err != nil {
		logger.L().Warn("统计洞察大模型生成失败，使用兜底结果",
			logger.Err(err),
			slog.String("user_id", userID),
			slog.String("range", comp.StatsRange),
			slog.Int("recorded_days", comp.RecordedDays),
		)
		insight = fallbackStatsInsight(comp)
	}
	insight = sanitizeStatsInsightText(insight)
	today := time.Now().In(chinaTZ).Format("2006-01-02")
	if err := s.repo.UpsertInsightCache(ctx, userID, comp.StatsRange, today, comp.DataFingerprint, insight); err != nil {
		return nil, err
	}
	if s.creditGuard != nil && creditsInfo != nil {
		sourceKey := fmt.Sprintf("stats_insight:%s:%s:%d", comp.StatsRange, today, count+1)
		if err := s.creditGuard.ConsumeEarnedCreditsAfterSuccess(ctx, userID, creditsInfo, statsInsightCreditCost, "stats_insight_reward_spend", sourceKey, map[string]any{
			"range":          comp.StatsRange,
			"generated_date": today,
		}); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"analysis_summary":                insight,
		"analysis_summary_generated_date": today,
		"analysis_summary_needs_refresh":  false,
		"analysis_summary_daily_limit":    statsInsightDailyLimit,
		"analysis_summary_used_today":     int(count) + 1,
	}, nil
}

func hasEnoughStatsInsightData(comp *statsComputation) bool {
	return comp != nil && comp.RecordedDays >= statsInsightMinRecordDays
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
	byMeal := initMealCalories()
	dailyCal := make(map[string]float64)

	for _, r := range records {
		totalCal += r.TotalCalories
		totalProtein += r.TotalProtein
		totalCarbs += r.TotalCarbs
		totalFat += r.TotalFat
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
	dataFingerprint := fmt.Sprintf("%.0f_%.1f_%d_%.1f_%.1f_%.1f_%s", totalCal, avgCalPerDay, recordedDays, pctP, pctC, pctF, statsProfileFingerprint(user))

	return &statsComputation{
		StatsRange:        statsRange,
		StartDate:         startDate,
		EndDate:           endDate,
		User:              user,
		TDEE:              tdee,
		StreakDays:        streakDays,
		TotalCalories:     totalCal,
		AvgCaloriesPerDay: avgCalPerDay,
		CalSurplusDeficit: calSurplusDeficit,
		TotalProtein:      totalProtein,
		TotalCarbs:        totalCarbs,
		TotalFat:          totalFat,
		ByMeal:            byMeal,
		DailyCalories:     buildDailyList(startUTC, endUTC, dailyCal),
		RecordedDaily:     buildRecordedDailyList(dailyCal),
		MacroPercent:      macroPercent,
		RecordedDays:      recordedDays,
		DataFingerprint:   dataFingerprint,
		BodyMetrics:       bodyMetricsSummary,
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

func (s *StatsService) generateNutritionInsight(ctx context.Context, comp *statsComputation) (string, error) {
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
		return fallbackStatsInsight(comp), nil
	}

	prompt := buildNutritionInsightPrompt(comp)
	var lastErr error
	var retryFeedback string
	for attempt := 0; attempt < statsInsightMaxAttempts; attempt++ {
		content, err := s.requestNutritionInsight(ctx, baseURL, apiKey, model, prompt, retryFeedback)
		if err != nil {
			lastErr = err
			break
		}
		if term := findStatsInsightForbiddenIdentityTerm(content); term != "" {
			lastErr = fmt.Errorf("DeepSeek 输出包含禁用身份措辞: %s", term)
			retryFeedback = fmt.Sprintf("上一次输出包含禁用身份措辞“%s”。请重新生成全文：不要自称任何身份，不要出现“专业营养师”“专业的营养师”“注册营养师”“持证营养师”“饮食行为研究员”等说法，也不要用相近表达暗示自己具备执业资质。", term)
			continue
		}
		sanitized := sanitizeStatsInsightText(content)
		return sanitized, nil
	}
	if lastErr != nil {
		return "", lastErr
	}
	return "", fmt.Errorf("DeepSeek 返回了空响应")
}

func (s *StatsService) requestNutritionInsight(ctx context.Context, baseURL, apiKey, model, prompt, retryFeedback string) (string, error) {
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
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("DeepSeek API 错误: %d %s", resp.StatusCode, extractDeepSeekError(respBody))
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("DeepSeek 返回了空响应")
	}
	if strings.EqualFold(strings.TrimSpace(parsed.Choices[0].FinishReason), "length") {
		return "", fmt.Errorf("DeepSeek 输出因 max_tokens 截断")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if content == "" {
		return "", fmt.Errorf("DeepSeek 返回了空响应")
	}
	return content, nil
}

func sanitizeStatsInsightText(content string) string {
	text := strings.TrimSpace(content)
	if text == "" {
		return ""
	}

	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = statsInsightMarkdownHeadingPattern.ReplaceAllString(text, "")
	text = strings.ReplaceAll(text, "**", "")
	text = strings.ReplaceAll(text, "__", "")
	text = statsInsightMarkdownBulletPattern.ReplaceAllString(text, "")
	text = regexp.MustCompile("`{1,3}").ReplaceAllString(text, "")
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
1. 输出 650-900 字，分成 5 个小节，每节使用清晰短标题。
2. 必须覆盖：总体结论、热量与日常消耗估算、蛋白/碳水/脂肪结构、餐次结构与可能风险、下一步 3 条优先行动。
3. 要像研究报告一样基于数据推理，明确写出“为什么这么判断”，不要只给空泛鼓励。
4. 结合用户体重、作息、体检/病史/过敏/饮食目标等可用信息；没有数据时明确说“本期证据不足”。
5. 风险表达要谨慎：这是饮食相关风险趋势，不构成医学诊断或治疗建议。
6. 输出纯中文，不要 JSON 或代码块，直接输出正文；不要使用 Markdown 符号。
7. 严禁自我介绍或身份声明；全文不得出现“专业营养师”“专业的营养师”“注册营养师”“持证营养师”“饮食行为研究员”等措辞，也不要使用相近表达暗示具备执业资质。
`, formatStatsHealthProfile(comp.User, latestWeightFromBodyMetrics(comp.BodyMetrics)), statsText, customFocusBlock)
}

func fallbackStatsInsight(comp *statsComputation) string {
	if comp.RecordedDays == 0 {
		return "本期还没有足够的饮食记录生成完整洞察。可以先保持每日记录，积累几天后再查看趋势。"
	}
	return fmt.Sprintf(
		"本期日均摄入 %.0f 千卡，与日常消耗估算差值 %+.0f 千卡。蛋白质占比 %.1f%%，碳水 %.1f%%，脂肪 %.1f%%。连续记录 %d 天，整体节奏已经建立起来了，接下来可以继续关注餐次稳定性和蛋白质摄入质量。",
		comp.AvgCaloriesPerDay,
		comp.CalSurplusDeficit,
		comp.MacroPercent["protein"],
		comp.MacroPercent["carbs"],
		comp.MacroPercent["fat"],
		comp.StreakDays,
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
