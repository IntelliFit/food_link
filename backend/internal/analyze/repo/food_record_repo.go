package repo

import (
	"context"

	"gorm.io/gorm"
)

type FoodRecordRepo struct {
	db *gorm.DB
}

func NewFoodRecordRepo(db *gorm.DB) *FoodRecordRepo {
	return &FoodRecordRepo{db: db}
}

// GetSourceTaskIDByRecord 通过 record_id 查找关联的 source_task_id（若表结构存在该字段）
func (r *FoodRecordRepo) GetSourceTaskIDByRecord(ctx context.Context, recordID string) (*string, error) {
	var result struct {
		SourceTaskID *string `gorm:"column:source_task_id"`
	}
	err := r.db.WithContext(ctx).Table("user_food_records").
		Select("source_task_id").
		Where("id = ?", recordID).
		Scan(&result).Error
	if err != nil {
		return nil, err
	}
	return result.SourceTaskID, nil
}
