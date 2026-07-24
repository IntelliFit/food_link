package service

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/common/dateutil"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/repo"
	healthdomain "food_link/backend/internal/health/domain"
	membershipdomain "food_link/backend/internal/membership/domain"
	"food_link/backend/pkg/logger"
	"food_link/backend/pkg/storage"
	"gorm.io/gorm"
)

var chinaTZ = time.FixedZone("Asia/Shanghai", 8*60*60)

var mealDisplayOrder = []string{
	"breakfast",
	"morning_snack",
	"lunch",
	"afternoon_snack",
	"dinner",
	"evening_snack",
}

type FoodRecordService struct {
	recordRepo *repo.FoodRecordRepo
	taskRepo   *repo.AnalysisTaskRepo
	userRepo   *authrepo.UserRepo
	storage    *storage.Client
	rewards    InviteRewardActivator
	waterLogs  WaterLogRecorder
}

type InviteRewardActivator interface {
	ActivatePendingInviteReferralOnFirstValidUse(ctx context.Context, inviteeUserID, effectiveAction string) (*membershipdomain.UserInviteReferral, error)
}

type WaterLogRecorder interface {
	CreateWaterLog(ctx context.Context, log *healthdomain.BodyWaterLog) error
	ReduceWaterLogsByDateSource(ctx context.Context, userID string, recordedOn string, sourceType string, amountMl int) (int, error)
	SumWaterByDateSource(ctx context.Context, userID string, recordedOn string, sourceType string) (int64, error)
}

func NewFoodRecordService(
	recordRepo *repo.FoodRecordRepo,
	taskRepo *repo.AnalysisTaskRepo,
	userRepo *authrepo.UserRepo,
	storageClient ...*storage.Client,
) *FoodRecordService {
	var client *storage.Client
	if len(storageClient) > 0 {
		client = storageClient[0]
	}
	return &FoodRecordService{
		recordRepo: recordRepo,
		taskRepo:   taskRepo,
		userRepo:   userRepo,
		storage:    client,
	}
}

func (s *FoodRecordService) ConfigureInviteRewardActivator(rewards InviteRewardActivator) {
	s.rewards = rewards
}

func (s *FoodRecordService) ConfigureWaterLogRecorder(recorder WaterLogRecorder) {
	s.waterLogs = recorder
}

type SaveFoodRecordInput struct {
	MealType         string
	ImagePath        *string
	ImagePaths       []string
	Description      *string
	Insight          *string
	Items            []domain.FoodItem
	TotalCalories    float64
	TotalProtein     float64
	TotalCarbs       float64
	TotalFat         float64
	TotalWeightGrams int
	DietGoal         *string
	ActivityTiming   *string
	EatingMood       *string
	PFCRatioComment  *string
	AbsorptionNotes  *string
	ContextAdvice    *string
	SourceTaskID     *string
	EntryType        *string
	RecipeID         *string
	Date             *string
}

type UpdateFoodRecordInput struct {
	MealType         *string
	Items            []domain.FoodItem
	TotalCalories    *float64
	TotalProtein     *float64
	TotalCarbs       *float64
	TotalFat         *float64
	TotalWeightGrams *int
	Description      *string
	ImagePath        *string
	ImagePaths       []string
}

func (s *FoodRecordService) Save(ctx context.Context, userID string, input SaveFoodRecordInput) (*domain.FoodRecord, error) {
	if !validMealType(input.MealType) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "meal_type 不合法", HTTPStatus: 400}
	}
	normalizedInputMealType := strings.ToLower(strings.TrimSpace(input.MealType))
	if input.EatingMood != nil {
		mood := strings.TrimSpace(*input.EatingMood)
		if mood == "" {
			input.EatingMood = nil
		} else if !validEatingMood(mood) {
			return nil, &commonerrors.AppError{Code: 10002, Message: "eating_mood 不合法", HTTPStatus: 400}
		} else {
			input.EatingMood = &mood
		}
	}
	if input.SourceTaskID != nil {
		trimmed := strings.TrimSpace(*input.SourceTaskID)
		if trimmed == "" {
			input.SourceTaskID = nil
		} else {
			input.SourceTaskID = &trimmed
			existing, err := s.recordRepo.GetByUserSourceTaskID(ctx, userID, trimmed)
			if err != nil {
				return nil, err
			}
			if existing != nil {
				s.ensureExistingFoodWaterIntake(ctx, userID, existing)
				existing.AlreadySaved = true
				return existing, nil
			}
		}
	}
	input.ImagePaths = s.normalizeImagePaths(input.ImagePaths)
	if input.ImagePath != nil {
		resolved := s.resolveFoodImageURL(*input.ImagePath)
		if resolved == "" {
			input.ImagePath = nil
		} else {
			input.ImagePath = &resolved
		}
	}
	if input.ImagePath == nil && len(input.ImagePaths) > 0 {
		first := input.ImagePaths[0]
		input.ImagePath = &first
	}
	input.Items = normalizeFoodItems(input.Items)
	var aiGeneratedNutrition bool
	input.Items, aiGeneratedNutrition = reconcileAIGeneratedFoodItems(input.Items)
	if aiGeneratedNutrition {
		oldCalories := input.TotalCalories
		protein, carbs, fat := recordMacroTotals(input.Items, input.TotalProtein, input.TotalCarbs, input.TotalFat)
		input.TotalCalories = domain.MacroCalories(protein, carbs, fat)
		if math.Abs(oldCalories-input.TotalCalories) > 0.0001 {
			logger.Info(ctx, "AI生成营养热量已按三大营养素校准",
				slog.String("user_id", userID),
				slog.Float64("calories.before", oldCalories),
				slog.Float64("calories.after", input.TotalCalories),
				slog.Float64("protein_g", protein),
				slog.Float64("carbs_g", carbs),
				slog.Float64("fat_g", fat),
			)
		}
	}
	if input.SourceTaskID != nil {
		if err := validateNoSuspiciousZeroNutritionItems(input.Items); err != nil {
			return nil, err
		}
	}

	recordTime, err := s.buildRecordTime(ctx, input.Date, input.SourceTaskID)
	if err != nil {
		return nil, err
	}
	recordedMealType := normalizeMealType(normalizedInputMealType, recordTime)
	if normalizedInputMealType == "snack" {
		if inferred, ok := s.inferMealTypeFromHealthRoutine(ctx, userID, recordTime); ok {
			recordedMealType = inferred
		}
	}

	var entryType *string
	if input.EntryType != nil && strings.TrimSpace(*input.EntryType) != "" {
		v := strings.TrimSpace(*input.EntryType)
		entryType = &v
	}
	var recipeID *string
	if input.RecipeID != nil && strings.TrimSpace(*input.RecipeID) != "" {
		v := strings.TrimSpace(*input.RecipeID)
		recipeID = &v
	}
	record := &domain.FoodRecord{
		UserID:           userID,
		MealType:         recordedMealType,
		ImagePath:        input.ImagePath,
		ImagePaths:       input.ImagePaths,
		Description:      input.Description,
		Insight:          input.Insight,
		Items:            input.Items,
		TotalCalories:    input.TotalCalories,
		TotalProtein:     input.TotalProtein,
		TotalCarbs:       input.TotalCarbs,
		TotalFat:         input.TotalFat,
		TotalWeightGrams: input.TotalWeightGrams,
		DietGoal:         input.DietGoal,
		ActivityTiming:   input.ActivityTiming,
		EatingMood:       input.EatingMood,
		PFCRatioComment:  input.PFCRatioComment,
		AbsorptionNotes:  input.AbsorptionNotes,
		ContextAdvice:    input.ContextAdvice,
		SourceTaskID:     input.SourceTaskID,
		EntryType:        entryType,
		RecipeID:         recipeID,
		RecordTime:       recordTime,
	}
	if err := s.recordRepo.Create(ctx, record); err != nil {
		if input.SourceTaskID != nil && isDuplicateRecordError(err) {
			existing, lookupErr := s.recordRepo.GetByUserSourceTaskID(ctx, userID, *input.SourceTaskID)
			if lookupErr != nil {
				return nil, lookupErr
			}
			if existing != nil {
				s.ensureExistingFoodWaterIntake(ctx, userID, existing)
				existing.AlreadySaved = true
				return existing, nil
			}
		}
		return nil, err
	}
	if err := s.recordFoodWaterIntake(ctx, userID, record); err != nil {
		// Food water is a derived side effect. A schema/config drift in water logs
		// must not make the primary food record fail after it has been created.
		logger.Error(ctx, "记录食物饮水量失败", err,
			slog.String("user_id", userID),
			slog.String("record_id", record.ID),
		)
	}
	s.activateInviteReward(ctx, userID, "food_record")
	return record, nil
}

func isDuplicateRecordError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate") || strings.Contains(msg, "unique") || strings.Contains(msg, "23505")
}

func (s *FoodRecordService) recordFoodWaterIntake(ctx context.Context, userID string, record *domain.FoodRecord) error {
	if s.waterLogs == nil || record == nil || strings.TrimSpace(userID) == "" {
		return nil
	}
	amountMl := totalFoodWaterIntakeMl(record.Items)
	if amountMl <= 0 {
		return nil
	}
	return s.recordFoodWaterAmount(ctx, userID, record.ID, foodRecordWaterDate(record.RecordTime), amountMl)
}

func (s *FoodRecordService) ensureExistingFoodWaterIntake(ctx context.Context, userID string, record *domain.FoodRecord) {
	if s.waterLogs == nil || record == nil || strings.TrimSpace(userID) == "" {
		return
	}
	amountMl := totalFoodWaterIntakeMl(record.Items)
	if amountMl <= 0 {
		return
	}
	sourceType := foodWaterSourceType(record.ID)
	if sourceType == "" {
		return
	}
	recordedDate := foodRecordWaterDate(record.RecordTime)
	existingMl, err := s.waterLogs.SumWaterByDateSource(ctx, userID, recordedDate.Format("2006-01-02"), sourceType)
	if err != nil {
		logger.Warn(ctx, "补齐食物饮水量时查询已有饮水失败",
			slog.String("user_id", userID),
			slog.String("record_id", record.ID),
			slog.String("source_type", sourceType),
			logger.Err(err),
		)
		return
	}
	missingMl := amountMl - int(existingMl)
	if missingMl <= 0 {
		return
	}
	if err := s.recordFoodWaterAmount(ctx, userID, record.ID, recordedDate, missingMl); err != nil {
		logger.Warn(ctx, "补齐食物饮水量失败",
			slog.String("user_id", userID),
			slog.String("record_id", record.ID),
			slog.Int("missing_ml", missingMl),
			logger.Err(err),
		)
	}
}

func (s *FoodRecordService) adjustFoodRecordWaterIntake(ctx context.Context, userID string, recordID string, recordTime *time.Time, deltaMl int) error {
	if s.waterLogs == nil || strings.TrimSpace(userID) == "" || deltaMl == 0 {
		return nil
	}
	recordedDate := foodRecordWaterDate(recordTime)
	if deltaMl > 0 {
		return s.recordFoodWaterAmount(ctx, userID, recordID, recordedDate, deltaMl)
	}
	sourceType := foodWaterSourceType(recordID)
	if sourceType == "" {
		return nil
	}
	_, err := s.waterLogs.ReduceWaterLogsByDateSource(ctx, userID, recordedDate.Format("2006-01-02"), sourceType, -deltaMl)
	return err
}

func (s *FoodRecordService) recordFoodWaterAmount(ctx context.Context, userID string, recordID string, recordedDate time.Time, amountMl int) error {
	if s.waterLogs == nil || amountMl <= 0 {
		return nil
	}
	sourceType := foodWaterSourceType(recordID)
	if sourceType == "" {
		return nil
	}
	logger.Info(ctx, "记录食物饮水量",
		slog.String("user_id", userID),
		slog.String("record_id", recordID),
		slog.Int("amount_ml", amountMl),
		slog.String("recorded_on", recordedDate.Format("2006-01-02")),
		slog.String("source_type", sourceType),
	)
	for amountMl > 0 {
		chunk := amountMl
		if chunk > 5000 {
			chunk = 5000
		}
		now := time.Now().UTC()
		log := &healthdomain.BodyWaterLog{
			UserID:     userID,
			AmountMl:   chunk,
			RecordedOn: &recordedDate,
			SourceType: sourceType,
			CreatedAt:  &now,
		}
		if err := s.waterLogs.CreateWaterLog(ctx, log); err != nil {
			return err
		}
		amountMl -= chunk
	}
	return nil
}

func foodWaterSourceType(recordID string) string {
	recordID = strings.TrimSpace(recordID)
	if recordID == "" {
		return ""
	}
	return "ai_food_record:" + recordID
}

func foodRecordWaterDate(recordTime *time.Time) time.Time {
	recordedOn := time.Now().In(chinaTZ)
	if recordTime != nil {
		recordedOn = recordTime.In(chinaTZ)
	}
	// 用 UTC 午夜存储，避免 Postgres date 列按会话时区转换导致日期错位
	return time.Date(recordedOn.Year(), recordedOn.Month(), recordedOn.Day(), 0, 0, 0, 0, time.UTC)
}

func normalizeFoodItems(items []domain.FoodItem) []domain.FoodItem {
	for i := range items {
		if items[i].Ratio > 100 {
			items[i].Ratio = 100
		}
		if items[i].Ratio < 0 {
			items[i].Ratio = 0
		}
		if items[i].Intake > items[i].Weight {
			items[i].Intake = items[i].Weight
		}
		if items[i].Intake < 0 {
			items[i].Intake = 0
		}
		if items[i].WaterMl < 0 {
			items[i].WaterMl = 0
		}
		if items[i].Weight > 0 && items[i].WaterMl > items[i].Weight {
			items[i].WaterMl = items[i].Weight
		}
	}
	return items
}

func reconcileAIGeneratedFoodItems(items []domain.FoodItem) ([]domain.FoodItem, bool) {
	hasAIGenerated := false
	for i := range items {
		source := foodRecordStringPtrValue(items[i].NutritionSource)
		category := foodRecordStringPtrValue(items[i].NutritionSourceCategory)
		if !domain.IsAIGeneratedNutritionSource(source) && !domain.IsAIGeneratedNutritionSource(category) {
			continue
		}
		hasAIGenerated = true
		items[i].Nutrients.Calories = domain.MacroCalories(
			items[i].Nutrients.Protein,
			items[i].Nutrients.Carbs,
			items[i].Nutrients.Fat,
		)
	}
	return items, hasAIGenerated
}

func foodRecordStringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func recordMacroTotals(items []domain.FoodItem, protein, carbs, fat float64) (float64, float64, float64) {
	if protein > 0 || carbs > 0 || fat > 0 {
		return protein, carbs, fat
	}
	for _, item := range items {
		protein += item.Nutrients.Protein
		carbs += item.Nutrients.Carbs
		fat += item.Nutrients.Fat
	}
	return protein, carbs, fat
}

func validateNoSuspiciousZeroNutritionItems(items []domain.FoodItem) error {
	for _, item := range items {
		if !isSuspiciousZeroNutritionFoodItem(item) {
			continue
		}
		return &commonerrors.AppError{
			Code:       10002,
			Message:    fmt.Sprintf("食物「%s」营养信息缺失，请先重新识别或手动补充热量", strings.TrimSpace(item.Name)),
			HTTPStatus: 400,
		}
	}
	return nil
}

func isSuspiciousZeroNutritionFoodItem(item domain.FoodItem) bool {
	name := strings.TrimSpace(item.Name)
	if name == "" || len([]rune(name)) <= 1 {
		return false
	}
	weight := item.Weight
	if weight <= 0 {
		weight = item.Intake
	}
	if weight < 5 {
		return false
	}
	if isKnownZeroNutritionFoodName(name) {
		return false
	}
	if !allFoodItemCoreNutritionZero(item.Nutrients) {
		return false
	}
	// 核心营养全为 0 但含有水分（如水、冰等）属于真实零卡含水食物，放行；
	// 只有营养和水含量同时为 0 时才视为营养信息缺失。
	if item.WaterMl > 0 {
		return false
	}
	return true
}

func allFoodItemCoreNutritionZero(n domain.FoodItemNutrients) bool {
	const eps = 0.0001
	return math.Abs(n.Calories) <= eps &&
		math.Abs(n.Protein) <= eps &&
		math.Abs(n.Carbs) <= eps &&
		math.Abs(n.Fat) <= eps
}

func isKnownZeroNutritionFoodName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	exactNames := []string{
		"水", "白开水", "温水", "热水", "冰水", "纯净水", "矿泉水", "饮用水", "饮用天然水",
		"苏打水", "气泡水", "无糖茶", "茶水", "绿茶", "乌龙茶",
		"黑咖啡", "美式咖啡", "无糖可乐", "无糖可口可乐", "无糖芬达",
		"食用冰", "冰块",
	}
	for _, exact := range exactNames {
		if name == exact {
			return true
		}
	}
	safeContains := []string{"无糖茶", "黑咖啡", "美式咖啡", "深烘美式", "椰青美式", "无糖可乐", "无糖芬达", "食用冰", "冰块"}
	for _, part := range safeContains {
		if strings.Contains(name, part) {
			return true
		}
	}
	return false
}

func totalFoodWaterIntakeMl(items []domain.FoodItem) int {
	total := 0.0
	for _, item := range items {
		waterMl := item.WaterMl
		if waterMl <= 0 {
			continue
		}
		if item.Weight > 0 && waterMl > item.Weight {
			waterMl = item.Weight
		}
		ratio := item.Ratio
		if ratio > 100 {
			ratio = 100
		}
		if ratio > 0 {
			total += waterMl * ratio / 100
			continue
		}
		if item.Intake > 0 && item.Weight > 0 {
			total += waterMl * item.Intake / item.Weight
			continue
		}
		if item.Intake == 0 && item.Weight == 0 {
			total += waterMl
		}
	}
	if total <= 0 {
		return 0
	}
	return int(math.Round(total))
}

func (s *FoodRecordService) activateInviteReward(ctx context.Context, userID, action string) {
	if s.rewards == nil || strings.TrimSpace(userID) == "" {
		return
	}
	if _, err := s.rewards.ActivatePendingInviteReferralOnFirstValidUse(ctx, userID, action); err != nil {
		logger.Warn(ctx, "饮食记录邀请奖励激活失败",
			slog.String("user_id", userID),
			slog.String("reward.action", action),
			logger.Err(err),
		)
	}
}

func (s *FoodRecordService) List(ctx context.Context, userID, date string) ([]domain.FoodRecord, error) {
	records, err := s.recordRepo.ListByUser(ctx, userID, date, 100)
	if err != nil {
		return nil, err
	}

	// Bulk hydrate image_paths
	taskIDs := make([]string, 0)
	for i := range records {
		if records[i].SourceTaskID != nil && len(records[i].ImagePaths) == 0 {
			taskIDs = append(taskIDs, *records[i].SourceTaskID)
		}
	}
	var taskImages map[string][]string
	if len(taskIDs) > 0 {
		taskImages, _ = s.taskRepo.GetImagePathsByIDs(ctx, taskIDs)
	}

	for i := range records {
		if records[i].SourceTaskID != nil && len(records[i].ImagePaths) == 0 {
			if paths, ok := taskImages[*records[i].SourceTaskID]; ok && len(paths) > 0 {
				records[i].ImagePaths = paths
			} else if records[i].ImagePath != nil && *records[i].ImagePath != "" {
				records[i].ImagePaths = []string{*records[i].ImagePath}
			}
		}
		records[i].MealType = normalizeMealType(records[i].MealType, records[i].RecordTime)
		s.hydrateRecordImages(ctx, &records[i])
		s.hydrateRecordNutrientsFromTask(ctx, &records[i])
	}
	return records, nil
}

type EntryDistributionItem struct {
	EntryType  string  `json:"entry_type"`
	Count      int64   `json:"count"`
	Percentage float64 `json:"percentage"`
}

type EntryDistributionResult struct {
	Total int64                   `json:"total"`
	Items []EntryDistributionItem `json:"items"`
}

func (s *FoodRecordService) GetEntryDistribution(ctx context.Context, userID, startDate, endDate string) (*EntryDistributionResult, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, commonerrors.ErrForbidden
	}
	startTime, err := parseDateStart(startDate)
	if err != nil {
		return nil, &commonerrors.AppError{Code: 10002, Message: "start_date 格式错误", HTTPStatus: 400}
	}
	endTime, err := parseDateEnd(endDate)
	if err != nil {
		return nil, &commonerrors.AppError{Code: 10002, Message: "end_date 格式错误", HTTPStatus: 400}
	}
	rows, total, err := s.recordRepo.CountByEntryType(ctx, userID, startTime, endTime)
	if err != nil {
		return nil, err
	}
	items := make([]EntryDistributionItem, 0, len(rows))
	for _, r := range rows {
		percentage := 0.0
		if total > 0 {
			percentage = float64(r.Count) / float64(total)
		}
		items = append(items, EntryDistributionItem{
			EntryType:  r.EntryType,
			Count:      r.Count,
			Percentage: math.Round(percentage*10000) / 10000,
		})
	}
	return &EntryDistributionResult{Total: total, Items: items}, nil
}

func parseDateStart(date string) (time.Time, error) {
	if strings.TrimSpace(date) == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse("2006-01-02", strings.TrimSpace(date))
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, chinaTZ), nil
}

func parseDateEnd(date string) (time.Time, error) {
	if strings.TrimSpace(date) == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse("2006-01-02", strings.TrimSpace(date))
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, chinaTZ), nil
}

func (s *FoodRecordService) Get(ctx context.Context, userID, recordID string) (*domain.FoodRecord, error) {
	record, err := s.recordRepo.GetByID(ctx, recordID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, commonerrors.ErrNotFound
	}
	if record.UserID != userID {
		return nil, commonerrors.ErrForbidden
	}
	record = s.hydrateRecordWithContext(ctx, record)
	record.MealType = normalizeMealType(record.MealType, record.RecordTime)
	return record, nil
}

func (s *FoodRecordService) Update(ctx context.Context, userID, recordID string, input UpdateFoodRecordInput) (*domain.FoodRecord, error) {
	var previousWaterMl int
	var previousRecordTime *time.Time
	var existing *domain.FoodRecord
	nutritionUpdate := input.Items != nil || input.TotalCalories != nil || input.TotalProtein != nil || input.TotalCarbs != nil || input.TotalFat != nil
	if nutritionUpdate {
		var err error
		existing, err = s.recordRepo.GetByID(ctx, recordID)
		if err != nil {
			return nil, err
		}
		if existing == nil {
			return nil, commonerrors.ErrNotFound
		}
		if existing.UserID != userID {
			return nil, commonerrors.ErrNotFound
		}
		if input.Items != nil {
			previousWaterMl = totalFoodWaterIntakeMl(existing.Items)
			previousRecordTime = existing.RecordTime
		}
	}

	updates := map[string]any{}
	enforceAIGeneratedEnergy := false
	if input.MealType != nil {
		if !validMealType(*input.MealType) {
			return nil, &commonerrors.AppError{Code: 10002, Message: "meal_type 不合法", HTTPStatus: 400}
		}
		updates["meal_type"] = normalizeMealType(*input.MealType, nil)
	}
	effectiveItems := existingItems(existing)
	if input.Items != nil {
		effectiveItems = normalizeFoodItems(input.Items)
		effectiveItems, enforceAIGeneratedEnergy = reconcileAIGeneratedFoodItems(effectiveItems)
		updates["items"] = effectiveItems
	} else if nutritionUpdate {
		effectiveItems, enforceAIGeneratedEnergy = reconcileAIGeneratedFoodItems(effectiveItems)
		if enforceAIGeneratedEnergy {
			updates["items"] = effectiveItems
		}
	}
	if enforceAIGeneratedEnergy {
		protein := existing.TotalProtein
		carbs := existing.TotalCarbs
		fat := existing.TotalFat
		if input.Items != nil {
			protein, carbs, fat = recordMacroTotals(effectiveItems, 0, 0, 0)
		}
		if input.TotalProtein != nil {
			protein = *input.TotalProtein
		}
		if input.TotalCarbs != nil {
			carbs = *input.TotalCarbs
		}
		if input.TotalFat != nil {
			fat = *input.TotalFat
		}
		updates["total_calories"] = domain.MacroCalories(protein, carbs, fat)
	}
	if input.TotalCalories != nil && !enforceAIGeneratedEnergy {
		updates["total_calories"] = *input.TotalCalories
	}
	if input.TotalProtein != nil {
		updates["total_protein"] = *input.TotalProtein
	}
	if input.TotalCarbs != nil {
		updates["total_carbs"] = *input.TotalCarbs
	}
	if input.TotalFat != nil {
		updates["total_fat"] = *input.TotalFat
	}
	if input.TotalWeightGrams != nil {
		updates["total_weight_grams"] = *input.TotalWeightGrams
	}
	if input.Description != nil {
		updates["description"] = *input.Description
	}
	if input.ImagePath != nil {
		updates["image_path"] = *input.ImagePath
	}
	if input.ImagePaths != nil {
		updates["image_paths"] = input.ImagePaths
	}
	if len(updates) == 0 {
		return nil, &commonerrors.AppError{Code: 10002, Message: "没有需要更新的字段", HTTPStatus: 400}
	}
	record, err := s.recordRepo.Update(ctx, userID, recordID, updates)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, commonerrors.ErrNotFound
	}
	if input.Items != nil {
		nextWaterMl := totalFoodWaterIntakeMl(record.Items)
		if err := s.adjustFoodRecordWaterIntake(ctx, userID, record.ID, previousRecordTime, nextWaterMl-previousWaterMl); err != nil {
			return nil, err
		}
	}
	record = s.hydrateRecordWithContext(ctx, record)
	record.MealType = normalizeMealType(record.MealType, record.RecordTime)
	return record, nil
}

func existingItems(record *domain.FoodRecord) []domain.FoodItem {
	if record == nil {
		return nil
	}
	return record.Items
}

func (s *FoodRecordService) Delete(ctx context.Context, userID, recordID string) error {
	record, err := s.recordRepo.GetByID(ctx, recordID)
	if err != nil {
		return err
	}
	if record == nil {
		return commonerrors.ErrNotFound
	}
	if record.UserID != userID {
		return commonerrors.ErrNotFound
	}
	waterMl := totalFoodWaterIntakeMl(record.Items)
	if err := s.recordRepo.Delete(ctx, userID, recordID); err != nil {
		if err == gorm.ErrRecordNotFound {
			return commonerrors.ErrNotFound
		}
		return err
	}
	if waterMl > 0 {
		return s.adjustFoodRecordWaterIntake(ctx, userID, record.ID, record.RecordTime, -waterMl)
	}
	return nil
}

func (s *FoodRecordService) Share(ctx context.Context, recordID string) (*domain.FoodRecord, error) {
	recordID = strings.TrimSpace(recordID)
	if recordID == "" {
		return nil, commonerrors.ErrNotFound
	}
	if _, err := uuid.Parse(recordID); err != nil {
		return nil, commonerrors.ErrNotFound
	}
	record, err := s.recordRepo.GetByID(ctx, recordID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, commonerrors.ErrNotFound
	}
	if record.UserID != "" {
		owner, err := s.userRepo.FindByID(ctx, record.UserID)
		if err != nil {
			return nil, err
		}
		if owner != nil && owner.PublicRecords != nil && !*owner.PublicRecords {
			return nil, commonerrors.ErrForbidden
		}
	}
	record = s.hydrateRecordWithContext(ctx, record)
	record.MealType = normalizeMealType(record.MealType, record.RecordTime)
	return record, nil
}

func (s *FoodRecordService) SaveCriticalSamples(ctx context.Context, userID string, items []domain.CriticalSample) error {
	if len(items) == 0 {
		return &commonerrors.AppError{Code: 10002, Message: "请先修改上方的重量数值，以便我们记录偏差。", HTTPStatus: 400}
	}
	return s.recordRepo.InsertCriticalSamples(ctx, userID, items)
}

func (s *FoodRecordService) buildRecordTime(ctx context.Context, dateStr *string, sourceTaskID *string) (*time.Time, error) {
	recordedOn := ""
	if dateStr != nil && *dateStr != "" {
		recordedOn = *dateStr
	} else if sourceTaskID != nil && *sourceTaskID != "" {
		task, err := s.taskRepo.GetByID(ctx, *sourceTaskID)
		if err == nil && task != nil && task.Payload != nil {
			if v, ok := task.Payload["recorded_on"].(string); ok && v != "" {
				recordedOn = v
			}
		}
	}
	normalized, err := dateutil.ResolveRecordedOnDate(recordedOn, "date")
	if err != nil {
		return nil, err
	}
	t, err := dateutil.BuildRecordTime(normalized)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *FoodRecordService) hydrateRecord(record *domain.FoodRecord) *domain.FoodRecord {
	return s.hydrateRecordWithContext(context.Background(), record)
}

func (s *FoodRecordService) hydrateRecordWithContext(ctx context.Context, record *domain.FoodRecord) *domain.FoodRecord {
	if record == nil {
		return nil
	}
	if len(record.ImagePaths) == 0 && record.SourceTaskID != nil {
		paths, err := s.taskRepo.GetImagePathsByID(ctx, *record.SourceTaskID)
		if err == nil && len(paths) > 0 {
			record.ImagePaths = paths
		}
	}
	if len(record.ImagePaths) == 0 && record.ImagePath != nil && *record.ImagePath != "" {
		record.ImagePaths = []string{*record.ImagePath}
	}
	s.hydrateRecordImages(ctx, record)
	s.hydrateRecordNutrientsFromTask(ctx, record)
	hydrateManualRecordNutrients(record)
	return record
}

var manualKnownFoodNutrientsPer100g = map[string]domain.FoodItemNutrients{
	normalizeRecordFoodName("白米饭"): {
		Calories: 151,
		Protein:  2.7,
		Carbs:    33.1,
		Fat:      0.3,
	},
	normalizeRecordFoodName("米饭"): {
		Calories: 151,
		Protein:  2.7,
		Carbs:    33.1,
		Fat:      0.3,
	},
	normalizeRecordFoodName("水煮蛋"): {
		Calories: 95,
		Protein:  12.7,
		Carbs:    1.1,
		Fat:      6.5,
	},
	normalizeRecordFoodName("鸡蛋"): {
		Calories: 95,
		Protein:  12.7,
		Carbs:    1.1,
		Fat:      6.5,
	},
	normalizeRecordFoodName("香蕉"): {
		Calories: 89,
		Protein:  1.1,
		Carbs:    22.8,
		Fat:      0.3,
	},
	normalizeRecordFoodName("全脂牛奶"): {
		Calories: 61,
		Protein:  3.2,
		Carbs:    4.8,
		Fat:      3.3,
	},
	normalizeRecordFoodName("面条"): {
		Calories: 109,
		Protein:  3.9,
		Carbs:    22.8,
		Fat:      0.4,
	},
}

func hydrateManualRecordNutrients(record *domain.FoodRecord) {
	if record == nil || len(record.Items) == 0 {
		return
	}
	hasManualItem := false
	for _, item := range record.Items {
		if item.ManualSource != nil || item.ManualSourceID != nil || item.ManualSourceTitle != nil {
			hasManualItem = true
			break
		}
	}
	if !hasManualItem {
		return
	}
	for index := range record.Items {
		if !foodItemNutrientsMissing(record.Items[index].Nutrients) {
			continue
		}
		name := strings.TrimSpace(record.Items[index].Name)
		if record.Items[index].ManualSourceTitle != nil && strings.TrimSpace(*record.Items[index].ManualSourceTitle) != "" {
			name = strings.TrimSpace(*record.Items[index].ManualSourceTitle)
		}
		if per100, ok := manualKnownFoodNutrientsPer100g[normalizeRecordFoodName(name)]; ok {
			record.Items[index].Nutrients = scaleFoodItemNutrients(per100, manualItemIntakeGrams(record.Items[index])/100)
		}
	}
	fillMissingManualNutrientsFromRecordTotals(record)
}

func fillMissingManualNutrientsFromRecordTotals(record *domain.FoodRecord) {
	missingWeight := 0.0
	for _, item := range record.Items {
		if foodItemNutrientsMissing(item.Nutrients) {
			missingWeight += manualItemIntakeGrams(item)
		}
	}
	if missingWeight <= 0 {
		return
	}
	remaining := domain.FoodItemNutrients{
		Calories: record.TotalCalories,
		Protein:  record.TotalProtein,
		Carbs:    record.TotalCarbs,
		Fat:      record.TotalFat,
	}
	for _, item := range record.Items {
		if foodItemNutrientsMissing(item.Nutrients) {
			continue
		}
		remaining.Calories -= item.Nutrients.Calories
		remaining.Protein -= item.Nutrients.Protein
		remaining.Carbs -= item.Nutrients.Carbs
		remaining.Fat -= item.Nutrients.Fat
	}
	remaining.Calories = math.Max(0, remaining.Calories)
	remaining.Protein = math.Max(0, remaining.Protein)
	remaining.Carbs = math.Max(0, remaining.Carbs)
	remaining.Fat = math.Max(0, remaining.Fat)
	if remaining.Calories <= 0 && remaining.Protein <= 0 && remaining.Carbs <= 0 && remaining.Fat <= 0 {
		return
	}
	for index := range record.Items {
		if !foodItemNutrientsMissing(record.Items[index].Nutrients) {
			continue
		}
		weight := manualItemIntakeGrams(record.Items[index])
		if weight <= 0 {
			weight = missingWeight / float64(len(record.Items))
		}
		record.Items[index].Nutrients = scaleFoodItemNutrients(remaining, weight/missingWeight)
	}
}

func foodItemNutrientsMissing(n domain.FoodItemNutrients) bool {
	return n.Calories <= 0 && n.Protein <= 0 && n.Carbs <= 0 && n.Fat <= 0
}

func manualItemIntakeGrams(item domain.FoodItem) float64 {
	if item.Intake > 0 {
		return item.Intake
	}
	if item.Weight > 0 && item.Ratio > 0 {
		return item.Weight * item.Ratio / 100
	}
	if item.Weight > 0 {
		return item.Weight
	}
	return 0
}

func scaleFoodItemNutrients(n domain.FoodItemNutrients, scale float64) domain.FoodItemNutrients {
	if scale <= 0 {
		return domain.FoodItemNutrients{}
	}
	return domain.FoodItemNutrients{
		Calories:       roundOneDecimal(n.Calories * scale),
		Protein:        roundOneDecimal(n.Protein * scale),
		Carbs:          roundOneDecimal(n.Carbs * scale),
		Fat:            roundOneDecimal(n.Fat * scale),
		Fiber:          roundOneDecimal(n.Fiber * scale),
		Sugar:          roundOneDecimal(n.Sugar * scale),
		SaturatedFat:   roundOneDecimal(n.SaturatedFat * scale),
		CholesterolMg:  roundOneDecimal(n.CholesterolMg * scale),
		SodiumMg:       roundOneDecimal(n.SodiumMg * scale),
		PotassiumMg:    roundOneDecimal(n.PotassiumMg * scale),
		CalciumMg:      roundOneDecimal(n.CalciumMg * scale),
		IronMg:         roundOneDecimal(n.IronMg * scale),
		MagnesiumMg:    roundOneDecimal(n.MagnesiumMg * scale),
		ZincMg:         roundOneDecimal(n.ZincMg * scale),
		VitaminARaeMcg: roundOneDecimal(n.VitaminARaeMcg * scale),
		VitaminCMg:     roundOneDecimal(n.VitaminCMg * scale),
		VitaminDMcg:    roundOneDecimal(n.VitaminDMcg * scale),
		VitaminEMg:     roundOneDecimal(n.VitaminEMg * scale),
		VitaminKMcg:    roundOneDecimal(n.VitaminKMcg * scale),
		ThiaminMg:      roundOneDecimal(n.ThiaminMg * scale),
		RiboflavinMg:   roundOneDecimal(n.RiboflavinMg * scale),
		NiacinMg:       roundOneDecimal(n.NiacinMg * scale),
		VitaminB6Mg:    roundOneDecimal(n.VitaminB6Mg * scale),
		FolateMcg:      roundOneDecimal(n.FolateMcg * scale),
		VitaminB12Mcg:  roundOneDecimal(n.VitaminB12Mcg * scale),
	}
}

func roundOneDecimal(value float64) float64 {
	return math.Round(value*10) / 10
}

func (s *FoodRecordService) hydrateRecordNutrientsFromTask(ctx context.Context, record *domain.FoodRecord) {
	if record == nil || record.SourceTaskID == nil || strings.TrimSpace(*record.SourceTaskID) == "" || s.taskRepo == nil || len(record.Items) == 0 {
		return
	}
	task, err := s.taskRepo.GetByID(ctx, *record.SourceTaskID)
	if err != nil || task == nil || len(task.Result) == 0 {
		return
	}
	sourceItems := taskResultNutritionItems(task.Result)
	if len(sourceItems) == 0 {
		return
	}
	used := map[int]bool{}
	for index := range record.Items {
		sourceIndex := matchSourceNutritionItem(record.Items[index], index, sourceItems, used)
		if sourceIndex < 0 {
			continue
		}
		used[sourceIndex] = true
		source := sourceItems[sourceIndex]
		fillMissingNutrients(&record.Items[index].Nutrients, source.nutrients)
		if record.Items[index].WaterMl <= 0 && source.waterMl > 0 {
			record.Items[index].WaterMl = source.waterMl
		}
		if record.Items[index].Weight > 0 && record.Items[index].WaterMl > record.Items[index].Weight {
			record.Items[index].WaterMl = record.Items[index].Weight
		}
	}
}

type sourceNutritionItem struct {
	name      string
	nutrients map[string]any
	waterMl   float64
}

func taskResultNutritionItems(result map[string]any) []sourceNutritionItem {
	items := anyItems(result["items"])
	out := make([]sourceNutritionItem, 0, len(items))
	for _, item := range items {
		nutrients := anyMap(item["nutrients"])
		waterMl := positiveNumberFromAny(item["waterMl"], item["water_ml"], nutrients["waterMl"], nutrients["water_ml"])
		out = append(out, sourceNutritionItem{
			name:      strings.TrimSpace(fmt.Sprint(item["name"])),
			nutrients: nutrients,
			waterMl:   waterMl,
		})
	}
	return out
}

func matchSourceNutritionItem(item domain.FoodItem, index int, sourceItems []sourceNutritionItem, used map[int]bool) int {
	needle := normalizeRecordFoodName(item.Name)
	if needle != "" {
		for i, source := range sourceItems {
			if used[i] {
				continue
			}
			if normalizeRecordFoodName(source.name) == needle {
				return i
			}
		}
	}
	if index >= 0 && index < len(sourceItems) && !used[index] {
		return index
	}
	return -1
}

func normalizeRecordFoodName(raw string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(raw)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func anyItems(value any) []map[string]any {
	switch arr := value.(type) {
	case []map[string]any:
		return arr
	case []any:
		out := make([]map[string]any, 0, len(arr))
		for _, item := range arr {
			if m := anyMap(item); len(m) > 0 {
				out = append(out, m)
			}
		}
		return out
	default:
		return nil
	}
}

func anyMap(value any) map[string]any {
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return nil
}

func fillMissingNutrients(target *domain.FoodItemNutrients, nutrients map[string]any) {
	if target == nil || len(nutrients) == 0 {
		return
	}
	fill := func(current *float64, keys ...string) {
		if current == nil || *current > 0 {
			return
		}
		if value := positiveNumberFromAnyKeys(nutrients, keys...); value > 0 {
			*current = value
		}
	}
	fill(&target.Calories, "calories")
	fill(&target.Protein, "protein")
	fill(&target.Carbs, "carbs")
	fill(&target.Fat, "fat")
	fill(&target.Fiber, "fiber")
	fill(&target.Sugar, "sugar")
	fill(&target.SaturatedFat, "saturatedFat", "saturated_fat")
	fill(&target.CholesterolMg, "cholesterolMg", "cholesterol_mg")
	fill(&target.SodiumMg, "sodiumMg", "sodium_mg")
	fill(&target.PotassiumMg, "potassiumMg", "potassium_mg")
	fill(&target.CalciumMg, "calciumMg", "calcium_mg")
	fill(&target.IronMg, "ironMg", "iron_mg")
	fill(&target.MagnesiumMg, "magnesiumMg", "magnesium_mg")
	fill(&target.ZincMg, "zincMg", "zinc_mg")
	fill(&target.VitaminARaeMcg, "vitaminARaeMcg", "vitamin_a_rae_mcg")
	fill(&target.VitaminCMg, "vitaminCMg", "vitamin_c_mg")
	fill(&target.VitaminDMcg, "vitaminDMcg", "vitamin_d_mcg")
	fill(&target.VitaminEMg, "vitaminEMg", "vitamin_e_mg")
	fill(&target.VitaminKMcg, "vitaminKMcg", "vitamin_k_mcg")
	fill(&target.ThiaminMg, "thiaminMg", "thiamin_mg")
	fill(&target.RiboflavinMg, "riboflavinMg", "riboflavin_mg")
	fill(&target.NiacinMg, "niacinMg", "niacin_mg")
	fill(&target.VitaminB6Mg, "vitaminB6Mg", "vitamin_b6_mg")
	fill(&target.FolateMcg, "folateMcg", "folate_mcg")
	fill(&target.VitaminB12Mcg, "vitaminB12Mcg", "vitamin_b12_mcg")
}

func positiveNumberFromAnyKeys(values map[string]any, keys ...string) float64 {
	for _, key := range keys {
		if value := positiveNumberFromAny(values[key]); value > 0 {
			return value
		}
	}
	return 0
}

func positiveNumberFromAny(values ...any) float64 {
	for _, value := range values {
		var number float64
		switch v := value.(type) {
		case float64:
			number = v
		case float32:
			number = float64(v)
		case int:
			number = float64(v)
		case int64:
			number = float64(v)
		case int32:
			number = float64(v)
		case uint:
			number = float64(v)
		case uint64:
			number = float64(v)
		case uint32:
			number = float64(v)
		case json.Number:
			number, _ = v.Float64()
		case string:
			trimmed := strings.TrimSpace(v)
			if trimmed != "" {
				parsed, err := strconv.ParseFloat(trimmed, 64)
				if err == nil {
					number = parsed
				}
			}
		}
		if number > 0 {
			return number
		}
	}
	return 0
}

func (s *FoodRecordService) hydrateRecordImages(ctx context.Context, record *domain.FoodRecord) {
	if record == nil {
		return
	}
	paths := s.collectFoodRecordImagePaths(ctx, record)
	record.ImagePaths = s.normalizeImagePaths(paths)
	if len(record.ImagePaths) > 0 {
		first := record.ImagePaths[0]
		record.ImagePath = &first
	} else {
		record.ImagePath = nil
	}
}

func (s *FoodRecordService) collectFoodRecordImagePaths(ctx context.Context, record *domain.FoodRecord) []string {
	if record == nil {
		return nil
	}
	explicitPaths := make([]string, 0)
	seen := map[string]bool{}
	appendRaw := func(raw string) {
		raw = strings.TrimSpace(raw)
		if raw == "" || seen[raw] {
			return
		}
		seen[raw] = true
		explicitPaths = append(explicitPaths, raw)
	}
	for _, imagePath := range record.ImagePaths {
		appendRaw(imagePath)
	}
	if record.ImagePath != nil {
		appendRaw(*record.ImagePath)
	}
	if s.recordRepo == nil {
		return explicitPaths
	}
	fallbackPaths := s.recordRepo.LookupManualSourceImagePaths(ctx, record.Items)
	if len(explicitPaths) == 0 {
		return fallbackPaths
	}
	return filterManualSourceFallbackImagePaths(explicitPaths, fallbackPaths, s.resolveFoodImageURL)
}

func filterManualSourceFallbackImagePaths(explicitPaths, fallbackPaths []string, resolve func(string) string) []string {
	if len(explicitPaths) == 0 || len(fallbackPaths) == 0 {
		return explicitPaths
	}
	fallbackResolved := make(map[string]struct{}, len(fallbackPaths))
	for _, raw := range fallbackPaths {
		resolved := resolve(raw)
		if resolved == "" {
			continue
		}
		fallbackResolved[resolved] = struct{}{}
	}
	if len(fallbackResolved) == 0 {
		return explicitPaths
	}
	filtered := make([]string, 0, len(explicitPaths))
	for _, raw := range explicitPaths {
		resolved := resolve(raw)
		if resolved == "" {
			continue
		}
		if _, ok := fallbackResolved[resolved]; ok {
			continue
		}
		filtered = append(filtered, raw)
	}
	if len(filtered) > 0 {
		return filtered
	}
	return explicitPaths
}

func (s *FoodRecordService) normalizeImagePaths(paths []string) []string {
	if len(paths) == 0 {
		return nil
	}
	normalized := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		resolved := s.resolveFoodImageURL(path)
		if resolved == "" {
			continue
		}
		if _, ok := seen[resolved]; ok {
			continue
		}
		seen[resolved] = struct{}{}
		normalized = append(normalized, resolved)
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func (s *FoodRecordService) resolveFoodImageURL(path string) string {
	if s.storage == nil {
		return strings.TrimSpace(path)
	}
	return s.storage.ResolveReferenceURL("food-images", path)
}

func validMealType(mealType string) bool {
	mt := strings.TrimSpace(strings.ToLower(mealType))
	if mt == "breakfast" || mt == "lunch" || mt == "dinner" || mt == "snack" {
		return true
	}
	for _, m := range mealDisplayOrder {
		if mt == m {
			return true
		}
	}
	return false
}

func validEatingMood(mood string) bool {
	switch strings.TrimSpace(mood) {
	case "happy", "calm", "stressed", "tired", "bored", "treat":
		return true
	default:
		return false
	}
}

func normalizeMealType(mealType string, recordTime *time.Time) string {
	mt := strings.TrimSpace(strings.ToLower(mealType))
	for _, m := range mealDisplayOrder {
		if mt == m {
			return mt
		}
	}
	if mt == "snack" {
		if recordTime != nil {
			hour := recordTime.In(chinaTZ).Hour()
			if hour < 11 {
				return "morning_snack"
			}
			if hour < 17 {
				return "afternoon_snack"
			}
			return "evening_snack"
		}
		now := time.Now().In(chinaTZ)
		if now.Hour() < 11 {
			return "morning_snack"
		}
		if now.Hour() < 17 {
			return "afternoon_snack"
		}
		return "evening_snack"
	}
	return "afternoon_snack"
}

func parseRoutineHourValue(value any) (int, bool) {
	switch v := value.(type) {
	case int:
		return v, v >= 0 && v <= 23
	case int8:
		return int(v), v >= 0 && v <= 23
	case int16:
		return int(v), v >= 0 && v <= 23
	case int32:
		return int(v), v >= 0 && v <= 23
	case int64:
		return int(v), v >= 0 && v <= 23
	case uint:
		return int(v), v <= 23
	case uint8:
		return int(v), int(v) >= 0 && int(v) <= 23
	case uint16:
		return int(v), int(v) >= 0 && int(v) <= 23
	case uint32:
		return int(v), int(v) >= 0 && int(v) <= 23
	case uint64:
		return int(v), v <= 23
	case float32:
		return int(v), v >= 0 && v <= 23
	case float64:
		return int(v), v >= 0 && v <= 23
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0, false
		}
		f, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0, false
		}
		return int(f), true
	case json.Number:
		f, err := v.Float64()
		if err != nil {
			return 0, false
		}
		return int(f), true
	default:
		return 0, false
	}
}

func inferMealTypeByRoutine(wakeHour int, sleepHour int, t time.Time) string {
	hour := t.In(chinaTZ).Hour()
	hoursSinceWake := (hour - wakeHour + 24) % 24
	if hoursSinceWake <= 3 {
		return "breakfast"
	}
	if hoursSinceWake <= 8 {
		return "lunch"
	}
	hoursUntilSleep := (sleepHour - hour + 24) % 24
	if hoursUntilSleep <= 4 {
		return "dinner"
	}
	return "afternoon_snack"
}

func (s *FoodRecordService) inferMealTypeFromHealthRoutine(ctx context.Context, userID string, recordTime *time.Time) (string, bool) {
	if strings.TrimSpace(userID) == "" || s.userRepo == nil {
		return "", false
	}
	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil || user == nil || len(user.HealthCondition) == 0 {
		return "", false
	}
	wakeHour, okWake := parseRoutineHourValue(user.HealthCondition["routine_wake_hour"])
	sleepHour, okSleep := parseRoutineHourValue(user.HealthCondition["routine_sleep_hour"])
	if !okWake || !okSleep || wakeHour < 0 || wakeHour > 23 || sleepHour < 0 || sleepHour > 23 || wakeHour == sleepHour {
		return "", false
	}
	refTime := time.Now().In(chinaTZ)
	if recordTime != nil {
		refTime = recordTime.In(chinaTZ)
	}
	return inferMealTypeByRoutine(wakeHour, sleepHour, refTime), true
}

// RecommendMealType 根据用户作息/当前时间推断默认餐次，并结合当天已有记录做顺延。
// 如果当前推荐餐次（仅限正餐）已在当天存在记录，且与当天最新记录间隔超过 1 小时，
// 则按 breakfast → lunch → dinner → evening_snack 顺序顺延。
func (s *FoodRecordService) RecommendMealType(ctx context.Context, userID string, dateStr string, refTime *time.Time) (string, string, error) {
	t := time.Now().In(chinaTZ)
	if refTime != nil {
		t = refTime.In(chinaTZ)
	}

	var baseMeal, generatedBy string
	if inferred, ok := s.inferMealTypeFromHealthRoutine(ctx, userID, &t); ok {
		baseMeal = inferred
		generatedBy = "health_routine"
	} else {
		baseMeal = inferDefaultMealTypeFromLocalTime(t)
		generatedBy = "local_time"
	}

	date := dateStr
	if date == "" {
		date = t.Format("2006-01-02")
	}

	records, err := s.recordRepo.ListByUser(ctx, userID, date, 0)
	if err != nil {
		return baseMeal, generatedBy, nil
	}

	shifted := shiftMealTypeByExistingRecords(baseMeal, t, records)
	if shifted != baseMeal {
		generatedBy = "shifted_by_record"
	}
	return shifted, generatedBy, nil
}

func inferDefaultMealTypeFromLocalTime(t time.Time) string {
	minutes := t.In(chinaTZ).Hour()*60 + t.In(chinaTZ).Minute()
	if minutes < 5*60 {
		return "evening_snack"
	}
	if minutes < 10*60+30 {
		return "breakfast"
	}
	if minutes < 11*60+30 {
		return "morning_snack"
	}
	if minutes < 14*60+30 {
		return "lunch"
	}
	if minutes < 17*60 {
		return "afternoon_snack"
	}
	if minutes < 21*60 {
		return "dinner"
	}
	return "evening_snack"
}

func shiftMealTypeByExistingRecords(baseMeal string, refTime time.Time, records []domain.FoodRecord) string {
	mainMeals := []string{"breakfast", "lunch", "dinner"}
	mainMealSet := map[string]bool{}
	for _, m := range mainMeals {
		mainMealSet[m] = true
	}
	if !mainMealSet[baseMeal] {
		return baseMeal
	}

	var latestRecordTime *time.Time
	existingMeals := map[string]bool{}
	for i := range records {
		if records[i].RecordTime == nil {
			continue
		}
		existingMeals[strings.ToLower(strings.TrimSpace(records[i].MealType))] = true
		if latestRecordTime == nil || records[i].RecordTime.After(*latestRecordTime) {
			latestRecordTime = records[i].RecordTime
		}
	}

	if latestRecordTime == nil {
		return baseMeal
	}
	if refTime.Sub(*latestRecordTime) <= time.Hour {
		return baseMeal
	}

	baseIdx := -1
	for i, m := range mainMeals {
		if m == baseMeal {
			baseIdx = i
			break
		}
	}
	if baseIdx < 0 {
		return baseMeal
	}

	for i := baseIdx + 1; i < len(mainMeals); i++ {
		next := mainMeals[i]
		if !existingMeals[next] {
			return next
		}
	}
	return "evening_snack"
}
