package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
	"food_link/backend/pkg/config"
)

type StatsRepo interface {
	GetFoodRecordsForDateRange(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]domain.FoodRecord, error)
	GetUserProfile(ctx context.Context, userID string) (*domain.StatsUserProfile, error)
	GetRecentFoodRecordDates(ctx context.Context, userID string, startUTC, endUTC time.Time) ([]string, error)
	UpsertInsightCache(ctx context.Context, userID, rangeType, generatedDate, dataFingerprint, insightText string) error
	GetCachedInsight(ctx context.Context, userID string, rangeType string, generatedDate string) (*domain.StatsInsight, error)
	GetLatestCachedInsight(ctx context.Context, userID string, rangeType string) (*domain.StatsInsight, error)
}

type BodyMetricsSummaryProvider interface {
	GetSummary(ctx context.Context, userID string, statsRange string) (*BodyMetricsSummary, error)
}

type StatsService struct {
	repo        StatsRepo
	bodyMetrics BodyMetricsSummaryProvider
	creditGuard CreditGuard
	cfg         *config.Config
	client      *http.Client
}

const statsInsightDeepSeekModel = "deepseek-v4-flash"

func NewStatsService(repo StatsRepo, bodyMetrics BodyMetricsSummaryProvider, cfg ...*config.Config) *StatsService {
	var c *config.Config
	if len(cfg) > 0 {
		c = cfg[0]
	}
	return &StatsService{
		repo:        repo,
		bodyMetrics: bodyMetrics,
		cfg:         c,
		client:      &http.Client{Timeout: 60 * time.Second},
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
	BodyMetrics                  *BodyMetricsSummary `json:"body_metrics"`
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
	cached, _ := s.repo.GetCachedInsight(ctx, userID, comp.StatsRange, today)
	if cached == nil {
		cached, _ = s.repo.GetLatestCachedInsight(ctx, userID, comp.StatsRange)
	}

	analysisSummary := ""
	var analysisSummaryGeneratedDate *string
	needsRefresh := false
	if cached != nil {
		analysisSummary = cached.InsightText
		generatedDate := cached.GeneratedDateString()
		if generatedDate != "" {
			analysisSummaryGeneratedDate = &generatedDate
		}
		needsRefresh = generatedDate != today || cached.DataFingerprint != comp.DataFingerprint
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
		BodyMetrics:                  comp.BodyMetrics,
	}, nil
}

func (s *StatsService) GenerateInsight(ctx context.Context, userID string, dateRange string, fallbackTDEE int, fallbackStreakDays int) (map[string]any, error) {
	comp, err := s.buildStatsComputation(ctx, userID, dateRange, fallbackTDEE, fallbackStreakDays)
	if err != nil {
		return nil, err
	}
	insight, err := s.generateNutritionInsight(ctx, comp)
	if err != nil {
		return nil, err
	}
	return map[string]any{"analysis_summary": insight}, nil
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
	return s.repo.UpsertInsightCache(ctx, userID, comp.StatsRange, today, comp.DataFingerprint, content)
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
	baseURL := "https://api.deepseek.com"
	model := statsInsightDeepSeekModel
	if s.cfg != nil {
		apiKey = strings.TrimSpace(s.cfg.External.DeepSeekAPIKey)
	}
	if apiKey == "" {
		return fallbackStatsInsight(comp), nil
	}

	body := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "user", "content": buildNutritionInsightPrompt(comp)},
		},
		"temperature": 0.6,
		"max_tokens":  1024,
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
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 {
		return "", fmt.Errorf("DeepSeek 返回了空响应")
	}
	content := strings.TrimSpace(parsed.Choices[0].Message.Content)
	if content == "" {
		return "", fmt.Errorf("DeepSeek 返回了空响应")
	}
	return content, nil
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
用户 TDEE：%d kcal/天
饮食目标：%s

本期数据：
- 总热量：%.0f kcal
- 日均摄入：%.0f kcal
- 日均与 TDEE 差值：%+.0f kcal（正为盈余，负为亏损）
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

	return fmt.Sprintf(`你是一位专业的营养师。请根据以下用户健康档案和饮食统计数据，生成一段 200-300 字的个性化营养洞察。

%s

%s

要求：
1. 用温暖、鼓励的语气，结合用户体质和饮食目标
2. 分析本期热量摄入与 TDEE 的关系，给出建议
3. 简要评价宏量营养素比例是否合理
4. 若有连续打卡，给予肯定
5. 如果提供了体重趋势数据，结合体重变化评价饮食计划效果
6. 输出纯中文，不要 JSON 或代码块，直接输出正文
`, formatStatsHealthProfile(comp.User, latestWeightFromBodyMetrics(comp.BodyMetrics)), statsText)
}

func fallbackStatsInsight(comp *statsComputation) string {
	if comp.RecordedDays == 0 {
		return "本期还没有足够的饮食记录生成完整洞察。可以先保持每日记录，积累几天后再查看趋势。"
	}
	return fmt.Sprintf(
		"本期日均摄入 %.0f 千卡，与 TDEE 差值 %+.0f 千卡。蛋白质占比 %.1f%%，碳水 %.1f%%，脂肪 %.1f%%。连续记录 %d 天，整体节奏已经建立起来了，接下来可以继续关注餐次稳定性和蛋白质摄入质量。",
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
	lines = append(lines, "· 活动水平："+activity)

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
		lines = append(lines, fmt.Sprintf("· 基础代谢(BMR)：%s；每日总消耗(TDEE)：%s", bmr, tdee))
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
		return "久坐"
	case "light":
		return "轻度活动"
	case "moderate":
		return "中度活动"
	case "active":
		return "高度活动"
	case "very_active":
		return "极高活动"
	default:
		return value
	}
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
