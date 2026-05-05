package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
)

type StatsRepo interface {
	GetFoodRecordsForDateRange(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]domain.FoodRecord, error)
	GetDistinctRecordDays(ctx context.Context, userID string, startUTC, endUTC time.Time) (int64, error)
	SaveInsight(ctx context.Context, insight *domain.StatsInsight) error
	GetLatestInsight(ctx context.Context, userID string, dateRange string) (*domain.StatsInsight, error)
}

type BodyMetricsSummaryProvider interface {
	GetSummary(ctx context.Context, userID string, statsRange string) (*BodyMetricsSummary, error)
}

type StatsService struct {
	repo       StatsRepo
	bodyMetrics BodyMetricsSummaryProvider
}

func NewStatsService(repo StatsRepo, bodyMetrics BodyMetricsSummaryProvider) *StatsService {
	return &StatsService{repo: repo, bodyMetrics: bodyMetrics}
}

type DailyCalories struct {
	Date     string  `json:"date"`
	Calories float64 `json:"calories"`
}

type StatsSummary struct {
	Range                       string            `json:"range"`
	StartDate                   string            `json:"start_date"`
	EndDate                     string            `json:"end_date"`
	TDEE                        int               `json:"tdee"`
	StreakDays                  int               `json:"streak_days"`
	TotalCalories               float64           `json:"total_calories"`
	AvgCaloriesPerDay           float64           `json:"avg_calories_per_day"`
	CalSurplusDeficit           float64           `json:"cal_surplus_deficit"`
	TotalProtein                float64           `json:"total_protein"`
	TotalCarbs                  float64           `json:"total_carbs"`
	TotalFat                    float64           `json:"total_fat"`
	ByMeal                      map[string]float64 `json:"by_meal"`
	DailyCalories               []DailyCalories   `json:"daily_calories"`
	MacroPercent                map[string]float64 `json:"macro_percent"`
	AnalysisSummary             string            `json:"analysis_summary"`
	AnalysisSummaryGeneratedDate *string           `json:"analysis_summary_generated_date"`
	AnalysisSummaryNeedsRefresh bool              `json:"analysis_summary_needs_refresh"`
	BodyMetrics                 *BodyMetricsSummary `json:"body_metrics"`
}

func (s *StatsService) GetSummary(ctx context.Context, userID string, statsRange string, tdee int, streakDays int) (*StatsSummary, error) {
	if statsRange != "week" && statsRange != "month" && statsRange != "7d" && statsRange != "30d" && statsRange != "90d" {
		statsRange = "week"
	}

	startDate, endDate, startUTC, endUTC := resolveStatsRangeUTC(statsRange)

	records, err := s.repo.GetFoodRecordsForDateRange(ctx, userID, startUTC, endUTC)
	if err != nil {
		return nil, err
	}

	bodyMetricsSummary, _ := s.bodyMetrics.GetSummary(ctx, userID, statsRange)

	totalCal := 0.0
	totalProtein := 0.0
	totalCarbs := 0.0
	totalFat := 0.0
	byMeal := make(map[string]float64)
	dailyCal := make(map[string]float64)

	for _, r := range records {
		totalCal += r.TotalCalories
		totalProtein += r.TotalProtein
		totalCarbs += r.TotalCarbs
		totalFat += r.TotalFat
		byMeal[r.MealType] = byMeal[r.MealType] + r.TotalCalories

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

	// Build full daily list for the range
	dailyList := buildDailyList(startUTC, endUTC, dailyCal)

	dataFingerprint := fmt.Sprintf("%.0f_%.1f_%d_%.1f_%.1f_%.1f", totalCal, avgCalPerDay, recordedDays, pctP, pctC, pctF)

	insight, _ := s.repo.GetLatestInsight(ctx, userID, statsRange)
	analysisSummary := ""
	var analysisSummaryGeneratedDate *string
	needsRefresh := false
	if insight != nil {
		analysisSummary = insight.Content
		analysisSummaryGeneratedDate = &insight.DateRange
		needsRefresh = true // Simplified; real logic would compare fingerprint
		_ = dataFingerprint
	}

	return &StatsSummary{
		Range:                       statsRange,
		StartDate:                   startDate,
		EndDate:                     endDate,
		TDEE:                        tdee,
		StreakDays:                  streakDays,
		TotalCalories:               round1(totalCal),
		AvgCaloriesPerDay:           avgCalPerDay,
		CalSurplusDeficit:           calSurplusDeficit,
		TotalProtein:                round1(totalProtein),
		TotalCarbs:                  round1(totalCarbs),
		TotalFat:                    round1(totalFat),
		ByMeal:                      byMeal,
		DailyCalories:               dailyList,
		MacroPercent:                map[string]float64{"protein": pctP, "carbs": pctC, "fat": pctF},
		AnalysisSummary:             analysisSummary,
		AnalysisSummaryGeneratedDate: analysisSummaryGeneratedDate,
		AnalysisSummaryNeedsRefresh: needsRefresh,
		BodyMetrics:                 bodyMetricsSummary,
	}, nil
}

func (s *StatsService) GenerateInsight(ctx context.Context, userID string, dateRange string, tdee int, streakDays int) (map[string]any, error) {
	statsRange := dateRange
	if statsRange != "week" && statsRange != "month" {
		statsRange = "week"
	}

	startDate, endDate, startUTC, endUTC := resolveStatsRangeUTC(statsRange)
	_ = startDate
	_ = endDate

	records, err := s.repo.GetFoodRecordsForDateRange(ctx, userID, startUTC, endUTC)
	if err != nil {
		return nil, err
	}

	totalCal := 0.0
	totalProtein := 0.0
	totalCarbs := 0.0
	totalFat := 0.0
	dailyCal := make(map[string]float64)

	for _, r := range records {
		totalCal += r.TotalCalories
		totalProtein += r.TotalProtein
		totalCarbs += r.TotalCarbs
		totalFat += r.TotalFat
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

	// Stub insight generation
	insight := s.stubGenerateInsight(totalCal, avgCalPerDay, calSurplusDeficit, streakDays, pctP, pctC, pctF, dailyCal)
	return map[string]any{"analysis_summary": insight}, nil
}

func (s *StatsService) SaveInsight(ctx context.Context, userID string, content string, dateRange string) error {
	if strings.TrimSpace(content) == "" {
		return &commonerrors.AppError{Code: 10002, Message: "content 不能为空", HTTPStatus: 400}
	}
	now := time.Now().UTC()
	insight := &domain.StatsInsight{
		UserID:    userID,
		Content:   content,
		DateRange: dateRange,
		CreatedAt: &now,
	}
	return s.repo.SaveInsight(ctx, insight)
}

func (s *StatsService) stubGenerateInsight(totalCal, avgCal, surplusDeficit float64, streakDays int, pctP, pctC, pctF float64, dailyCal map[string]float64) string {
	return fmt.Sprintf(
		"本期日均摄入 %.0f 千卡，与 TDEE 差值 %+.0f 千卡。蛋白质占比 %.1f%%，碳水 %.1f%%，脂肪 %.1f%%。连续记录 %d 天，继续保持！",
		avgCal, surplusDeficit, pctP, pctC, pctF, streakDays,
	)
}

func resolveStatsRangeUTC(statsRange string) (string, string, time.Time, time.Time) {
	now := time.Now().In(chinaTZ)
	endDate := now.Format("2006-01-02")
	var daysBack int
	switch statsRange {
	case "7d", "week":
		daysBack = 6
	case "30d", "month":
		daysBack = 29
	case "90d":
		daysBack = 89
	default:
		daysBack = 6
	}
	startDate := now.AddDate(0, 0, -daysBack).Format("2006-01-02")
	startUTC, _ := parseChinaDate(startDate)
	endUTC := startUTC.AddDate(0, 0, daysBack+1)
	return startDate, endDate, startUTC.UTC(), endUTC.UTC()
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
