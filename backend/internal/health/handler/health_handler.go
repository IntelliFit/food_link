package handler

import (
	"context"
	"strconv"

	authmw "food_link/backend/internal/auth"
	"food_link/backend/internal/common/response"
	"food_link/backend/internal/health/service"

	"github.com/gin-gonic/gin"
)

type BodyMetricsService interface {
	GetSummary(ctx context.Context, userID string, statsRange string) (*service.BodyMetricsSummary, error)
	SyncLocal(ctx context.Context, userID string, input service.SyncLocalInput) (map[string]any, error)
	AddWaterLog(ctx context.Context, userID string, amountMl int, recordedOn string) (map[string]any, error)
	ResetWaterLogs(ctx context.Context, userID string, recordedOn string) (map[string]any, error)
	SaveWeightRecord(ctx context.Context, userID string, weightKg float64, recordedOn string) (map[string]any, error)
}

type ExerciseService interface {
	GetDailyCalories(ctx context.Context, userID string, date string) (map[string]any, error)
	ListLogs(ctx context.Context, userID string, date string) (map[string]any, error)
	CreateLog(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error)
	EstimateCalories(ctx context.Context, userID string, exerciseDesc string) (map[string]any, error)
	DeleteLog(ctx context.Context, userID, logID string) error
}

type StatsService interface {
	GetSummary(ctx context.Context, userID string, statsRange string, tdee int, streakDays int) (*service.StatsSummary, error)
	GenerateInsight(ctx context.Context, userID string, dateRange string, tdee int, streakDays int) (map[string]any, error)
	SaveInsight(ctx context.Context, userID string, content string, dateRange string) error
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
		WeightEntries []service.LocalWeightEntry     `json:"weight_entries"`
		WaterByDate   map[string]service.LocalWaterDay `json:"water_by_date"`
		WaterGoalMl   *int                           `json:"water_goal_ml"`
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
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.bodyMetrics.AddWaterLog(c.Request.Context(), userID, body.AmountMl, body.RecordedOn)
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
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.bodyMetrics.ResetWaterLogs(c.Request.Context(), userID, body.RecordedOn)
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
		RecordedOn string  `json:"recorded_on"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.bodyMetrics.SaveWeightRecord(c.Request.Context(), userID, body.WeightKg, body.RecordedOn)
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
		"range":                         summary.Range,
		"start_date":                    summary.StartDate,
		"end_date":                      summary.EndDate,
		"tdee":                          summary.TDEE,
		"streak_days":                   summary.StreakDays,
		"total_calories":                summary.TotalCalories,
		"avg_calories_per_day":          summary.AvgCaloriesPerDay,
		"cal_surplus_deficit":           summary.CalSurplusDeficit,
		"total_protein":                 summary.TotalProtein,
		"total_carbs":                   summary.TotalCarbs,
		"total_fat":                     summary.TotalFat,
		"by_meal":                       summary.ByMeal,
		"daily_calories":                summary.DailyCalories,
		"macro_percent":                 summary.MacroPercent,
		"analysis_summary":              summary.AnalysisSummary,
		"analysis_summary_generated_date": summary.AnalysisSummaryGeneratedDate,
		"analysis_summary_needs_refresh": summary.AnalysisSummaryNeedsRefresh,
		"body_metrics":                  summary.BodyMetrics,
	})
}

// POST /api/stats/insight/generate
func (h *HealthHandler) GenerateStatsInsight(c *gin.Context) {
	var body struct {
		DateRange string `json:"date_range"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	tdee := 2000
	streakDays := 0
	result, err := h.stats.GenerateInsight(c.Request.Context(), userID, body.DateRange, tdee, streakDays)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/stats/insight/save
func (h *HealthHandler) SaveStatsInsight(c *gin.Context) {
	var body struct {
		Content   string `json:"content"`
		DateRange string `json:"date_range"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	if err := h.stats.SaveInsight(c.Request.Context(), userID, body.Content, body.DateRange); err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, gin.H{"message": "ok"})
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
	result, err := h.exercise.ListLogs(c.Request.Context(), userID, date)
	if err != nil {
		response.Error(c, err)
		return
	}
	response.Success(c, result)
}

// POST /api/exercise-logs
func (h *HealthHandler) CreateExerciseLog(c *gin.Context) {
	var body struct {
		ExerciseDesc string `json:"exercise_desc"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Error(c, err)
		return
	}
	userID := c.GetString(authmw.ContextUserIDKey)
	result, err := h.exercise.CreateLog(c.Request.Context(), userID, body.ExerciseDesc)
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
