package repo

import (
	"context"
	"errors"
	"time"

	"food_link/backend/internal/recipe/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type RecipeRepo struct {
	db *gorm.DB
}

func NewRecipeRepo(db *gorm.DB) *RecipeRepo {
	return &RecipeRepo{db: db}
}

func (r *RecipeRepo) Create(ctx context.Context, recipe *domain.Recipe) error {
	if recipe.ID == "" {
		recipe.ID = uuid.New().String()
	}
	return r.db.WithContext(ctx).Create(recipe).Error
}

func (r *RecipeRepo) List(ctx context.Context, userID, mealType string, isFavorite *bool) ([]domain.Recipe, error) {
	var rows []domain.Recipe
	q := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if mealType != "" {
		q = q.Where("meal_type = ?", mealType)
	}
	if isFavorite != nil {
		q = q.Where("is_favorite = ?", *isFavorite)
	}
	err := q.Order("created_at desc").Find(&rows).Error
	return rows, err
}

func (r *RecipeRepo) Count(ctx context.Context, userID string, isFavorite *bool) (int64, error) {
	var count int64
	q := r.db.WithContext(ctx).Model(&domain.Recipe{}).Where("user_id = ?", userID)
	if isFavorite != nil {
		q = q.Where("is_favorite = ?", *isFavorite)
	}
	return count, q.Count(&count).Error
}

func (r *RecipeRepo) Get(ctx context.Context, recipeID, userID string) (*domain.Recipe, error) {
	var row domain.Recipe
	err := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", recipeID, userID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &row, err
}

func (r *RecipeRepo) Update(ctx context.Context, recipeID, userID string, updates map[string]any) (*domain.Recipe, error) {
	result := r.db.WithContext(ctx).Model(&domain.Recipe{}).Where("id = ? AND user_id = ?", recipeID, userID).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return r.Get(ctx, recipeID, userID)
}

func (r *RecipeRepo) Delete(ctx context.Context, recipeID, userID string) error {
	result := r.db.WithContext(ctx).Where("id = ? AND user_id = ?", recipeID, userID).Delete(&domain.Recipe{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *RecipeRepo) InsertFoodRecord(ctx context.Context, record *domain.FoodRecord) error {
	if record.ID == "" {
		record.ID = uuid.New().String()
	}
	now := time.Now()
	record.RecordTime = &now
	return r.db.WithContext(ctx).Create(record).Error
}

func (r *RecipeRepo) MarkUsed(ctx context.Context, recipeID, userID string, useCount int) error {
	return r.db.WithContext(ctx).Model(&domain.Recipe{}).Where("id = ? AND user_id = ?", recipeID, userID).Updates(map[string]any{
		"use_count":    useCount + 1,
		"last_used_at": time.Now(),
	}).Error
}
