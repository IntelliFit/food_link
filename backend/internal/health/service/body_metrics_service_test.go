package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"food_link/backend/internal/health/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type mockBodyMetricsRepo struct {
	weightRecords    []domain.BodyWeightRecord
	waterLogs        []domain.BodyWaterLog
	settings         *domain.BodyMetricSettings
	userProfile      *domain.BodyMetricUserProfile
	profileUpdate    map[string]any
	waterStartDate   string
	waterEndDate     string
	waterListErr     error
	createWaterErr   error
	dailyWeightCalls int
}

type mockFoodWaterProvider struct {
	logs      []domain.BodyWaterLog
	callCount int
	err       error
}

func (m *mockFoodWaterProvider) ListDerivedFoodWaterLogs(ctx context.Context, userID, startDate, endDate string) ([]domain.BodyWaterLog, error) {
	m.callCount++
	if m.err != nil {
		return nil, m.err
	}
	recordedOn, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		return nil, err
	}
	logs := make([]domain.BodyWaterLog, len(m.logs))
	copy(logs, m.logs)
	for index := range logs {
		if logs[index].RecordedOn == nil {
			logs[index].RecordedOn = &recordedOn
		}
	}
	return logs, nil
}

func (m *mockBodyMetricsRepo) CreateWeightRecord(ctx context.Context, record *domain.BodyWeightRecord) error {
	m.weightRecords = append(m.weightRecords, *record)
	return nil
}

func (m *mockBodyMetricsRepo) ListWeightRecords(ctx context.Context, userID string, startDate, endDate string) ([]domain.BodyWeightRecord, error) {
	return m.weightRecords, nil
}

func (m *mockBodyMetricsRepo) ListDailyWeightRecords(ctx context.Context, userID string, startDate, endDate string) ([]domain.BodyWeightRecord, error) {
	m.dailyWeightCalls++
	return m.weightRecords, nil
}

func (m *mockBodyMetricsRepo) GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error) {
	if len(m.weightRecords) == 0 {
		return nil, nil
	}
	return &m.weightRecords[len(m.weightRecords)-1], nil
}

func (m *mockBodyMetricsRepo) DeleteWeightRecordByID(ctx context.Context, userID string, recordID string) (int64, error) {
	filtered := make([]domain.BodyWeightRecord, 0)
	deleted := int64(0)
	for _, record := range m.weightRecords {
		if record.UserID == userID && record.ID == recordID {
			deleted++
			continue
		}
		filtered = append(filtered, record)
	}
	m.weightRecords = filtered
	return deleted, nil
}

func (m *mockBodyMetricsRepo) CreateWaterLog(ctx context.Context, log *domain.BodyWaterLog) error {
	if m.createWaterErr != nil {
		return m.createWaterErr
	}
	m.waterLogs = append(m.waterLogs, *log)
	return nil
}

func (m *mockBodyMetricsRepo) GetWaterLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.BodyWaterLog, error) {
	m.waterStartDate = startDate
	m.waterEndDate = endDate
	if m.waterListErr != nil {
		return nil, m.waterListErr
	}
	return m.waterLogs, nil
}

func (m *mockBodyMetricsRepo) DeleteWaterLogsByDate(ctx context.Context, userID string, recordedOn string) (int64, error) {
	filtered := make([]domain.BodyWaterLog, 0)
	deleted := int64(0)
	for _, log := range m.waterLogs {
		if log.RecordedOn != nil && log.RecordedOn.Format("2006-01-02") == recordedOn && domain.IsEditableWaterSource(log.SourceType) {
			deleted++
		} else {
			filtered = append(filtered, log)
		}
	}
	m.waterLogs = filtered
	return deleted, nil
}

func (m *mockBodyMetricsRepo) DeleteWaterLogByID(ctx context.Context, userID string, logID string) (int64, error) {
	filtered := make([]domain.BodyWaterLog, 0)
	deleted := int64(0)
	for _, log := range m.waterLogs {
		if log.UserID == userID && log.ID == logID && domain.IsEditableWaterSource(log.SourceType) {
			deleted++
			continue
		}
		filtered = append(filtered, log)
	}
	m.waterLogs = filtered
	return deleted, nil
}

func (m *mockBodyMetricsRepo) GetBodyMetricSettings(ctx context.Context, userID string) (*domain.BodyMetricSettings, error) {
	return m.settings, nil
}

func (m *mockBodyMetricsRepo) UpsertBodyMetricSettings(ctx context.Context, settings *domain.BodyMetricSettings) error {
	m.settings = settings
	return nil
}

func (m *mockBodyMetricsRepo) GetUserProfile(ctx context.Context, userID string) (*domain.BodyMetricUserProfile, error) {
	return m.userProfile, nil
}

func (m *mockBodyMetricsRepo) UpdateUserProfileMetrics(ctx context.Context, userID string, updates map[string]any) error {
	m.profileUpdate = updates
	return nil
}

func TestBodyMetricsService_GetSummary(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn1 := time.Date(2024, 6, 14, 0, 0, 0, 0, time.UTC)
	recordedOn2 := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	repo.weightRecords = []domain.BodyWeightRecord{
		{UserID: "u1", WeightKg: 70.0, RecordedOn: &recordedOn1, CreatedAt: &now},
		{UserID: "u1", WeightKg: 69.5, RecordedOn: &recordedOn2, CreatedAt: &now},
	}
	repo.waterLogs = []domain.BodyWaterLog{
		{UserID: "u1", AmountMl: 250, RecordedOn: &recordedOn2, CreatedAt: &now},
		{UserID: "u1", AmountMl: 500, RecordedOn: &recordedOn2, CreatedAt: &now},
	}

	summary, err := svc.GetSummary(ctx, "u1", "week")
	require.NoError(t, err)
	assert.NotNil(t, summary)
	assert.Len(t, summary.WeightEntries, 2)
	assert.NotNil(t, summary.LatestWeight)
	assert.NotNil(t, summary.PreviousWeight)
	assert.NotNil(t, summary.WeightChange)
	assert.Equal(t, -0.5, *summary.WeightChange)
	assert.Equal(t, 1, repo.dailyWeightCalls)
	assert.Equal(t, summary.StartDate, repo.waterStartDate)
	assert.Equal(t, summary.EndDate, repo.waterEndDate)
}

func TestBodyMetricsService_GetSummaryUsesCanonicalFoodWaterAndIgnoresPersistedDerivedRows(t *testing.T) {
	today, err := time.Parse("2006-01-02", time.Now().In(chinaTZ).Format("2006-01-02"))
	require.NoError(t, err)
	repo := &mockBodyMetricsRepo{waterLogs: []domain.BodyWaterLog{
		{ID: "manual-water", UserID: "u1", AmountMl: 250, RecordedOn: &today, SourceType: "manual"},
		{ID: "legacy-food-water", UserID: "u1", AmountMl: 555, RecordedOn: &today, SourceType: domain.LegacyFoodWaterSourceType},
		{ID: "stale-food-water", UserID: "u1", AmountMl: 999, RecordedOn: &today, SourceType: "ai_food_record:record-1"},
		{ID: "duplicate-food-water", UserID: "u1", AmountMl: 999, RecordedOn: &today, SourceType: "ai_food_record:record-1"},
		{ID: "orphan-food-water", UserID: "u1", AmountMl: 777, RecordedOn: &today, SourceType: "ai_food_record:deleted-record"},
	}}
	provider := &mockFoodWaterProvider{logs: []domain.BodyWaterLog{{
		ID: "food-water:record-1", UserID: "u1", AmountMl: 180, SourceType: "ai_food_record:record-1",
	}}}
	svc := NewBodyMetricsService(repo)
	svc.ConfigureFoodWaterProvider(provider)

	summary, err := svc.GetSummary(context.Background(), "u1", "week")
	require.NoError(t, err)
	assert.Equal(t, 1, provider.callCount)
	assert.Equal(t, 430, summary.TodayWater.Total)
	require.Len(t, summary.TodayWater.LogItems, 2)
	assert.Equal(t, "manual-water", summary.TodayWater.LogItems[0].ID)
	assert.Equal(t, "food-water:record-1", summary.TodayWater.LogItems[1].ID)
	assert.Equal(t, "ai_food_record:record-1", summary.TodayWater.LogItems[1].SourceType)
}

func TestBodyMetricsService_GetSummaryContinuesWhenFoodWaterProviderFails(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	provider := &mockFoodWaterProvider{err: errors.New("database unavailable")}
	svc := NewBodyMetricsService(repo)
	svc.ConfigureFoodWaterProvider(provider)

	summary, err := svc.GetSummary(context.Background(), "u1", "week")
	require.NoError(t, err)
	require.NotNil(t, summary)
	assert.Equal(t, 1, provider.callCount)
	assert.Equal(t, 0, summary.TodayWater.Total)
}

func TestBodyMetricsService_GetSummaryUsesLatestWeightForSameDate(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	createdAt1 := time.Date(2026, 5, 9, 7, 35, 40, 0, time.UTC)
	createdAt2 := time.Date(2026, 5, 9, 7, 35, 52, 0, time.UTC)
	createdAt3 := time.Date(2026, 5, 9, 7, 36, 0, 0, time.UTC)
	recordedOn1 := time.Date(2026, 5, 8, 0, 0, 0, 0, time.UTC)
	recordedOn2 := time.Date(2026, 5, 9, 0, 0, 0, 0, time.UTC)
	repo.weightRecords = []domain.BodyWeightRecord{
		{UserID: "u1", WeightKg: 47.5, RecordedOn: &recordedOn1, CreatedAt: &createdAt1},
		{UserID: "u1", WeightKg: 47.5, RecordedOn: &recordedOn2, CreatedAt: &createdAt1},
		{UserID: "u1", WeightKg: 47.5, RecordedOn: &recordedOn2, CreatedAt: &createdAt2},
		{UserID: "u1", WeightKg: 47.4, RecordedOn: &recordedOn2, CreatedAt: &createdAt3},
	}

	summary, err := svc.GetSummary(ctx, "u1", "week")
	require.NoError(t, err)
	require.NotNil(t, summary.LatestWeight)
	require.NotNil(t, summary.PreviousWeight)
	assert.Len(t, summary.WeightEntries, 2)
	assert.Equal(t, "2026-05-09", summary.LatestWeight.Date)
	assert.Equal(t, 47.4, summary.LatestWeight.Value)
	assert.Equal(t, 47.5, summary.PreviousWeight.Value)
	require.NotNil(t, summary.WeightChange)
	assert.Equal(t, -0.1, *summary.WeightChange)
}

func TestBodyMetricsService_AddWaterLog(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	result, err := svc.AddWaterLog(ctx, "u1", 300, "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, "喝水已记录", result["message"])
	item, ok := result["item"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "manual", item["source_type"])
	assert.Len(t, repo.waterLogs, 1)
	assert.Equal(t, 300, repo.waterLogs[0].AmountMl)
	require.NotNil(t, repo.waterLogs[0].RecordedOn)
	assert.Equal(t, "2024-06-15", repo.waterLogs[0].RecordedOn.UTC().Format("2006-01-02"))
}

func TestBodyMetricsService_ResetWaterLogs(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	now := time.Now().UTC()
	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	repo.waterLogs = []domain.BodyWaterLog{
		{ID: "manual-water", UserID: "u1", AmountMl: 250, RecordedOn: &recordedOn, SourceType: "manual", CreatedAt: &now},
		{ID: "food-water", UserID: "u1", AmountMl: 180, RecordedOn: &recordedOn, SourceType: "ai_food_record:record-1", CreatedAt: &now},
		{ID: "legacy-food-water", UserID: "u1", AmountMl: 90, RecordedOn: &recordedOn, SourceType: domain.LegacyFoodWaterSourceType, CreatedAt: &now},
	}

	result, err := svc.ResetWaterLogs(ctx, "u1", "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, int64(1), result["deleted_count"])
	assert.Equal(t, "已清空当日手动饮水记录", result["message"])
	require.Len(t, repo.waterLogs, 2)
	assert.ElementsMatch(t, []string{"food-water", "legacy-food-water"}, []string{repo.waterLogs[0].ID, repo.waterLogs[1].ID})
}

func TestBodyMetricsService_DeleteWaterLog(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	repo.waterLogs = []domain.BodyWaterLog{
		{ID: "wl1", UserID: "u1", AmountMl: 250, RecordedOn: &recordedOn, SourceType: "manual"},
		{ID: "wl2", UserID: "u1", AmountMl: 500, RecordedOn: &recordedOn, SourceType: domain.ImportedWaterSourceType},
		{ID: "food-water", UserID: "u1", AmountMl: 180, RecordedOn: &recordedOn, SourceType: "ai_food_record:record-1"},
		{ID: "legacy-food-water", UserID: "u1", AmountMl: 90, RecordedOn: &recordedOn, SourceType: domain.LegacyFoodWaterSourceType},
	}

	result, err := svc.DeleteWaterLog(ctx, "u1", "wl1")
	require.NoError(t, err)
	assert.Equal(t, "喝水记录已删除", result["message"])
	assert.Len(t, repo.waterLogs, 3)
	assert.Equal(t, "wl2", repo.waterLogs[0].ID)

	_, err = svc.DeleteWaterLog(ctx, "u1", "food-water")
	require.Error(t, err)
	assert.Len(t, repo.waterLogs, 3)

	_, err = svc.DeleteWaterLog(ctx, "u1", "legacy-food-water")
	require.Error(t, err)
	assert.Len(t, repo.waterLogs, 3)
}

func TestBodyMetricsService_SaveWeightRecord(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	result, err := svc.SaveWeightRecord(ctx, "u1", 72.5, "2024-06-15")
	require.NoError(t, err)
	assert.Equal(t, "体重已保存", result["message"])
	assert.Len(t, repo.weightRecords, 1)
	assert.Equal(t, 72.5, repo.weightRecords[0].WeightKg)
	require.NotNil(t, repo.weightRecords[0].RecordedOn)
	assert.Equal(t, "2024-06-15", repo.weightRecords[0].RecordedOn.UTC().Format("2006-01-02"))
}

func TestBodyMetricsService_DeleteWeightRecord(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	recordedOn := time.Date(2024, 6, 15, 0, 0, 0, 0, time.UTC)
	repo.weightRecords = []domain.BodyWeightRecord{
		{ID: "w1", UserID: "u1", WeightKg: 72.5, RecordedOn: &recordedOn},
		{ID: "w2", UserID: "u2", WeightKg: 68.0, RecordedOn: &recordedOn},
	}

	result, err := svc.DeleteWeightRecord(ctx, "u1", "w1")
	require.NoError(t, err)
	assert.Equal(t, "体重记录已删除", result["message"])
	assert.Len(t, repo.weightRecords, 1)
	assert.Equal(t, "w2", repo.weightRecords[0].ID)
}

func TestBodyMetricsService_SyncLocal(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)
	ctx := context.Background()

	waterGoal := 2500
	result, err := svc.SyncLocal(ctx, "u1", SyncLocalInput{
		WeightEntries: []LocalWeightEntry{
			{Date: "2024-06-15", Value: 70.5, ClientID: "w1"},
		},
		WaterByDate: map[string]LocalWaterDay{
			"2024-06-15": {Total: 500, Logs: []int{250, 250}},
		},
		WaterGoalMl: &waterGoal,
	})
	require.NoError(t, err)
	assert.Equal(t, 1, result["imported_weight_count"])
	assert.Equal(t, 0, result["imported_water_count"])
	assert.Equal(t, true, result["water_import_skipped"])
	assert.Empty(t, repo.waterLogs)
	assert.NotNil(t, repo.settings)
	assert.Equal(t, 2500, repo.settings.WaterGoalMl)
}

func TestBodyMetricsService_SyncLocalAlwaysSkipsLegacyAggregatedWater(t *testing.T) {
	repo := &mockBodyMetricsRepo{
		waterListErr:   errors.New("water lookup must not run"),
		createWaterErr: errors.New("water create must not run"),
	}
	provider := &mockFoodWaterProvider{err: errors.New("food water provider must not run")}
	svc := NewBodyMetricsService(repo)
	svc.ConfigureFoodWaterProvider(provider)

	result, err := svc.SyncLocal(context.Background(), "u1", SyncLocalInput{WaterByDate: map[string]LocalWaterDay{
		"2026-09-28": {Total: 250, Logs: []int{250}},
		"invalid":    {Total: 300, Logs: []int{300}},
	}})

	require.NoError(t, err)
	assert.Equal(t, 0, result["imported_water_count"])
	assert.Equal(t, true, result["water_import_skipped"])
	assert.Equal(t, 0, provider.callCount)
	assert.Empty(t, repo.waterStartDate)
	assert.Empty(t, repo.waterEndDate)
	assert.Empty(t, repo.waterLogs)
}

func TestBodyMetricsService_SyncLocalDoesNotMarkSkipForInvalidWaterDatesOnly(t *testing.T) {
	repo := &mockBodyMetricsRepo{}
	svc := NewBodyMetricsService(repo)

	result, err := svc.SyncLocal(context.Background(), "u1", SyncLocalInput{WaterByDate: map[string]LocalWaterDay{
		"invalid": {Total: 250, Logs: []int{250}},
	}})

	require.NoError(t, err)
	assert.Equal(t, 0, result["imported_water_count"])
	assert.Equal(t, false, result["water_import_skipped"])
	assert.Empty(t, repo.waterLogs)
}
