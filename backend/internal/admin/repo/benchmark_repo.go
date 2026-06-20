package repo

import (
	"context"
	"strings"

	"food_link/backend/internal/admin/domain"
	"food_link/backend/internal/migration/do"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type BenchmarkRepo struct {
	db *gorm.DB
}

func NewBenchmarkRepo(db *gorm.DB) *BenchmarkRepo {
	return &BenchmarkRepo{db: db}
}

// Dataset samples

func (r *BenchmarkRepo) ListBatches(ctx context.Context) ([]string, error) {
	var batches []string
	err := r.db.WithContext(ctx).
		Model(&do.FoodWeightLabeledSampleDO{}).
		Distinct("batch_name").
		Pluck("batch_name", &batches).Error
	return batches, err
}

func (r *BenchmarkRepo) ListSamples(ctx context.Context, input domain.ListSamplesInput) (*domain.ListSamplesResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	page := input.Page
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	q := r.db.WithContext(ctx).Model(&do.FoodWeightLabeledSampleDO{})
	q = applySampleFilters(q, input)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []do.FoodWeightLabeledSampleDO
	if err := q.Order("batch_name, sample_name").Offset(offset).Limit(limit).Find(&items).Error; err != nil {
		return nil, err
	}
	return &domain.ListSamplesResult{Items: items, Total: total, Page: page, Limit: limit}, nil
}

func (r *BenchmarkRepo) GetSample(ctx context.Context, id string) (*do.FoodWeightLabeledSampleDO, error) {
	var item do.FoodWeightLabeledSampleDO
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *BenchmarkRepo) CreateSample(ctx context.Context, sample *do.FoodWeightLabeledSampleDO) error {
	return r.db.WithContext(ctx).Create(sample).Error
}

func (r *BenchmarkRepo) UpdateSample(ctx context.Context, id string, input domain.UpdateSampleInput) (*do.FoodWeightLabeledSampleDO, error) {
	updates := map[string]any{}
	if input.LabelType != nil {
		updates["label_type"] = *input.LabelType
	}
	if input.TotalWeightGrams != nil {
		updates["total_weight_grams"] = *input.TotalWeightGrams
	}
	if input.Items != nil {
		updates["items"] = datatypes.JSONMap(input.Items)
	}
	if input.Status != nil {
		updates["status"] = *input.Status
	}
	if input.Metadata != nil {
		updates["metadata"] = datatypes.JSONMap(input.Metadata)
	}
	if len(updates) == 0 {
		return r.GetSample(ctx, id)
	}
	if err := r.db.WithContext(ctx).Model(&do.FoodWeightLabeledSampleDO{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		return nil, err
	}
	return r.GetSample(ctx, id)
}

func (r *BenchmarkRepo) DeleteSample(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&do.FoodWeightLabeledSampleDO{}).Error
}

func (r *BenchmarkRepo) FindSamplesByFilter(ctx context.Context, filter domain.DatasetFilter) ([]do.FoodWeightLabeledSampleDO, error) {
	q := r.db.WithContext(ctx).Model(&do.FoodWeightLabeledSampleDO{})
	if len(filter.BatchNames) > 0 {
		q = q.Where("batch_name IN ?", filter.BatchNames)
	}
	if len(filter.LabelTypes) > 0 {
		q = q.Where("label_type IN ?", filter.LabelTypes)
	}
	if len(filter.Statuses) > 0 {
		q = q.Where("status IN ?", filter.Statuses)
	}
	if len(filter.SampleIDs) > 0 {
		q = q.Where("id IN ?", filter.SampleIDs)
	}
	var items []do.FoodWeightLabeledSampleDO
	if err := q.Order("batch_name, sample_name").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func applySampleFilters(q *gorm.DB, input domain.ListSamplesInput) *gorm.DB {
	if batch := strings.TrimSpace(input.BatchName); batch != "" && batch != "all" {
		q = q.Where("batch_name = ?", batch)
	}
	if labelType := strings.TrimSpace(input.LabelType); labelType != "" && labelType != "all" {
		q = q.Where("label_type = ?", labelType)
	}
	if status := strings.TrimSpace(input.Status); status != "" && status != "all" {
		q = q.Where("status = ?", status)
	}
	if query := strings.TrimSpace(input.Query); query != "" {
		like := "%" + query + "%"
		q = q.Where("sample_name ILIKE ? OR original_filename ILIKE ? OR batch_name ILIKE ?", like, like, like)
	}
	return q
}

// Benchmark runs

func (r *BenchmarkRepo) CreateRun(ctx context.Context, run *do.BenchmarkRunDO) error {
	return r.db.WithContext(ctx).Create(run).Error
}

func (r *BenchmarkRepo) GetRun(ctx context.Context, id string) (*do.BenchmarkRunDO, error) {
	var run do.BenchmarkRunDO
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *BenchmarkRepo) ListRuns(ctx context.Context, page, limit int) (*domain.ListRunsResult, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	var total int64
	if err := r.db.WithContext(ctx).Model(&do.BenchmarkRunDO{}).Count(&total).Error; err != nil {
		return nil, err
	}

	var items []do.BenchmarkRunDO
	if err := r.db.WithContext(ctx).Order("created_at DESC").Offset(offset).Limit(limit).Find(&items).Error; err != nil {
		return nil, err
	}
	return &domain.ListRunsResult{Items: items, Total: total, Page: page, Limit: limit}, nil
}

func (r *BenchmarkRepo) UpdateRun(ctx context.Context, id string, updates map[string]any) error {
	return r.db.WithContext(ctx).Model(&do.BenchmarkRunDO{}).Where("id = ?", id).Updates(updates).Error
}

func (r *BenchmarkRepo) DeleteRun(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("run_id = ?", id).Delete(&do.BenchmarkRunSampleDO{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&do.BenchmarkRunDO{}).Error
	})
}

// Benchmark run samples

func (r *BenchmarkRepo) CreateRunSample(ctx context.Context, sample *do.BenchmarkRunSampleDO) error {
	return r.db.WithContext(ctx).Create(sample).Error
}

func (r *BenchmarkRepo) UpdateRunSample(ctx context.Context, id string, updates map[string]any) error {
	return r.db.WithContext(ctx).Model(&do.BenchmarkRunSampleDO{}).Where("id = ?", id).Updates(updates).Error
}

func (r *BenchmarkRepo) ListRunSamples(ctx context.Context, runID string, page, limit int) (*domain.ListRunSamplesResult, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	var total int64
	if err := r.db.WithContext(ctx).Model(&do.BenchmarkRunSampleDO{}).Where("run_id = ?", runID).Count(&total).Error; err != nil {
		return nil, err
	}

	var items []do.BenchmarkRunSampleDO
	if err := r.db.WithContext(ctx).Where("run_id = ?", runID).Order("created_at").Offset(offset).Limit(limit).Find(&items).Error; err != nil {
		return nil, err
	}
	return &domain.ListRunSamplesResult{Items: items, Total: total, Page: page, Limit: limit}, nil
}

func (r *BenchmarkRepo) CountRunSampleStatuses(ctx context.Context, runID string) (map[string]int64, error) {
	rows := []struct {
		Status string
		Count  int64
	}{}
	if err := r.db.WithContext(ctx).Model(&do.BenchmarkRunSampleDO{}).
		Select("status, COUNT(*) as count").
		Where("run_id = ?", runID).
		Group("status").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]int64)
	for _, r := range rows {
		out[r.Status] = r.Count
	}
	return out, nil
}

func (r *BenchmarkRepo) GetRunSampleByTaskID(ctx context.Context, taskID string) (*do.BenchmarkRunSampleDO, error) {
	var item do.BenchmarkRunSampleDO
	if err := r.db.WithContext(ctx).Where("task_id = ?", taskID).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *BenchmarkRepo) SearchRuns(ctx context.Context, query string, page, limit int) (*domain.ListRunsResult, error) {
	if limit <= 0 {
		limit = 30
	}
	if limit > 100 {
		limit = 100
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * limit

	q := r.db.WithContext(ctx).Model(&do.BenchmarkRunDO{})
	if query := strings.TrimSpace(query); query != "" {
		like := "%" + query + "%"
		q = q.Where("name ILIKE ? OR execution_mode ILIKE ?", like, like)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, err
	}

	var items []do.BenchmarkRunDO
	if err := q.Order("created_at DESC").Offset(offset).Limit(limit).Find(&items).Error; err != nil {
		return nil, err
	}
	return &domain.ListRunsResult{Items: items, Total: total, Page: page, Limit: limit}, nil
}
