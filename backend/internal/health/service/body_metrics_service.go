package service

import (
	"context"
	"fmt"
	"math"
	"time"

	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/health/domain"
)

var chinaTZ = time.FixedZone("Asia/Shanghai", 8*60*60)

const defaultWaterGoalMl = 2000

type BodyMetricsRepo interface {
	CreateWeightRecord(ctx context.Context, record *domain.BodyWeightRecord) error
	ListWeightRecords(ctx context.Context, userID string, startDate, endDate string) ([]domain.BodyWeightRecord, error)
	GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error)
	CreateWaterLog(ctx context.Context, log *domain.BodyWaterLog) error
	GetWaterLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.BodyWaterLog, error)
	DeleteWaterLogsByDate(ctx context.Context, userID string, recordedOn string) (int64, error)
	GetBodyMetricSettings(ctx context.Context, userID string) (*domain.BodyMetricSettings, error)
	UpsertBodyMetricSettings(ctx context.Context, settings *domain.BodyMetricSettings) error
	SumWaterByDate(ctx context.Context, userID string, recordedOn string) (int64, error)
}

type BodyMetricsService struct {
	repo BodyMetricsRepo
}

func NewBodyMetricsService(repo BodyMetricsRepo) *BodyMetricsService {
	return &BodyMetricsService{repo: repo}
}

type WeightEntry struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"`
}

type WaterDaily struct {
	Date  string `json:"date"`
	Total int    `json:"total"`
	Logs  []int  `json:"logs"`
}

type BodyMetricsSummary struct {
	Range              string        `json:"range"`
	StartDate          string        `json:"start_date"`
	EndDate            string        `json:"end_date"`
	WeightEntries      []WeightEntry `json:"weight_entries"`
	WeightTrendDaily   []WeightEntry `json:"weight_trend_daily"`
	LatestWeight       *WeightEntry  `json:"latest_weight"`
	PreviousWeight     *WeightEntry  `json:"previous_weight"`
	WeightChange       *float64      `json:"weight_change"`
	WaterGoalMl        int           `json:"water_goal_ml"`
	TodayWater         WaterDaily    `json:"today_water"`
	WaterDaily         []WaterDaily  `json:"water_daily"`
	TotalWaterMl       int           `json:"total_water_ml"`
	AvgDailyWaterMl    float64       `json:"avg_daily_water_ml"`
	WaterRecordedDays  int           `json:"water_recorded_days"`
}

func (s *BodyMetricsService) GetSummary(ctx context.Context, userID string, statsRange string) (*BodyMetricsSummary, error) {
	startDate, endDate := resolveStatsRangeDates(statsRange)
	extendedStart := time.Now().In(chinaTZ).AddDate(-2, 0, 0).Format("2006-01-02")
	extendedEnd := time.Now().In(chinaTZ).Format("2006-01-02")

	weightRows, err := s.repo.ListWeightRecords(ctx, userID, extendedStart, extendedEnd)
	if err != nil {
		return nil, err
	}

	waterLogs, err := s.repo.GetWaterLogsByDate(ctx, userID, extendedStart, extendedEnd)
	if err != nil {
		return nil, err
	}

	settings, _ := s.repo.GetBodyMetricSettings(ctx, userID)
	waterGoalMl := defaultWaterGoalMl
	if settings != nil && settings.WaterGoalMl > 0 {
		waterGoalMl = settings.WaterGoalMl
	}

	weightEntries := aggregateWeightDaily(weightRows)
	latestWeight := pickLatestWeight(weightEntries)
	previousWeight := pickPreviousWeight(weightEntries)
	weightTrendDaily := buildWeightTrendDaily(weightRows, startDate, endDate)

	var weightChange *float64
	if latestWeight != nil && previousWeight != nil {
		change := round1(latestWeight.Value - previousWeight.Value)
		weightChange = &change
	}

	waterDaily := aggregateWaterDaily(waterLogs, startDate, endDate)
	totalWaterMl := 0
	recordedDays := 0
	for _, item := range waterDaily {
		totalWaterMl += item.Total
		if item.Total > 0 {
			recordedDays++
		}
	}
	avgDailyWaterMl := 0.0
	if recordedDays > 0 {
		avgDailyWaterMl = round1(float64(totalWaterMl) / float64(recordedDays))
	}

	todayKey := time.Now().In(chinaTZ).Format("2006-01-02")
	todayWater := WaterDaily{Date: todayKey, Total: 0, Logs: []int{}}
	for _, item := range waterDaily {
		if item.Date == todayKey {
			todayWater = item
			break
		}
	}

	return &BodyMetricsSummary{
		Range:             statsRange,
		StartDate:         startDate,
		EndDate:           endDate,
		WeightEntries:     weightEntries,
		WeightTrendDaily:  weightTrendDaily,
		LatestWeight:      latestWeight,
		PreviousWeight:    previousWeight,
		WeightChange:      weightChange,
		WaterGoalMl:       waterGoalMl,
		TodayWater:        todayWater,
		WaterDaily:        waterDaily,
		TotalWaterMl:      totalWaterMl,
		AvgDailyWaterMl:   avgDailyWaterMl,
		WaterRecordedDays: recordedDays,
	}, nil
}

type SyncLocalInput struct {
	WeightEntries []LocalWeightEntry     `json:"weight_entries"`
	WaterByDate   map[string]LocalWaterDay `json:"water_by_date"`
	WaterGoalMl   *int                   `json:"water_goal_ml"`
}

type LocalWeightEntry struct {
	Date       string  `json:"date"`
	Value      float64 `json:"value"`
	ClientID   string  `json:"client_id"`
	RecordedAt string  `json:"recorded_at"`
}

type LocalWaterDay struct {
	Total int   `json:"total"`
	Logs  []int `json:"logs"`
}

func (s *BodyMetricsService) SyncLocal(ctx context.Context, userID string, input SyncLocalInput) (map[string]any, error) {
	importedWeightCount := 0
	importedWaterCount := 0

	if input.WaterGoalMl != nil && *input.WaterGoalMl > 0 {
		_ = s.repo.UpsertBodyMetricSettings(ctx, &domain.BodyMetricSettings{
			UserID:      userID,
			WaterGoalMl: *input.WaterGoalMl,
		})
	}

	if len(input.WeightEntries) > 0 {
		weightDates := make([]string, 0)
		for _, entry := range input.WeightEntries {
			if _, err := parseChinaDate(entry.Date); err == nil {
				weightDates = append(weightDates, entry.Date)
			}
		}
		if len(weightDates) > 0 {
			existingWeightRows, _ := s.repo.ListWeightRecords(ctx, userID, weightDates[0], weightDates[len(weightDates)-1])
			existingPairs := make(map[string]bool)
			existingClientIDs := make(map[string]bool)
			for _, row := range existingWeightRows {
				if row.RecordedOn != nil {
					key := fmt.Sprintf("%s_%.1f", row.RecordedOn.Format("2006-01-02"), row.WeightKg)
					existingPairs[key] = true
				}
			}
			for _, entry := range input.WeightEntries {
				recordedOn, err := parseChinaDate(entry.Date)
				if err != nil {
					continue
				}
				clientID := entry.ClientID
				if clientID == "" {
					clientID = fmt.Sprintf("legacy_%s_%.1f", entry.Date, entry.Value)
				}
				if existingClientIDs[clientID] {
					continue
				}
				pairKey := fmt.Sprintf("%s_%.1f", entry.Date, entry.Value)
				if existingPairs[pairKey] {
					continue
				}
				now := time.Now().UTC()
				record := &domain.BodyWeightRecord{
					UserID:     userID,
					WeightKg:   round1(entry.Value),
					RecordedOn: &recordedOn,
					CreatedAt:  &now,
				}
				if err := s.repo.CreateWeightRecord(ctx, record); err == nil {
					existingClientIDs[clientID] = true
					existingPairs[pairKey] = true
					importedWeightCount++
				}
			}
		}
	}

	if len(input.WaterByDate) > 0 {
		waterDates := make([]string, 0, len(input.WaterByDate))
		for dateKey := range input.WaterByDate {
			if _, err := parseChinaDate(dateKey); err == nil {
				waterDates = append(waterDates, dateKey)
			}
		}
		if len(waterDates) > 0 {
			existingWaterLogs, _ := s.repo.GetWaterLogsByDate(ctx, userID, waterDates[0], waterDates[len(waterDates)-1])
			existingDates := make(map[string]bool)
			for _, log := range existingWaterLogs {
				if log.RecordedOn != nil {
					existingDates[log.RecordedOn.Format("2006-01-02")] = true
				}
			}
			for dateKey, day := range input.WaterByDate {
				if _, err := parseChinaDate(dateKey); err != nil {
					continue
				}
				if existingDates[dateKey] {
					continue
				}
				logs := make([]int, 0)
				for _, amount := range day.Logs {
					if amount > 0 {
						logs = append(logs, amount)
					}
				}
				if len(logs) == 0 && day.Total > 0 {
					logs = []int{day.Total}
				}
				for _, amount := range logs {
					now := time.Now().UTC()
					recordedOn, _ := parseChinaDate(dateKey)
					log := &domain.BodyWaterLog{
						UserID:     userID,
						AmountMl:   amount,
						RecordedOn: &recordedOn,
						CreatedAt:  &now,
					}
					if err := s.repo.CreateWaterLog(ctx, log); err == nil {
						importedWaterCount++
					}
				}
			}
		}
	}

	return map[string]any{
		"message":               "本地身体指标已同步",
		"imported_weight_count": importedWeightCount,
		"imported_water_count":  importedWaterCount,
	}, nil
}

func (s *BodyMetricsService) AddWaterLog(ctx context.Context, userID string, amountMl int, recordedOn string) (map[string]any, error) {
	if amountMl <= 0 || amountMl > 5000 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "amount_ml 不合法", HTTPStatus: 400}
	}
	if recordedOn == "" {
		recordedOn = time.Now().In(chinaTZ).Format("2006-01-02")
	}
	now := time.Now().UTC()
	log := &domain.BodyWaterLog{
		UserID:     userID,
		AmountMl:   amountMl,
		RecordedOn: func() *time.Time { t, _ := parseChinaDate(recordedOn); return &t }(),
		CreatedAt:  &now,
	}
	if err := s.repo.CreateWaterLog(ctx, log); err != nil {
		return nil, err
	}
	return map[string]any{
		"message": "喝水已记录",
		"item": map[string]any{
			"id":        log.ID,
			"date":      recordedOn,
			"amount_ml": amountMl,
		},
	}, nil
}

func (s *BodyMetricsService) ResetWaterLogs(ctx context.Context, userID string, recordedOn string) (map[string]any, error) {
	if recordedOn == "" {
		recordedOn = time.Now().In(chinaTZ).Format("2006-01-02")
	}
	deletedCount, err := s.repo.DeleteWaterLogsByDate(ctx, userID, recordedOn)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"message":       "已清空当日喝水记录",
		"deleted_count": deletedCount,
		"date":          recordedOn,
	}, nil
}

func (s *BodyMetricsService) SaveWeightRecord(ctx context.Context, userID string, weightKg float64, recordedOn string) (map[string]any, error) {
	if weightKg < 20 || weightKg > 300 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "weight_kg 不合法", HTTPStatus: 400}
	}
	if recordedOn == "" {
		recordedOn = time.Now().In(chinaTZ).Format("2006-01-02")
	}
	now := time.Now().UTC()
	record := &domain.BodyWeightRecord{
		UserID:     userID,
		WeightKg:   round1(weightKg),
		RecordedOn: func() *time.Time { t, _ := parseChinaDate(recordedOn); return &t }(),
		CreatedAt:  &now,
	}
	if err := s.repo.CreateWeightRecord(ctx, record); err != nil {
		return nil, err
	}
	return map[string]any{
		"message": "体重已保存",
		"item": map[string]any{
			"id":         record.ID,
			"date":       recordedOn,
			"weight_kg":  round1(weightKg),
		},
	}, nil
}

// Helpers

func resolveStatsRangeDates(statsRange string) (string, string) {
	now := time.Now().In(chinaTZ)
	endDate := now.Format("2006-01-02")
	var startDate string
	if statsRange == "week" {
		startDate = now.AddDate(0, 0, -6).Format("2006-01-02")
	} else {
		startDate = now.AddDate(0, 0, -29).Format("2006-01-02")
	}
	return startDate, endDate
}

func parseChinaDate(date string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02", date, chinaTZ)
}

func aggregateWeightDaily(rows []domain.BodyWeightRecord) []WeightEntry {
	seen := make(map[string]bool)
	entries := make([]WeightEntry, 0)
	for _, row := range rows {
		if row.RecordedOn == nil {
			continue
		}
		dateKey := row.RecordedOn.Format("2006-01-02")
		if seen[dateKey] {
			continue
		}
		seen[dateKey] = true
		entries = append(entries, WeightEntry{
			Date:  dateKey,
			Value: round1(row.WeightKg),
		})
	}
	return entries
}

func pickLatestWeight(entries []WeightEntry) *WeightEntry {
	if len(entries) == 0 {
		return nil
	}
	latest := entries[len(entries)-1]
	return &latest
}

func pickPreviousWeight(entries []WeightEntry) *WeightEntry {
	if len(entries) < 2 {
		return nil
	}
	prev := entries[len(entries)-2]
	return &prev
}

func buildWeightTrendDaily(rows []domain.BodyWeightRecord, startDate, endDate string) []WeightEntry {
	start, _ := parseChinaDate(startDate)
	end, _ := parseChinaDate(endDate)
	if start.IsZero() || end.IsZero() {
		return []WeightEntry{}
	}

	// Build date -> weight map (last weight for each date)
	dateWeight := make(map[string]float64)
	for _, row := range rows {
		if row.RecordedOn == nil {
			continue
		}
		dateKey := row.RecordedOn.Format("2006-01-02")
		dateWeight[dateKey] = round1(row.WeightKg)
	}

	// Fill series with LOCF (last observation carried forward)
	var lastWeight float64
	var hasLast bool
	result := make([]WeightEntry, 0)
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dateKey := d.Format("2006-01-02")
		if w, ok := dateWeight[dateKey]; ok {
			lastWeight = w
			hasLast = true
		}
		if hasLast {
			result = append(result, WeightEntry{Date: dateKey, Value: lastWeight})
		}
	}
	return result
}

func aggregateWaterDaily(rows []domain.BodyWaterLog, startDate, endDate string) []WaterDaily {
	start, _ := parseChinaDate(startDate)
	end, _ := parseChinaDate(endDate)
	if start.IsZero() || end.IsZero() {
		return []WaterDaily{}
	}

	dateLogs := make(map[string][]int)
	for _, row := range rows {
		if row.RecordedOn == nil {
			continue
		}
		dateKey := row.RecordedOn.Format("2006-01-02")
		dateLogs[dateKey] = append(dateLogs[dateKey], row.AmountMl)
	}

	result := make([]WaterDaily, 0)
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		dateKey := d.Format("2006-01-02")
		logs := dateLogs[dateKey]
		total := 0
		for _, v := range logs {
			total += v
		}
		result = append(result, WaterDaily{
			Date:  dateKey,
			Total: total,
			Logs:  logs,
		})
	}
	return result
}

func round1(v float64) float64 {
	return math.Round(v*10) / 10
}
