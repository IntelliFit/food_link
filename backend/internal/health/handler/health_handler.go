package handler

import (
	"context"
	"strconv"
	"strings"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/health/service"
	"food_link/backend/pkg/logger"

	"github.com/gin-gonic/gin"
	"log/slog"
)

type BodyMetricsService interface {
	GetSummary(ctx context.Context, userID string, statsRange string) (*service.BodyMetricsSummary, error)
	SyncLocal(ctx context.Context, userID string, input service.SyncLocalInput) (map[string]any, error)
	AddWaterLog(ctx context.Context, userID string, amountMl int, recordedOn string) (map[string]any, error)
	ResetWaterLogs(ctx context.Context, userID string, recordedOn string) (map[string]any, error)
	DeleteWaterLog(ctx context.Context, userID string, logID string) (map[string]any, error)
	SaveWeightRecord(ctx context.Context, userID string, weightKg float64, recordedOn string) (map[string]any, error)
	DeleteWeightRecord(ctx context.Context, userID string, recordID string) (map[string]any, error)
}

type BodyMetricsServiceWithMeta interface {
	SaveWeightRecordWithMeta(ctx context.Context, userID string, weightKg float64, recordedOn string, clientID string, sourceType string) (map[string]any, error)
}

type ExerciseService interface {
	GetDailyCalories(ctx context.Context, userID string, date string) (map[string]any, error)
	ListLogs(ctx context.Context, userID string, date string) (map[string]any, error)
	CreateLog(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error)
	EstimateCalories(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error)
	DeleteLog(ctx context.Context, userID, logID string) error
	UpdateLog(ctx context.Context, userID, logID, exerciseDesc, imageURL, date string, caloriesBurned *float64) error
}

type ExerciseServiceWithRange interface {
	ListLogsByRange(ctx context.Context, userID string, date string, startDate string, endDate string) (map[string]any, error)
	CreateLogWithDate(ctx context.Context, userID string, exerciseDesc string, date string, imageURL string) (map[string]any, error)
}

type StatsService interface {
	GetSummary(ctx context.Context, userID string, statsRange string, tdee int, streakDays int) (*service.StatsSummary, error)
	GetCalendarMonth(ctx context.Context, userID, month string, tdee int) (*service.CalendarMonthSummary, error)
	GenerateInsight(ctx context.Context, userID string, dateRange string, tdee int, streakDays int) (map[string]any, error)
	SaveInsight(ctx context.Context, userID string, content string, dateRange string) error
	GenerateCustomFocusCard(ctx context.Context, userID, statsRange, focusID string) (*service.RiskCard, map[string]any, error)
	GenerateDietRecommendation(ctx context.Context, userID string, input service.DietRecommendationInput) (*service.DietRecommendationResult, error)
}

// GET /api/stats/calendar
func (h *HealthHandler) GetStatsCalendar(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	month := strings.TrimSpace(c.Query("month"))
	logger.Info(c.Request.Context(), "月历统计请求进入", logger.UserID(userID), slog.String("month", month))
	summary, err := h.stats.GetCalendarMonth(c.Request.Context(), userID, month, 2000)
	if err != nil {
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "月历统计请求完成", logger.UserID(userID), slog.String("month", month), slog.Int("day_count", len(summary.Days)))
	response.Success(c, summary)
}

type HealthHandler struct {
	bodyMetrics BodyMetricsService
	exercise    ExerciseService
	stats       StatsService
}

func NewHealthHandler(
	bodyMetrics BodyMetricsService,
	exercise ExerciseService,
	stats StatsService,
) *HealthHandler {
	return &HealthHandler{
		bodyMetrics: bodyMetrics,
		exercise:    exercise,
		stats:       stats,
	}
}

// GET /api/body-metrics/summary
func (h *HealthHandler) GetBodyMetricsSummary(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	statsRange := c.DefaultQuery("range", "month")
	if statsRange != "week" && statsRange != "month" {
		statsRange = "month"
	}
	summary, err := h.bodyMetrics.GetSummary(c.Request.Context(), userID, statsRange)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"range":               statsRange,
		"start_date":          summary.StartDate,
		"end_date":            summary.EndDate,
		"weight_entries":      summary.WeightEntries,
		"weight_trend_daily":  summary.WeightTrendDaily,
		"latest_weight":       summary.LatestWeight,
		"previous_weight":     summary.PreviousWeight,
		"weight_change":       summary.WeightChange,
		"water_goal_ml":       summary.WaterGoalMl,
		"today_water":         summary.TodayWater,
		"water_daily":         summary.WaterDaily,
		"total_water_ml":      summary.TotalWaterMl,
		"avg_daily_water_ml":  summary.AvgDailyWaterMl,
		"water_recorded_days": summary.WaterRecordedDays,
	})
}

// POST /api/body-metrics/sync-local
func (h *HealthHandler) SyncLocalBodyMetrics(c *gin.Context) {
	var body struct {
		WeightEntries []service.LocalWeightEntry       `json:"weight_entries"`
		WaterByDate   map[string]service.LocalWaterDay `json:"water_by_date"`
		WaterGoalMl   *int                             `json:"water_goal_ml"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.bodyMetrics.SyncLocal(c.Request.Context(), userID, service.SyncLocalInput{
		WeightEntries: body.WeightEntries,
		WaterByDate:   body.WaterByDate,
		WaterGoalMl:   body.WaterGoalMl,
	})
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/body-metrics/water
func (h *HealthHandler) SaveBodyWaterLog(c *gin.Context) {
	var body struct {
		AmountMl   int    `json:"amount_ml"`
		RecordedOn string `json:"recorded_on"`
		Date       string `json:"date"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	recordedOn := firstNonEmpty(body.Date, body.RecordedOn)
	result, err := h.bodyMetrics.AddWaterLog(c.Request.Context(), userID, body.AmountMl, recordedOn)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/body-metrics/water/reset
func (h *HealthHandler) ResetBodyWaterLogs(c *gin.Context) {
	var body struct {
		RecordedOn string `json:"recorded_on"`
		Date       string `json:"date"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	recordedOn := firstNonEmpty(body.Date, body.RecordedOn)
	result, err := h.bodyMetrics.ResetWaterLogs(c.Request.Context(), userID, recordedOn)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// DELETE /api/body-metrics/water/:log_id
func (h *HealthHandler) DeleteBodyWaterLog(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	logID := c.Param("log_id")
	result, err := h.bodyMetrics.DeleteWaterLog(c.Request.Context(), userID, logID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/body-metrics/weight
func (h *HealthHandler) SaveBodyWeightRecord(c *gin.Context) {
	var body struct {
		WeightKg   float64 `json:"weight_kg"`
		Value      float64 `json:"value"`
		RecordedOn string  `json:"recorded_on"`
		Date       string  `json:"date"`
		ClientID   string  `json:"client_id"`
		SourceType string  `json:"source_type"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	weightKg := body.WeightKg
	if weightKg == 0 {
		weightKg = body.Value
	}
	recordedOn := firstNonEmpty(body.Date, body.RecordedOn)
	var result map[string]any
	var err error
	if svc, ok := h.bodyMetrics.(BodyMetricsServiceWithMeta); ok {
		result, err = svc.SaveWeightRecordWithMeta(c.Request.Context(), userID, weightKg, recordedOn, body.ClientID, body.SourceType)
	} else {
		result, err = h.bodyMetrics.SaveWeightRecord(c.Request.Context(), userID, weightKg, recordedOn)
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// DELETE /api/body-metrics/weight/:record_id
func (h *HealthHandler) DeleteBodyWeightRecord(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	recordID := c.Param("record_id")
	result, err := h.bodyMetrics.DeleteWeightRecord(c.Request.Context(), userID, recordID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// GET /api/stats/summary
func (h *HealthHandler) GetStatsSummary(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	statsRange := c.DefaultQuery("range", "week")
	if statsRange != "7d" && statsRange != "30d" && statsRange != "90d" && statsRange != "week" && statsRange != "month" {
		statsRange = "week"
	}

	// For simplified migration, use default TDEE and streakDays
	tdee := 2000
	streakDays := 0

	summary, err := h.stats.GetSummary(c.Request.Context(), userID, statsRange, tdee, streakDays)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"range":                           summary.Range,
		"start_date":                      summary.StartDate,
		"end_date":                        summary.EndDate,
		"tdee":                            summary.TDEE,
		"streak_days":                     summary.StreakDays,
		"recorded_days":                   summary.RecordedDays,
		"total_calories":                  summary.TotalCalories,
		"avg_calories_per_day":            summary.AvgCaloriesPerDay,
		"cal_surplus_deficit":             summary.CalSurplusDeficit,
		"total_protein":                   summary.TotalProtein,
		"total_carbs":                     summary.TotalCarbs,
		"total_fat":                       summary.TotalFat,
		"by_meal":                         summary.ByMeal,
		"daily_calories":                  summary.DailyCalories,
		"macro_percent":                   summary.MacroPercent,
		"analysis_summary":                summary.AnalysisSummary,
		"analysis_summary_generated_date": summary.AnalysisSummaryGeneratedDate,
		"analysis_summary_needs_refresh":  summary.AnalysisSummaryNeedsRefresh,
		"analysis_summary_daily_limit":    summary.AnalysisSummaryDailyLimit,
		"analysis_summary_used_today":     summary.AnalysisSummaryUsedToday,
		"body_metrics":                    summary.BodyMetrics,
		"health_index":                    summary.HealthIndex,
	})
}

// POST /api/stats/insight/generate
func (h *HealthHandler) GenerateStatsInsight(c *gin.Context) {
	var body struct {
		Range     string `json:"range"`
		DateRange string `json:"date_range"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	tdee := 2000
	streakDays := 0
	statsRange := body.Range
	if statsRange == "" {
		statsRange = body.DateRange
	}
	result, err := h.stats.GenerateInsight(c.Request.Context(), userID, statsRange, tdee, streakDays)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/stats/insight/save
func (h *HealthHandler) SaveStatsInsight(c *gin.Context) {
	var body struct {
		Range           string `json:"range"`
		DateRange       string `json:"date_range"`
		Content         string `json:"content"`
		AnalysisSummary string `json:"analysis_summary"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	content := body.Content
	if content == "" {
		content = body.AnalysisSummary
	}
	statsRange := body.Range
	if statsRange == "" {
		statsRange = body.DateRange
	}
	if err := h.stats.SaveInsight(c.Request.Context(), userID, content, statsRange); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "ok"})
}

// POST /api/stats/custom-focus/generate
func (h *HealthHandler) GenerateCustomFocusCard(c *gin.Context) {
	var body struct {
		Range   string `json:"range"`
		FocusID string `json:"focus_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	card, meta, err := h.stats.GenerateCustomFocusCard(c.Request.Context(), userID, body.Range, body.FocusID)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{
		"card":                         card,
		"custom_focus_daily_limit":     meta["custom_focus_daily_limit"],
		"custom_focus_used_today":      meta["custom_focus_used_today"],
		"custom_focus_remaining_today": meta["custom_focus_remaining_today"],
	})
}

// POST /api/diet/recommendations
func (h *HealthHandler) GenerateDietRecommendation(c *gin.Context) {
	var body service.DietRecommendationInput
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logger.Info(c.Request.Context(), "饮食推荐请求进入",
		slog.String("user_id", userID),
		slog.String("scene", body.Scene),
		slog.String("date", body.Date),
	)
	result, err := h.stats.GenerateDietRecommendation(c.Request.Context(), userID, body)
	if err != nil {
		logger.Warn(c.Request.Context(), "饮食推荐生成失败",
			logger.Err(err),
			slog.String("user_id", userID),
			slog.String("scene", body.Scene),
		)
		response.Error(c, err)
		return
	}
	logger.Info(c.Request.Context(), "饮食推荐请求完成",
		slog.String("user_id", userID),
		slog.String("scene", result.Scene),
		slog.String("generated_by", result.GeneratedBy),
		slog.Int("recommendation_count", len(result.Recommendations)),
	)
	response.Success(c, result)
}

// GET /api/exercise-calories/daily
func (h *HealthHandler) GetExerciseCaloriesDaily(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	date := c.Query("date")
	result, err := h.exercise.GetDailyCalories(c.Request.Context(), userID, date)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// GET /api/exercise-logs
func (h *HealthHandler) GetExerciseLogs(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	date := c.Query("date")
	startDate := c.Query("start_date")
	endDate := c.Query("end_date")
	var result map[string]any
	var err error
	if svc, ok := h.exercise.(ExerciseServiceWithRange); ok {
		result, err = svc.ListLogsByRange(c.Request.Context(), userID, date, startDate, endDate)
	} else {
		result, err = h.exercise.ListLogs(c.Request.Context(), userID, date)
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/exercise-logs
func (h *HealthHandler) CreateExerciseLog(c *gin.Context) {
	var body struct {
		ExerciseDesc string `json:"exercise_desc" form:"exercise_desc"`
		Date         string `json:"date" form:"date"`
		ImageURL     string `json:"image_url" form:"image_url"`
	}
	if strings.Contains(strings.ToLower(c.GetHeader("Content-Type")), "application/x-www-form-urlencoded") {
		if err := c.ShouldBind(&body); err != nil {
			response.Error(c, err)
			return
		}
	} else {
		if err := c.ShouldBindJSON(&body); err != nil {
			response.Error(c, err)
			return
		}
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	var result map[string]any
	var err error
	if svc, ok := h.exercise.(ExerciseServiceWithRange); ok {
		result, err = svc.CreateLogWithDate(c.Request.Context(), userID, body.ExerciseDesc, body.Date, body.ImageURL)
	} else {
		result, err = h.exercise.CreateLog(c.Request.Context(), userID, body.ExerciseDesc)
	}
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/exercise-logs/estimate-calories
func (h *HealthHandler) EstimateExerciseCalories(c *gin.Context) {
	var body struct {
		ExerciseDesc string `json:"exercise_desc"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.exercise.EstimateCalories(c.Request.Context(), userID, body.ExerciseDesc)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// PUT /api/exercise-logs/{log_id}
func (h *HealthHandler) UpdateExerciseLog(c *gin.Context) {
	var body struct {
		ExerciseDesc   string   `json:"exercise_desc"`
		Date           string   `json:"date"`
		ImageURL       string   `json:"image_url"`
		CaloriesBurned *float64 `json:"calories_burned"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	logID := c.Param("log_id")
	if err := h.exercise.UpdateLog(c.Request.Context(), userID, logID, body.ExerciseDesc, body.ImageURL, body.Date, body.CaloriesBurned); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已更新"})
}

// DELETE /api/exercise-logs/{log_id}
func (h *HealthHandler) DeleteExerciseLog(c *gin.Context) {
	userID := c.GetString(authmw.ContextUserIDKey)
	logID := c.Param("log_id")
	if err := h.exercise.DeleteLog(c.Request.Context(), userID, logID); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "已删除"})
}

func parseIntOrDefault(s string, def int) int {
	if s == "" {
		return def
	}
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
