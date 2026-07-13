package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"food_link/backend/internal/foodrecord/domain"
	foodrecordrepo "food_link/backend/internal/foodrecord/repo"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AliasCandidatePending  = "pending"
	AliasCandidateApproved = "approved"
	AliasCandidateRejected = "rejected"
)

type NutritionAliasCandidate struct {
	ID                    string         `gorm:"column:id" json:"id"`
	AliasName             string         `gorm:"column:alias_name" json:"alias_name"`
	NormalizedAlias       string         `gorm:"column:normalized_alias" json:"normalized_alias"`
	ProposedFoodID        string         `gorm:"column:proposed_food_id" json:"proposed_food_id"`
	ProposedCanonicalName string         `gorm:"column:proposed_canonical_name;->" json:"proposed_canonical_name"`
	KcalPer100g           float64        `gorm:"column:kcal_per_100g;->" json:"kcal_per_100g"`
	ProteinPer100g        float64        `gorm:"column:protein_per_100g;->" json:"protein_per_100g"`
	CarbsPer100g          float64        `gorm:"column:carbs_per_100g;->" json:"carbs_per_100g"`
	FatPer100g            float64        `gorm:"column:fat_per_100g;->" json:"fat_per_100g"`
	Source                string         `gorm:"column:source" json:"source"`
	SourceTaskID          *string        `gorm:"column:source_task_id" json:"source_task_id,omitempty"`
	Model                 *string        `gorm:"column:model" json:"model,omitempty"`
	ModelDecision         *string        `gorm:"column:model_decision" json:"model_decision,omitempty"`
	ModelConfidence       *float64       `gorm:"column:model_confidence" json:"model_confidence,omitempty"`
	ModelReason           *string        `gorm:"column:model_reason" json:"model_reason,omitempty"`
	SuggestedAliases      []string       `gorm:"column:suggested_aliases;serializer:json" json:"suggested_aliases"`
	RuleFlags             []string       `gorm:"column:rule_flags;serializer:json" json:"rule_flags"`
	CandidateSnapshot     map[string]any `gorm:"column:candidate_snapshot;serializer:json" json:"candidate_snapshot"`
	Status                string         `gorm:"column:status" json:"status"`
	ReviewerID            *string        `gorm:"column:reviewer_id" json:"reviewer_id,omitempty"`
	ReviewedAt            *time.Time     `gorm:"column:reviewed_at" json:"reviewed_at,omitempty"`
	ReviewNote            *string        `gorm:"column:review_note" json:"review_note,omitempty"`
	GeneratedFromID       *string        `gorm:"column:generated_from_id" json:"generated_from_id,omitempty"`
	CreatedAt             time.Time      `gorm:"column:created_at" json:"created_at"`
	UpdatedAt             time.Time      `gorm:"column:updated_at" json:"updated_at"`
}

func (NutritionAliasCandidate) TableName() string { return "food_nutrition_alias_candidates" }

type ListNutritionAliasCandidatesInput struct {
	Query  string
	Status string
	Source string
	Limit  int
	Offset int
}

type ListNutritionAliasCandidatesResult struct {
	Items []NutritionAliasCandidate
	Total int64
}

type CreateNutritionAliasCandidateInput struct {
	AliasName       string
	ProposedFoodID  string
	Source          string
	SourceTaskID    *string
	Model           *string
	ModelDecision   *string
	ModelConfidence *float64
	ModelReason     *string
	RuleFlags       []string
	GeneratedFromID *string
}

type AliasAIReviewUpdate struct {
	Model            string
	Decision         string
	Confidence       float64
	Reason           string
	SuggestedAliases []string
	RuleFlags        []string
}

type NutritionAliasReviewRepo struct {
	db *gorm.DB
}

func NewNutritionAliasReviewRepo(db *gorm.DB) *NutritionAliasReviewRepo {
	return &NutritionAliasReviewRepo{db: db}
}

func aliasCandidateSelect() string {
	return `c.*, f.canonical_name AS proposed_canonical_name,
		f.kcal_per_100g, f.protein_per_100g, f.carbs_per_100g, f.fat_per_100g`
}

func (r *NutritionAliasReviewRepo) List(ctx context.Context, input ListNutritionAliasCandidatesInput) (*ListNutritionAliasCandidatesResult, error) {
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
	query := r.db.WithContext(ctx).Table("food_nutrition_alias_candidates AS c").
		Joins("JOIN food_nutrition_library AS f ON f.id = c.proposed_food_id")
	if status := strings.TrimSpace(input.Status); status != "" && status != "all" {
		query = query.Where("c.status = ?", status)
	}
	if source := strings.TrimSpace(input.Source); source != "" && source != "all" {
		query = query.Where("c.source = ?", source)
	}
	if q := strings.TrimSpace(input.Query); q != "" {
		like := "%" + strings.ToLower(q) + "%"
		query = query.Where("LOWER(c.alias_name) LIKE ? OR LOWER(f.canonical_name) LIKE ?", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	var items []NutritionAliasCandidate
	if err := query.Select(aliasCandidateSelect()).
		Order("CASE c.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, c.created_at DESC").
		Offset(offset).Limit(limit).Scan(&items).Error; err != nil {
		return nil, err
	}
	return &ListNutritionAliasCandidatesResult{Items: items, Total: total}, nil
}

func (r *NutritionAliasReviewRepo) Get(ctx context.Context, id string) (*NutritionAliasCandidate, error) {
	var item NutritionAliasCandidate
	err := r.db.WithContext(ctx).Table("food_nutrition_alias_candidates AS c").
		Joins("JOIN food_nutrition_library AS f ON f.id = c.proposed_food_id").
		Select(aliasCandidateSelect()).Where("c.id = ?", strings.TrimSpace(id)).Scan(&item).Error
	if err != nil {
		return nil, err
	}
	if item.ID == "" {
		return nil, gorm.ErrRecordNotFound
	}
	return &item, nil
}

func (r *NutritionAliasReviewRepo) Create(ctx context.Context, input CreateNutritionAliasCandidateInput) (*NutritionAliasCandidate, error) {
	aliasName := strings.TrimSpace(input.AliasName)
	foodID := strings.TrimSpace(input.ProposedFoodID)
	if aliasName == "" || foodID == "" {
		return nil, fmt.Errorf("别名和目标食物不能为空")
	}
	var food domain.FoodNutrition
	if err := r.db.WithContext(ctx).Where("id = ? AND is_active = ?", foodID, true).First(&food).Error; err != nil {
		return nil, fmt.Errorf("目标食物不存在或已停用: %w", err)
	}
	if err := foodrecordrepo.ValidateNutritionAliasTarget(aliasName, food); err != nil {
		return nil, err
	}
	normalized := normalizeFoodNutritionName(aliasName)
	var active domain.FoodNutritionAlias
	err := r.db.WithContext(ctx).Where("normalized_alias = ?", normalized).First(&active).Error
	if err == nil {
		return nil, fmt.Errorf("该别名已在正式库中，目标食物 ID 为 %s", active.FoodID)
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	var existing NutritionAliasCandidate
	err = r.db.WithContext(ctx).Where("normalized_alias = ? AND proposed_food_id = ? AND status = ?", normalized, foodID, AliasCandidatePending).First(&existing).Error
	if err == nil {
		return r.Get(ctx, existing.ID)
	}
	if err != nil && err != gorm.ErrRecordNotFound {
		return nil, err
	}
	source := strings.TrimSpace(input.Source)
	if source == "" {
		source = "admin_manual"
	}
	now := time.Now()
	row := NutritionAliasCandidate{
		ID:                uuid.NewString(),
		AliasName:         aliasName,
		NormalizedAlias:   normalized,
		ProposedFoodID:    foodID,
		Source:            source,
		SourceTaskID:      input.SourceTaskID,
		Model:             input.Model,
		ModelDecision:     input.ModelDecision,
		ModelConfidence:   input.ModelConfidence,
		ModelReason:       input.ModelReason,
		RuleFlags:         input.RuleFlags,
		SuggestedAliases:  []string{},
		CandidateSnapshot: foodSnapshot(food),
		Status:            AliasCandidatePending,
		GeneratedFromID:   input.GeneratedFromID,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if row.RuleFlags == nil {
		row.RuleFlags = []string{}
	}
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		return nil, err
	}
	return r.Get(ctx, row.ID)
}

func foodSnapshot(food domain.FoodNutrition) map[string]any {
	return map[string]any{
		"canonical_name":  food.CanonicalName,
		"kcal_per_100g":   food.KcalPer100g,
		"protein_per_100g": food.ProteinPer100g,
		"carbs_per_100g":  food.CarbsPer100g,
		"fat_per_100g":    food.FatPer100g,
		"source":           food.Source,
	}
}

func jsonValue(value any) (datatypes.JSON, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return datatypes.JSON(data), nil
}

func (r *NutritionAliasReviewRepo) SaveAIReview(ctx context.Context, id string, update AliasAIReviewUpdate) (*NutritionAliasCandidate, error) {
	suggested, err := jsonValue(update.SuggestedAliases)
	if err != nil {
		return nil, err
	}
	flags, err := jsonValue(update.RuleFlags)
	if err != nil {
		return nil, err
	}
	err = r.db.WithContext(ctx).Model(&NutritionAliasCandidate{}).
		Where("id = ? AND status = ?", strings.TrimSpace(id), AliasCandidatePending).
		Updates(map[string]any{
			"model":             strings.TrimSpace(update.Model),
			"model_decision":    strings.TrimSpace(update.Decision),
			"model_confidence":  update.Confidence,
			"model_reason":      strings.TrimSpace(update.Reason),
			"suggested_aliases": suggested,
			"rule_flags":        flags,
			"updated_at":        time.Now(),
		}).Error
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

func (r *NutritionAliasReviewRepo) Review(ctx context.Context, id, decision, reviewerID, note string) (*NutritionAliasCandidate, error) {
	decision = strings.TrimSpace(decision)
	if decision != AliasCandidateApproved && decision != AliasCandidateRejected {
		return nil, fmt.Errorf("审核结论必须为 approved 或 rejected")
	}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var candidate NutritionAliasCandidate
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", strings.TrimSpace(id)).First(&candidate).Error; err != nil {
			return err
		}
		if candidate.Status != AliasCandidatePending {
			return fmt.Errorf("该候选已经审核，不能重复操作")
		}
		if decision == AliasCandidateApproved {
			var food domain.FoodNutrition
			if err := tx.Where("id = ? AND is_active = ?", candidate.ProposedFoodID, true).First(&food).Error; err != nil {
				return fmt.Errorf("目标食物不存在或已停用: %w", err)
			}
			if err := foodrecordrepo.ValidateNutritionAliasTarget(candidate.AliasName, food); err != nil {
				return fmt.Errorf("审核门禁拒绝发布: %w", err)
			}
			var existing domain.FoodNutritionAlias
			err := tx.Where("normalized_alias = ?", candidate.NormalizedAlias).First(&existing).Error
			if err == nil && existing.FoodID != candidate.ProposedFoodID {
				return fmt.Errorf("正式别名已指向其他食物 %s", existing.FoodID)
			}
			if err != nil && err != gorm.ErrRecordNotFound {
				return err
			}
			if err == gorm.ErrRecordNotFound {
				if err := tx.Create(&domain.FoodNutritionAlias{
					ID:              uuid.NewString(),
					FoodID:          candidate.ProposedFoodID,
					AliasName:       candidate.AliasName,
					NormalizedAlias: candidate.NormalizedAlias,
				}).Error; err != nil {
					return err
				}
			}
		}
		now := time.Now()
		updates := map[string]any{
			"status":      decision,
			"reviewed_at": now,
			"review_note": strings.TrimSpace(note),
			"updated_at":  now,
		}
		if strings.TrimSpace(reviewerID) != "" {
			updates["reviewer_id"] = strings.TrimSpace(reviewerID)
		}
		return tx.Model(&NutritionAliasCandidate{}).Where("id = ?", candidate.ID).Updates(updates).Error
	})
	if err != nil {
		return nil, err
	}
	return r.Get(ctx, id)
}

