package repo

import (
	"context"
	"time"

	"food_link/backend/internal/testbackend/domain"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// PromptRepo handles test_prompts and test_prompt_history.
type PromptRepo struct {
	db *gorm.DB
}

func NewPromptRepo(db *gorm.DB) *PromptRepo {
	return &PromptRepo{db: db}
}

func (r *PromptRepo) ListPrompts(ctx context.Context) ([]domain.Prompt, error) {
	var items []domain.Prompt
	err := r.db.WithContext(ctx).Order("created_at desc").Find(&items).Error
	return items, err
}

func (r *PromptRepo) CreatePrompt(ctx context.Context, p *domain.Prompt) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	now := time.Now()
	p.CreatedAt = &now
	p.UpdatedAt = &now
	p.Version = 1
	return r.db.WithContext(ctx).Create(p).Error
}

func (r *PromptRepo) GetPromptByID(ctx context.Context, id string) (*domain.Prompt, error) {
	var item domain.Prompt
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (r *PromptRepo) GetActivePromptByModelType(ctx context.Context, modelType string) (*domain.Prompt, error) {
	var item domain.Prompt
	if err := r.db.WithContext(ctx).Where("model_type = ? AND is_active = ?", modelType, true).First(&item).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (r *PromptRepo) UpdatePrompt(ctx context.Context, id string, updates map[string]any) (*domain.Prompt, error) {
	updates["updated_at"] = time.Now()
	result := r.db.WithContext(ctx).Model(&domain.Prompt{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return r.GetPromptByID(ctx, id)
}

func (r *PromptRepo) DeletePrompt(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&domain.Prompt{}, "id = ?", id).Error
}

func (r *PromptRepo) DeactivateByModelType(ctx context.Context, modelType string) error {
	return r.db.WithContext(ctx).Model(&domain.Prompt{}).
		Where("model_type = ? AND is_active = ?", modelType, true).
		Update("is_active", false).Error
}

func (r *PromptRepo) CreatePromptHistory(ctx context.Context, h *domain.PromptHistory) error {
	if h.ID == "" {
		h.ID = uuid.New().String()
	}
	now := time.Now()
	h.CreatedAt = &now
	return r.db.WithContext(ctx).Create(h).Error
}

func (r *PromptRepo) ListPromptHistory(ctx context.Context, promptID string) ([]domain.PromptHistory, error) {
	var items []domain.PromptHistory
	err := r.db.WithContext(ctx).Where("prompt_id = ?", promptID).Order("version desc, created_at desc").Find(&items).Error
	return items, err
}

// BatchRepo handles test_batches.
type BatchRepo struct {
	db *gorm.DB
}

func NewBatchRepo(db *gorm.DB) *BatchRepo {
	return &BatchRepo{db: db}
}

func (r *BatchRepo) CreateBatch(ctx context.Context, b *domain.TestBatch) error {
	if b.ID == "" {
		b.ID = uuid.New().String()
	}
	now := time.Now()
	b.CreatedAt = &now
	b.UpdatedAt = &now
	return r.db.WithContext(ctx).Create(b).Error
}

func (r *BatchRepo) GetBatchByID(ctx context.Context, id string) (*domain.TestBatch, error) {
	var item domain.TestBatch
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (r *BatchRepo) UpdateBatch(ctx context.Context, id string, updates map[string]any) (*domain.TestBatch, error) {
	updates["updated_at"] = time.Now()
	result := r.db.WithContext(ctx).Model(&domain.TestBatch{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return r.GetBatchByID(ctx, id)
}

// DatasetRepo handles test_datasets.
type DatasetRepo struct {
	db *gorm.DB
}

func NewDatasetRepo(db *gorm.DB) *DatasetRepo {
	return &DatasetRepo{db: db}
}

func (r *DatasetRepo) ListDatasets(ctx context.Context) ([]domain.TestDataset, error) {
	var items []domain.TestDataset
	err := r.db.WithContext(ctx).Order("created_at desc").Find(&items).Error
	return items, err
}

func (r *DatasetRepo) CreateDataset(ctx context.Context, d *domain.TestDataset) error {
	if d.ID == "" {
		d.ID = uuid.New().String()
	}
	now := time.Now()
	d.CreatedAt = &now
	return r.db.WithContext(ctx).Create(d).Error
}

func (r *DatasetRepo) GetDatasetByID(ctx context.Context, id string) (*domain.TestDataset, error) {
	var item domain.TestDataset
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, err
	}
	return &item, nil
}

func (r *DatasetRepo) UpdateDataset(ctx context.Context, id string, updates map[string]any) (*domain.TestDataset, error) {
	result := r.db.WithContext(ctx).Model(&domain.TestDataset{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return r.GetDatasetByID(ctx, id)
}
