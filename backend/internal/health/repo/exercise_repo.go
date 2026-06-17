package repo

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode"

	"food_link/backend/internal/health/domain"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

type ExerciseRepo struct {
	db *gorm.DB
}

func NewExerciseRepo(db *gorm.DB) *ExerciseRepo {
	return &ExerciseRepo{db: db}
}

func (r *ExerciseRepo) CreateExerciseLog(ctx context.Context, log *domain.ExerciseLog) error {
	if log.ID == "" {
		log.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(log).Error
}

func (r *ExerciseRepo) ListExerciseLogsByDate(ctx context.Context, userID string, startDate, endDate string) ([]domain.ExerciseLog, error) {
	var rows []domain.ExerciseLog
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if startDate != "" {
		if _, _, err := chinaDateWindow(startDate); err != nil {
			return nil, err
		}
		q = q.Where("recorded_on >= ?", startDate)
	}
	if endDate != "" {
		if _, _, err := chinaDateWindow(endDate); err != nil {
			return nil, err
		}
		q = q.Where("recorded_on <= ?", endDate)
	}
	err := q.Order("recorded_on desc, created_at desc").Find(&rows).Error
	return rows, err
}

func (r *ExerciseRepo) GetExerciseLogByID(ctx context.Context, userID, logID string) (*domain.ExerciseLog, error) {
	var row domain.ExerciseLog
	if err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", logID, userID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *ExerciseRepo) DeleteExerciseLog(ctx context.Context, userID, logID string) (int64, error) {
	result := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", logID, userID).Delete(&domain.ExerciseLog{})
	return result.RowsAffected, result.Error
}

func (r *ExerciseRepo) UpdateExerciseLog(ctx context.Context, userID, logID, exerciseDesc, imageURL string, recordedOn *string, caloriesBurned *float64) (int64, error) {
	updates := map[string]any{}
	if exerciseDesc != "" {
		updates["exercise_desc"] = exerciseDesc
	}
	if imageURL != "" {
		updates["image_url"] = imageURL
	}
	if recordedOn != nil {
		updates["recorded_on"] = *recordedOn
	}
	if caloriesBurned != nil {
		updates["calories_burned"] = *caloriesBurned
	}
	if len(updates) == 0 {
		return 0, nil
	}
	updates["updated_at"] = time.Now()
	result := r.db.WithContext(ctx).Model(&domain.ExerciseLog{}).Where("id = ? AND user_id = ?", logID, userID).Updates(updates)
	return result.RowsAffected, result.Error
}

func (r *ExerciseRepo) GetDailyCaloriesBurned(ctx context.Context, userID string, recordedOn string) (int64, error) {
	if _, _, err := chinaDateWindow(recordedOn); err != nil {
		return 0, err
	}
	var total int64
	err := r.db.WithContext(ctx).Model(&domain.ExerciseLog{}).Where("user_id = ? AND recorded_on = ?", userID, recordedOn).Select("COALESCE(SUM(calories_burned), 0)").Scan(&total).Error
	return total, err
}

func (r *ExerciseRepo) GetUserProfile(ctx context.Context, userID string) (*domain.ExerciseUserProfile, error) {
	var row domain.ExerciseUserProfile
	if err := r.db.WithContext(ctx).Where("id = ?", userID).First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *ExerciseRepo) GetLatestWeightRecord(ctx context.Context, userID string) (*domain.BodyWeightRecord, error) {
	var row domain.BodyWeightRecord
	if err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("recorded_on DESC").
		Order("created_at DESC").
		First(&row).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &row, nil
}

func (r *ExerciseRepo) CreateAnalysisTask(ctx context.Context, task *domain.AnalysisTask) error {
	if task.ID == "" {
		task.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(task).Error
}

func (r *ExerciseRepo) FailAnalysisTask(ctx context.Context, taskID, errorMsg string) error {
	return r.db.WithContext(ctx).Model(&domain.AnalysisTask{}).
		Where("id = ? AND status <> ?", taskID, "cancelled").
		Updates(map[string]any{
			"status":        "failed",
			"error_message": errorMsg,
			"updated_at":    time.Now(),
		}).Error
}

func (r *ExerciseRepo) ResolveExerciseEnergyActivity(ctx context.Context, name string) (*domain.ExerciseEnergyResolveResult, error) {
	raw := strings.TrimSpace(name)
	if raw == "" {
		return &domain.ExerciseEnergyResolveResult{Status: "unresolved"}, nil
	}
	normalized := normalizeExerciseActivityName(raw)
	lower := strings.ToLower(raw)
	activeScope := r.db.WithContext(ctx).Where("is_active = ? AND review_status = ?", true, "active")

	var activity domain.ExerciseEnergyActivity
	err := activeScope.
		Where("LOWER(canonical_name) = ? OR normalized_name = ?", lower, normalized).
		First(&activity).Error
	if err == nil {
		return &domain.ExerciseEnergyResolveResult{Activity: &activity, Status: "exact_canonical", MatchSource: "canonical", Score: 1}, nil
	}
	if isPostgresUndefinedTable(err) {
		return &domain.ExerciseEnergyResolveResult{Status: "library_unavailable"}, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	var alias domain.ExerciseEnergyAlias
	err = r.db.WithContext(ctx).
		Where("LOWER(alias_name) = ? OR normalized_alias = ?", lower, normalized).
		First(&alias).Error
	if err == nil && alias.ActivityID != "" {
		err = activeScope.Where("id = ?", alias.ActivityID).First(&activity).Error
		if err == nil {
			return &domain.ExerciseEnergyResolveResult{Activity: &activity, Status: "exact_alias", MatchSource: "alias", Score: 1}, nil
		}
		if isPostgresUndefinedTable(err) {
			return &domain.ExerciseEnergyResolveResult{Status: "library_unavailable"}, nil
		}
		if err != gorm.ErrRecordNotFound {
			return nil, err
		}
	} else if isPostgresUndefinedTable(err) {
		return &domain.ExerciseEnergyResolveResult{Status: "library_unavailable"}, nil
	} else if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	candidates, err := r.SearchExerciseEnergyActivities(ctx, raw, 1)
	if err != nil {
		if isPostgresUndefinedTable(err) {
			return &domain.ExerciseEnergyResolveResult{Status: "library_unavailable"}, nil
		}
		return nil, err
	}
	if len(candidates) > 0 {
		candidate := candidates[0]
		score := exerciseActivityScore(raw, candidate.CanonicalName, candidate.Category)
		if score >= 0.42 {
			return &domain.ExerciseEnergyResolveResult{Activity: &candidate, Status: "fuzzy", MatchSource: "fuzzy", Score: score}, nil
		}
	}
	return &domain.ExerciseEnergyResolveResult{Status: "unresolved"}, nil
}

func (r *ExerciseRepo) SearchExerciseEnergyActivities(ctx context.Context, query string, limit int) ([]domain.ExerciseEnergyActivity, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 50 {
		limit = 50
	}
	like := "%" + query + "%"
	normalizedLike := "%" + normalizeExerciseActivityName(query) + "%"
	var rows []domain.ExerciseEnergyActivity
	err := r.db.WithContext(ctx).
		Model(&domain.ExerciseEnergyActivity{}).
		Where("is_active = ? AND review_status = ?", true, "active").
		Where(`
			canonical_name ILIKE ?
			OR normalized_name LIKE ?
			OR category ILIKE ?
			OR evidence ILIKE ?
			OR id IN (
				SELECT activity_id FROM exercise_energy_aliases
				WHERE alias_name ILIKE ? OR normalized_alias LIKE ?
			)
		`, like, normalizedLike, like, like, like, normalizedLike).
		Order("updated_at DESC").
		Limit(limit).
		Find(&rows).Error
	if isPostgresUndefinedTable(err) {
		return nil, nil
	}
	return rows, err
}

func (r *ExerciseRepo) CreatePendingExerciseEnergyActivity(ctx context.Context, input domain.ExerciseEnergyActivityInput) (*domain.ExerciseEnergyActivity, error) {
	name := strings.TrimSpace(input.CanonicalName)
	if name == "" {
		return nil, gorm.ErrInvalidData
	}
	normalized := normalizeExerciseActivityName(name)
	if normalized == "" {
		normalized = strings.ToLower(name)
	}
	var existing domain.ExerciseEnergyActivity
	err := r.db.WithContext(ctx).Where("normalized_name = ?", normalized).First(&existing).Error
	if err == nil {
		return &existing, nil
	}
	if isPostgresUndefinedTable(err) {
		return nil, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}
	status := strings.TrimSpace(input.ReviewStatus)
	if status == "" {
		status = "pending"
	}
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "llm_pending"
	}
	category := normalizeExerciseCategory(input.Category)
	intensity := normalizeExerciseIntensity(input.Intensity)
	now := time.Now().UTC()
	activity := &domain.ExerciseEnergyActivity{
		ID:             uuid.New().String(),
		CanonicalName:  name,
		NormalizedName: normalized,
		Category:       category,
		Intensity:      intensity,
		METValue:       clampMET(input.METValue),
		Source:         source,
		Evidence:       strings.TrimSpace(input.Evidence),
		ReviewStatus:   status,
		IsActive:       input.IsActive,
		CreatedAt:      &now,
		UpdatedAt:      &now,
	}
	if err := r.db.WithContext(ctx).Create(activity).Error; err != nil {
		if isPostgresUndefinedTable(err) {
			return nil, nil
		}
		return nil, err
	}
	if err := r.replaceExerciseEnergyAliases(ctx, activity.ID, append(input.Aliases, name)); err != nil {
		if isPostgresUndefinedTable(err) {
			return activity, nil
		}
		return nil, err
	}
	return activity, nil
}

func isPostgresUndefinedTable(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "42P01" {
		return true
	}
	return strings.Contains(err.Error(), "SQLSTATE 42P01")
}

type ListExerciseEnergyActivitiesInput struct {
	Query        string
	ReviewStatus string
	Active       string
	Limit        int
	Offset       int
}

type ListExerciseEnergyActivitiesResult struct {
	Items []domain.ExerciseEnergyActivity
	Total int64
}

type ExerciseEnergyActivityPatch map[string]any

func (r *ExerciseRepo) ListExerciseEnergyActivities(ctx context.Context, input ListExerciseEnergyActivitiesInput) (*ListExerciseEnergyActivitiesResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 40
	}
	if limit > 100 {
		limit = 100
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}
	query := r.db.WithContext(ctx).Model(&domain.ExerciseEnergyActivity{})
	if q := strings.TrimSpace(input.Query); q != "" {
		like := "%" + q + "%"
		normalizedLike := "%" + normalizeExerciseActivityName(q) + "%"
		query = query.Where(`canonical_name ILIKE ? OR normalized_name LIKE ? OR category ILIKE ? OR evidence ILIKE ?`, like, normalizedLike, like, like)
	}
	switch strings.TrimSpace(input.ReviewStatus) {
	case "", "all":
	default:
		query = query.Where("review_status = ?", strings.TrimSpace(input.ReviewStatus))
	}
	switch strings.TrimSpace(input.Active) {
	case "true":
		query = query.Where("is_active = ?", true)
	case "false":
		query = query.Where("is_active = ?", false)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var items []domain.ExerciseEnergyActivity
	if err := query.Order("updated_at DESC").Offset(offset).Limit(limit).Find(&items).Error; err != nil {
		return nil, err
	}
	return &ListExerciseEnergyActivitiesResult{Items: items, Total: total}, nil
}

func (r *ExerciseRepo) GetExerciseEnergyActivity(ctx context.Context, id string) (*domain.ExerciseEnergyActivity, error) {
	var item domain.ExerciseEnergyActivity
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *ExerciseRepo) ListExerciseEnergyAliases(ctx context.Context, activityID string) ([]domain.ExerciseEnergyAlias, error) {
	var aliases []domain.ExerciseEnergyAlias
	err := r.db.WithContext(ctx).Where("activity_id = ?", activityID).Order("alias_name ASC").Find(&aliases).Error
	return aliases, err
}

func (r *ExerciseRepo) UpdateExerciseEnergyActivity(ctx context.Context, id string, patch ExerciseEnergyActivityPatch, aliases *[]string) (*domain.ExerciseEnergyActivity, error) {
	if len(patch) > 0 {
		patch["updated_at"] = time.Now().UTC()
		if err := r.db.WithContext(ctx).Model(&domain.ExerciseEnergyActivity{}).Where("id = ?", id).Updates(map[string]any(patch)).Error; err != nil {
			return nil, err
		}
	}
	if aliases != nil {
		if err := r.replaceExerciseEnergyAliases(ctx, id, *aliases); err != nil {
			return nil, err
		}
	}
	return r.GetExerciseEnergyActivity(ctx, id)
}

func (r *ExerciseRepo) replaceExerciseEnergyAliases(ctx context.Context, activityID string, aliases []string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("activity_id = ?", activityID).Delete(&domain.ExerciseEnergyAlias{}).Error; err != nil {
			return err
		}
		seen := map[string]bool{}
		rows := make([]domain.ExerciseEnergyAlias, 0, len(aliases))
		for _, alias := range aliases {
			alias = strings.TrimSpace(alias)
			normalized := normalizeExerciseActivityName(alias)
			if alias == "" || normalized == "" || seen[normalized] {
				continue
			}
			seen[normalized] = true
			now := time.Now().UTC()
			rows = append(rows, domain.ExerciseEnergyAlias{
				ID:              uuid.New().String(),
				ActivityID:      activityID,
				AliasName:       alias,
				NormalizedAlias: normalized,
				CreatedAt:       &now,
			})
		}
		if len(rows) == 0 {
			return nil
		}
		return tx.Create(&rows).Error
	})
}

var exerciseNormalizeRe = regexp.MustCompile(`[\s\p{P}\p{S}]+`)

func normalizeExerciseActivityName(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	value = exerciseNormalizeRe.ReplaceAllString(value, "")
	out := strings.Builder{}
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			out.WriteRune(r)
		}
	}
	return out.String()
}

func normalizeExerciseCategory(value string) string {
	switch strings.TrimSpace(value) {
	case "cardio", "有氧":
		return "cardio"
	case "strength", "力量":
		return "strength"
	case "ball", "球类":
		return "ball"
	case "flexibility", "拉伸", "灵活拉伸":
		return "flexibility"
	case "daily", "日常活动":
		return "daily"
	default:
		return "other"
	}
}

func normalizeExerciseIntensity(value string) string {
	switch strings.TrimSpace(value) {
	case "low", "低":
		return "low"
	case "high", "高":
		return "high"
	default:
		return "moderate"
	}
}

func clampMET(value float64) float64 {
	if value <= 0 {
		return 3.5
	}
	if value > 30 {
		return 30
	}
	return value
}

func exerciseActivityScore(query, name, category string) float64 {
	q := normalizeExerciseActivityName(query)
	n := normalizeExerciseActivityName(name)
	if q == "" || n == "" {
		return 0
	}
	if q == n {
		return 1
	}
	if strings.Contains(q, n) || strings.Contains(n, q) {
		return 0.72
	}
	for _, token := range []string{name, category} {
		if token != "" && strings.Contains(strings.ToLower(query), strings.ToLower(token)) {
			return 0.5
		}
	}
	return 0
}
