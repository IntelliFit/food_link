package repo

import (
	"context"
	"encoding/json"
	"time"

	"food_link/backend/internal/admin/domain"
	"food_link/backend/internal/migration/do"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type PackagedFoodTestRunRepo struct {
	db *gorm.DB
}

func NewPackagedFoodTestRunRepo(db *gorm.DB) *PackagedFoodTestRunRepo {
	return &PackagedFoodTestRunRepo{db: db}
}

type ListTestRunsInput struct {
	PackagedFoodID string
	Limit          int
	Offset         int
}

type ListTestRunsResult struct {
	Items []domain.PackagedFoodTestRun
	Total int64
}

func (r *PackagedFoodTestRunRepo) List(ctx context.Context, input ListTestRunsInput) (*ListTestRunsResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}

	query := r.db.WithContext(ctx).Model(&do.PackagedFoodTestRunDO{})
	if input.PackagedFoodID != "" {
		query = query.Where("packaged_food_id = ?", input.PackagedFoodID)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}

	var rows []do.PackagedFoodTestRunDO
	if err := query.Order("created_at DESC").Offset(offset).Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}

	items := make([]domain.PackagedFoodTestRun, 0, len(rows))
	for _, row := range rows {
		items = append(items, mapDOToDomain(row))
	}
	return &ListTestRunsResult{Items: items, Total: total}, nil
}

func (r *PackagedFoodTestRunRepo) Get(ctx context.Context, id string) (*domain.PackagedFoodTestRun, error) {
	var row do.PackagedFoodTestRunDO
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&row).Error; err != nil {
		return nil, err
	}
	item := mapDOToDomain(row)
	return &item, nil
}

func (r *PackagedFoodTestRunRepo) Create(ctx context.Context, item *domain.PackagedFoodTestRun) (*domain.PackagedFoodTestRun, error) {
	if item.ID == "" {
		item.ID = uuid.New().String()
	}
	now := time.Now()
	if item.CreatedAt == nil {
		item.CreatedAt = &now
	}
	if item.UpdatedAt == nil {
		item.UpdatedAt = &now
	}

	row, err := mapDomainToDO(*item)
	if err != nil {
		return nil, err
	}
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, err
	}
	return r.Get(ctx, item.ID)
}

func (r *PackagedFoodTestRunRepo) UpdateResult(ctx context.Context, id string, status string, resultJSON map[string]any, metadata domain.PackagedFoodTestRunMetadata, errorMessage *string, completedAt time.Time) error {
	resultData, err := json.Marshal(resultJSON)
	if err != nil {
		return err
	}
	metaData, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	updates := map[string]any{
		"status":        status,
		"result_json":   datatypes.JSON(resultData),
		"metadata_json": datatypes.JSON(metaData),
		"completed_at":  completedAt,
		"updated_at":    time.Now(),
	}
	if errorMessage != nil {
		updates["error_message"] = *errorMessage
	} else {
		updates["error_message"] = gorm.Expr("NULL")
	}
	return r.db.WithContext(ctx).Model(&do.PackagedFoodTestRunDO{}).Where("id = ?", id).Updates(updates).Error
}

func mapDOToDomain(row do.PackagedFoodTestRunDO) domain.PackagedFoodTestRun {
	item := domain.PackagedFoodTestRun{
		ID:             row.ID,
		PackagedFoodID: row.PackagedFoodID,
		Status:         row.Status,
		ErrorMessage:   row.ErrorMessage,
		StartedAt:      row.StartedAt,
		CompletedAt:    row.CompletedAt,
		CreatedBy:      row.CreatedBy,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
	}
	if len(row.ResultJSON) > 0 {
		_ = json.Unmarshal(row.ResultJSON, &item.Result)
	}
	if len(row.MetadataJSON) > 0 {
		_ = json.Unmarshal(row.MetadataJSON, &item.Metadata)
	}
	return item
}

func mapDomainToDO(item domain.PackagedFoodTestRun) (*do.PackagedFoodTestRunDO, error) {
	resultJSON, err := json.Marshal(item.Result)
	if err != nil {
		return nil, err
	}
	metaJSON, err := json.Marshal(item.Metadata)
	if err != nil {
		return nil, err
	}
	return &do.PackagedFoodTestRunDO{
		ID:             item.ID,
		PackagedFoodID: item.PackagedFoodID,
		Status:         item.Status,
		ResultJSON:     resultJSON,
		MetadataJSON:   metaJSON,
		ErrorMessage:   item.ErrorMessage,
		StartedAt:      item.StartedAt,
		CompletedAt:    item.CompletedAt,
		CreatedBy:      item.CreatedBy,
		CreatedAt:      item.CreatedAt,
		UpdatedAt:      item.UpdatedAt,
	}, nil
}
