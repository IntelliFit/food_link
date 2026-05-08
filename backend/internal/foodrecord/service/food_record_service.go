package service

import (
	"context"
	"strings"
	"time"

	authrepo "food_link/backend/internal/auth/repo"
	"food_link/backend/internal/common/dateutil"
	commonerrors "food_link/backend/internal/common/errors"
	"food_link/backend/internal/foodrecord/domain"
	"food_link/backend/internal/foodrecord/repo"
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
	PFCRatioComment  *string
	AbsorptionNotes  *string
	ContextAdvice    *string
	SourceTaskID     *string
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
}

func (s *FoodRecordService) Save(ctx context.Context, userID string, input SaveFoodRecordInput) (*domain.FoodRecord, error) {
	if !validMealType(input.MealType) {
		return nil, &commonerrors.AppError{Code: 10002, Message: "meal_type 不合法", HTTPStatus: 400}
	}
	normalizedMeal := normalizeMealType(input.MealType, nil)

	recordTime, err := s.buildRecordTime(ctx, input.Date, input.SourceTaskID)
	if err != nil {
		return nil, err
	}

	record := &domain.FoodRecord{
		UserID:           userID,
		MealType:         normalizedMeal,
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
		PFCRatioComment:  input.PFCRatioComment,
		AbsorptionNotes:  input.AbsorptionNotes,
		ContextAdvice:    input.ContextAdvice,
		SourceTaskID:     input.SourceTaskID,
		RecordTime:       recordTime,
	}
	if err := s.recordRepo.Create(ctx, record); err != nil {
		return nil, err
	}
	return record, nil
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
	}
	return records, nil
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
	record = s.hydrateRecord(record)
	record.MealType = normalizeMealType(record.MealType, record.RecordTime)
	return record, nil
}

func (s *FoodRecordService) Update(ctx context.Context, userID, recordID string, input UpdateFoodRecordInput) (*domain.FoodRecord, error) {
	updates := map[string]any{}
	if input.MealType != nil {
		if !validMealType(*input.MealType) {
			return nil, &commonerrors.AppError{Code: 10002, Message: "meal_type 不合法", HTTPStatus: 400}
		}
		updates["meal_type"] = normalizeMealType(*input.MealType, nil)
	}
	if input.Items != nil {
		updates["items"] = input.Items
	}
	if input.TotalCalories != nil {
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
	record = s.hydrateRecord(record)
	record.MealType = normalizeMealType(record.MealType, record.RecordTime)
	return record, nil
}

func (s *FoodRecordService) Delete(ctx context.Context, userID, recordID string) error {
	if err := s.recordRepo.Delete(ctx, userID, recordID); err != nil {
		if err == gorm.ErrRecordNotFound {
			return commonerrors.ErrNotFound
		}
		return err
	}
	return nil
}

func (s *FoodRecordService) Share(ctx context.Context, recordID string) (*domain.FoodRecord, error) {
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
	record = s.hydrateRecord(record)
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
	if record == nil {
		return nil
	}
	if len(record.ImagePaths) == 0 && record.SourceTaskID != nil {
		paths, err := s.taskRepo.GetImagePathsByID(context.Background(), *record.SourceTaskID)
		if err == nil && len(paths) > 0 {
			record.ImagePaths = paths
		}
	}
	if len(record.ImagePaths) == 0 && record.ImagePath != nil && *record.ImagePath != "" {
		record.ImagePaths = []string{*record.ImagePath}
	}
	record.ImagePaths = s.normalizeImagePaths(record.ImagePaths)
	if len(record.ImagePaths) > 0 {
		record.ImagePath = &record.ImagePaths[0]
	} else {
		record.ImagePath = nil
	}
	return record
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
