package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"time"

	"food_link/backend/internal/foodrecord/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrPackagedFoodCorrectionAlreadyReviewed = errors.New("packaged food correction already reviewed")
	ErrPackagedFoodCorrectionStale           = errors.New("packaged food correction is stale")
)

type ListPackagedFoodCorrectionsInput struct {
	Query  string
	Status string
	Limit  int
	Offset int
}

type ListPackagedFoodCorrectionsResult struct {
	Items []domain.PackagedFoodCorrectionSubmission
	Total int64
}

func (r *FoodNutritionRepo) GetPackagedFoodByID(ctx context.Context, id string) (*domain.PackagedFood, error) {
	var item domain.PackagedFood
	if err := r.db.WithContext(ctx).Where("id = ?", strings.TrimSpace(id)).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *FoodNutritionRepo) CreatePackagedFoodCorrectionSubmission(ctx context.Context, item *domain.PackagedFoodCorrectionSubmission) error {
	if strings.TrimSpace(item.ID) == "" {
		item.ID = uuid.NewString()
	}
	return r.db.WithContext(ctx).Create(item).Error
}

func (r *FoodNutritionRepo) GetPackagedFoodCorrectionSubmission(ctx context.Context, id string) (*domain.PackagedFoodCorrectionSubmission, error) {
	var item domain.PackagedFoodCorrectionSubmission
	if err := r.db.WithContext(ctx).Where("id = ?", strings.TrimSpace(id)).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *FoodNutritionRepo) ListPackagedFoodCorrectionSubmissions(ctx context.Context, input ListPackagedFoodCorrectionsInput) (*ListPackagedFoodCorrectionsResult, error) {
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

	query := r.db.WithContext(ctx).Model(&domain.PackagedFoodCorrectionSubmission{})
	if status := strings.TrimSpace(input.Status); status != "" && status != "all" {
		query = query.Where("status = ?", status)
	}
	if q := strings.TrimSpace(input.Query); q != "" {
		like := "%" + q + "%"
		query = query.Where(`
			comment ILIKE ?
			OR reason_type ILIKE ?
			OR evidence_barcode ILIKE ?
			OR CAST(proposed_patch AS TEXT) ILIKE ?
			OR CAST(before_snapshot AS TEXT) ILIKE ?
		`, like, like, like, like, like)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []domain.PackagedFoodCorrectionSubmission
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&items).Error; err != nil {
		return nil, err
	}
	return &ListPackagedFoodCorrectionsResult{Items: items, Total: total}, nil
}

func (r *FoodNutritionRepo) ReviewPackagedFoodCorrectionSubmission(
	ctx context.Context,
	submissionID string,
	approved bool,
	reviewNote string,
	adminAccountID string,
) (*domain.PackagedFoodCorrectionSubmission, *domain.PackagedFood, error) {
	var submission domain.PackagedFoodCorrectionSubmission
	var food domain.PackagedFood
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", strings.TrimSpace(submissionID)).First(&submission).Error; err != nil {
			return err
		}
		if submission.Status != "pending" {
			return ErrPackagedFoodCorrectionAlreadyReviewed
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", submission.PackagedFoodID).First(&food).Error; err != nil {
			return err
		}

		now := time.Now()
		reviewNote = strings.TrimSpace(reviewNote)
		adminAccountID = strings.TrimSpace(adminAccountID)
		updates := map[string]any{
			"review_note": reviewNote,
			"reviewed_by": nullableString(adminAccountID),
			"reviewed_at": now,
			"updated_at":  now,
		}

		if !approved {
			updates["status"] = "rejected"
			if err := updatePendingPackagedFoodCorrection(tx, submission.ID, updates); err != nil {
				return err
			}
			return tx.Where("id = ?", submission.ID).First(&submission).Error
		}

		patch := cloneMap(submission.ProposedPatch)
		if len(patch) == 0 {
			updates["status"] = "rejected"
			if reviewNote == "" {
				updates["review_note"] = "提案未包含有效字段变更"
			}
			if err := updatePendingPackagedFoodCorrection(tx, submission.ID, updates); err != nil {
				return err
			}
			return tx.Where("id = ?", submission.ID).First(&submission).Error
		}

		beforeSnapshot, err := packagedFoodSnapshot(food)
		if err != nil {
			return err
		}
		if !packagedFoodPatchBaseMatches(beforeSnapshot, submission.BeforeSnapshot, patch) {
			return ErrPackagedFoodCorrectionStale
		}
		patch["updated_at"] = now
		if err := tx.Model(&domain.PackagedFood{}).Where("id = ?", food.ID).Updates(patch).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", food.ID).First(&food).Error; err != nil {
			return err
		}
		afterSnapshot, err := packagedFoodSnapshot(food)
		if err != nil {
			return err
		}
		log := &domain.PackagedFoodChangeLog{
			ID:             uuid.NewString(),
			PackagedFoodID: food.ID,
			SubmissionID:   &submission.ID,
			OperatorID:     nullableString(adminAccountID),
			OperatorType:   "admin",
			BeforeSnapshot: beforeSnapshot,
			AfterSnapshot:  afterSnapshot,
			ChangedFields:  sortedKeys(submission.ProposedPatch),
		}
		if err := tx.Create(log).Error; err != nil {
			return err
		}

		updates["status"] = "applied"
		updates["applied_at"] = now
		if err := updatePendingPackagedFoodCorrection(tx, submission.ID, updates); err != nil {
			return err
		}
		return tx.Where("id = ?", submission.ID).First(&submission).Error
	})
	if err != nil {
		return nil, nil, err
	}
	return &submission, &food, nil
}

func updatePendingPackagedFoodCorrection(tx *gorm.DB, submissionID string, updates map[string]any) error {
	result := tx.Model(&domain.PackagedFoodCorrectionSubmission{}).
		Where("id = ? AND status = ?", submissionID, "pending").
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrPackagedFoodCorrectionAlreadyReviewed
	}
	return nil
}

func packagedFoodPatchBaseMatches(current, original, patch map[string]any) bool {
	for field := range patch {
		if !reflect.DeepEqual(normalizeComparableValue(current[field]), normalizeComparableValue(original[field])) {
			return false
		}
	}
	return true
}

func packagedFoodSnapshot(item domain.PackagedFood) (map[string]any, error) {
	encoded, err := json.Marshal(item)
	if err != nil {
		return nil, fmt.Errorf("marshal packaged food snapshot: %w", err)
	}
	var out map[string]any
	if err := json.Unmarshal(encoded, &out); err != nil {
		return nil, fmt.Errorf("unmarshal packaged food snapshot: %w", err)
	}
	delete(out, "created_at")
	delete(out, "updated_at")
	return out, nil
}

func DiffPackagedFoodPatch(before map[string]any, proposed map[string]any) map[string]any {
	diff := map[string]any{}
	for key, value := range proposed {
		if !reflect.DeepEqual(normalizeComparableValue(before[key]), normalizeComparableValue(value)) {
			diff[key] = value
		}
	}
	return diff
}

func normalizeComparableValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return ""
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int32:
		return float64(typed)
	case int64:
		return float64(typed)
	case []any:
		return typed
	case []string:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			out = append(out, strings.TrimSpace(item))
		}
		return out
	case string:
		return strings.TrimSpace(typed)
	default:
		return typed
	}
}

func sortedKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func cloneMap(values map[string]any) map[string]any {
	if len(values) == 0 {
		return map[string]any{}
	}
	out := make(map[string]any, len(values))
	for key, value := range values {
		out[key] = value
	}
	return out
}

func nullableString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
